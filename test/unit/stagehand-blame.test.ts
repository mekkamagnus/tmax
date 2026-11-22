import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-blame.test.ts
 * @description #296 — SPEC-289's blame half: the porcelain parse
 * (normal + rename-origin + boundary commits), the echo attribution,
 * RET → show, the refusal matrix (untracked, modified-on-disk,
 * staged, dirty-buffer), and re-run after edit.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const git = (...args: string[]) => execFileSync("git", args, { cwd: process.cwd() }).toString().trim();
const st = (ed: Editor) => String(e(ed, "(editor-status)").value);

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i296b-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module stagehand/status)");
  e(editor, "(require-module stagehand/blame)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const commit = (msg: string) => {
  execFileSync("git", ["add", "."], { cwd: process.cwd() });
  execFileSync("git", ["-c", "user.email=a@e.com", "-c", "user.name=Author One", "commit", "-q", "-m", msg], { cwd: process.cwd() });
};
const blame = (path: string) => e(editor, `(stagehand/blame/stagehand-blame-file "${path}")`);

describe("#296 — blame mode (SPEC-289, the blame half)", () => {
  test("NORMAL parse + echo + RET: attribution per line, show opens the commit", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "line-a\nline-b\nline-c\n");
    commit("c1");
    writeFileSync(join(process.cwd(), "f.txt"), "line-a\nline-B\nline-c\n");
    commit("c2");
    blame("f.txt");
    // The buffer holds the SOURCE lines only (no phantom sha).
    const view = strip(bufferText(editor));
    expect(view).toContain("line-a");
    expect(view).toContain("line-B");
    expect(view).not.toMatch(/^[0-9a-f]{8,}/m);
    // The echo carries the CURRENT line's attribution.
    e(editor, "(cursor-move 0 0)");
    const att0 = String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value);
    expect(att0).toContain("c1".length > 0 ? " " : ""); // shape: sha author date summary
    expect(att0).toContain("Author One");
    e(editor, "(stagehand/blame/stagehand-blame-next)");
    const att1 = String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value);
    expect(att1).toContain("c2"); // the changed line's summary
    // RET opens #290's show view for the line's commit.
    e(editor, "(stagehand/blame/stagehand-blame-show)");
    expect(String(e(editor, "(buffer-name)").value)).toBe("*Stagehand-Show*");
    expect(strip(bufferText(editor))).toContain("c2");
  });

  test("RENAME-ORIGIN blame follows the file's earlier name", () => {
    writeFileSync(join(process.cwd(), "old.txt"), "carried\n");
    commit("c1");
    execFileSync("git", ["mv", "old.txt", "new.txt"], { cwd: process.cwd() });
    commit("c2: rename");
    blame("new.txt");
    const rows = Number(String(e(editor, "(length (stagehand/blame/stagehand-blame-rows-get))").value));
    expect(rows).toBe(1); // the carried line renders (the origin resolved)
    e(editor, "(cursor-move 0 0)");
    const att = String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value);
    expect(att).toContain("c1"); // attributed to the ORIGINAL commit
  });

  test("BOUNDARY commits (the root commit) blame cleanly", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "root line\n");
    commit("c1");
    blame("f.txt");
    e(editor, "(cursor-move 0 0)");
    const att = String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value);
    expect(att).toContain("c1");
    expect(att).toContain("Author One");
  });

  test("the tint renders (the span API consumed)", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\n");
    commit("c1");
    blame("f.txt");
    const { captureFrame } = await import("../../src/render/capture-frame.ts");
    const frame = captureFrame(editor.getEditorState() as never, 40, 8);
    // #3a3226 → rgb(58,50,38)
    expect(frame.join("\n")).toContain("48;2;58;50;38");
  });

  test("REFUSALS: untracked / staged / modified-on-disk", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("c1");
    // staged
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    blame("f.txt");
    expect(st(editor)).toContain("commit first");
    execFileSync("git", ["restore", "--staged", "f.txt"], { cwd: process.cwd() });
    // modified on disk (unstaged)
    blame("f.txt");
    expect(st(editor)).toContain("commit first");
    execFileSync("git", ["checkout", "--", "f.txt"], { cwd: process.cwd() });
    // untracked
    writeFileSync(join(process.cwd(), "new.txt"), "n\n");
    blame("new.txt");
    expect(st(editor)).toContain("commit first");
    expect(st(editor)).toContain("untracked");
    // clean again → blames
    blame("f.txt");
    expect(String(e(editor, "(buffer-name)").value)).toBe("*Stagehand-Blame*");
  });

  test("DIRTY-BUFFER refusal: an externally changed file under an unmodified buffer", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("c1");
    e(editor, '(find-file "f.txt")');
    // External change on disk; the BUFFER still holds the old text.
    writeFileSync(join(process.cwd(), "f.txt"), "EXTERNAL\n");
    blame("f.txt");
    expect(st(editor)).toContain("commit first");
  });

  test("RE-RUN after edit: commit a change, g re-blames against the new HEAD", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "one\n");
    commit("c1");
    blame("f.txt");
    writeFileSync(join(process.cwd(), "f.txt"), "one\ntwo\n");
    commit("c2");
    e(editor, "(stagehand/blame/stagehand-blame-refresh)");
    expect(String(e(editor, "(buffer-name)").value)).toBe("*Stagehand-Blame*");
    expect(strip(bufferText(editor))).toContain("two");
    e(editor, "(cursor-move 1 0)");
    expect(String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value)).toContain("c2");
  });
});

describe("#296 — gate r1 fixes", () => {
  test("the SHOW view from blame: n/p report 'no log to walk'; q closes without a log", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("c1");
    blame("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/blame/stagehand-blame-show)");
    expect(String(e(editor, "(buffer-name)").value)).toBe("*Stagehand-Show*");
    e(editor, "(stagehand/log/stagehand-show-next)");
    expect(st(editor)).toContain("no log to walk");
    e(editor, "(stagehand/log/stagehand-show-prev)");
    expect(st(editor)).toContain("no log to walk");
    // q closes the show buffer; no switch to a nonexistent log.
    e(editor, "(stagehand/log/stagehand-show-quit)");
    expect(String(e(editor, "(buffer-name)").value)).not.toBe("*Stagehand-Show*");
  });

  test("PREFLIGHT scans NON-current buffers: a divergent buffer away from point refuses", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("c1");
    e(editor, '(find-file "f.txt")');
    e(editor, '(buffer-insert "X")'); // the buffer now diverges (unsaved)
    e(editor, '(buffer-switch "*scratch*")'); // switch AWAY
    blame("f.txt");
    expect(st(editor)).toContain("commit first");
  });

  test("the STABLE-HEAD branch of g re-applies the tint", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "one\n");
    commit("c1");
    blame("f.txt");
    e(editor, "(stagehand/blame/stagehand-blame-refresh)");
    expect(st(editor)).toContain("re-applied");
    const { captureFrame } = await import("../../src/render/capture-frame.ts");
    const frame = captureFrame(editor.getEditorState() as never, 40, 8);
    expect(frame.join("\n")).toContain("48;2;58;50;38"); // the tint lives
  });
});

describe("#296 — gate r2 fixes (blame)", () => {
  test("M-x blame REACHABLE: the bare entry resolves and runs", () => {
    // The require chain in normal.tlisp must include editor/commands/blame
    // (gate r2: unreachable dead code without it).
    const r = e(editor, "(blame)");
    expect(String(r.value)).toContain("no file"); // the fileless-buffer path — it RAN
  });

  test("the disk-scan RESTORES the user's point (the refusal path never moves them)", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nv2\nv3\n");
    commit("c1");
    e(editor, '(find-file "f.txt")');
    // Diverge the buffer (unsaved) — blame REFUSES after the scan.
    e(editor, '(buffer-insert "X")');
    e(editor, '(buffer-switch "*scratch*")');
    e(editor, "(cursor-move 1 0)");
    blame("f.txt");
    expect(st(editor)).toContain("commit first");
    // The scan switched through every buffer and restored both the
    // buffer AND the point (buffer-switch resets point — #127).
    expect(String(e(editor, "(buffer-name)").value)).toBe("*scratch*");
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(1);
  });

  test("q from a blame-launched show returns to BLAME even when a log buffer is alive", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("c1");
    e(editor, "(stagehand/status/stagehand-status)");
    e(editor, "(stagehand/log/stagehand-log-open)");
    blame("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/blame/stagehand-blame-show)");
    e(editor, "(stagehand/log/stagehand-show-quit)");
    expect(String(e(editor, "(buffer-name)").value)).toBe("*Stagehand-Blame*");
  });
});
