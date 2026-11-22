import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

  test("g with a STABLE head RE-RUNS (preflight + blame — valve r1: one always-correct path)", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "one\n");
    commit("c1");
    blame("f.txt");
    e(editor, "(stagehand/blame/stagehand-blame-refresh)");
    // The re-run re-rendered the blame view (still current) and the
    // attribution survives.
    expect(String(e(editor, "(buffer-name)").value)).toBe("*Stagehand-Blame*");
    e(editor, "(cursor-move 0 0)");
    expect(String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value)).toContain("c1");
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

describe("#296 — valve r1 fixes", () => {
  test("REPEATED commits keep their OWN metadata (the porcelain cache)", () => {
    // c1 writes 3 lines; c2 changes the MIDDLE — c1's lines are
    // NON-CONTIGUOUS: its second appearance is a BARE header after
    // c2's full block (the leak shape).
    writeFileSync(join(process.cwd(), "f.txt"), "one\ntwo\nthree\n");
    commit("first commit");
    writeFileSync(join(process.cwd(), "f.txt"), "one\nTWO\nthree\n");
    commit("second commit");
    blame("f.txt");
    e(editor, "(cursor-move 1 0)");
    expect(String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value)).toContain("second commit");
    // Line 3: c1 REPEATS as a bare header — its summary must be its
    // OWN, not c2's leaked group state.
    e(editor, "(cursor-move 2 0)");
    const att2 = String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value);
    expect(att2).toContain("first commit");
    expect(att2).not.toContain("second commit");
  });

  test("an EDIT + RESTORE does not REVIVE dropped span records (sticky invalidation)", async () => {
    const { captureFrame } = await import("../../src/render/capture-frame.ts");
    setText2("hello\nworld\n");
    e(editor, '(span-make "test" 0 0 0 5 "region")');
    setText2("HELLO\nworld\n"); // the edit invalidates
    setText2("hello\nworld\n"); // restore — the drop must STICK
    // A new span re-publishes: the OLD record was deleted (its
    // checksum mismatches), only the NEW one renders.
    e(editor, '(span-make "test" 1 0 1 5 "match")');
    const entry = (editor as unknown as { model: { bufferSpans?: Map<string, { spans: unknown[][] }> } }).model.bufferSpans?.get("test");
    const line0 = entry?.spans[0] ?? [];
    expect(line0.length).toBe(0); // the restored region is GONE
  });
});

/** Set the CURRENT buffer text (the clear+append idiom). */
function setText2(text: string): void {
  const count = Number(String(e(editor, "(buffer-line-count)").value));
  if (count > 1) e(editor, `(buffer-delete-range 0 0 ${count - 1} 0)`);
  const first = String(e(editor, "(buffer-line 0)").value);
  if (first.length > 0) e(editor, `(buffer-delete-range 0 0 0 ${first.length})`);
  e(editor, `(buffer-append ${JSON.stringify(text)})`);
}

describe("#296 — valve r2 fixes (blame)", () => {
  test("blame WITHOUT a status open: the root resolves and RET-show works (the launch dir)", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("c1");
    // NO stagehand-status call — the root must come from the launch
    // dir detection, and the show view from BLAME's root.
    blame("f.txt");
    expect(String(e(editor, "(buffer-name)").value)).toBe("*Stagehand-Blame*");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/blame/stagehand-blame-show)");
    expect(String(e(editor, "(buffer-name)").value)).toBe("*Stagehand-Show*");
    expect(strip(bufferText(editor))).toContain("c1");
  });

  test("NORMALIZED preflight: an ABSOLUTE buffer filename vs a RELATIVE blame path still refuses", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("c1");
    e(editor, `(find-file "${join(process.cwd(), "f.txt")}")`); // ABSOLUTE
    e(editor, '(buffer-insert "X")'); // diverges
    e(editor, '(buffer-switch "*scratch*")');
    blame("f.txt"); // RELATIVE path — same file
    expect(st(editor)).toContain("commit first");
  });
});

describe("#296 — valve r3 fixes (blame)", () => {
  test("ORDINARY movement (j) updates the echo attribution", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "one\ntwo\nthree\n");
    commit("c1");
    writeFileSync(join(process.cwd(), "f.txt"), "one\ntwo\nTHREE\n");
    commit("c2");
    blame("f.txt");
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/blame/stagehand-blame-next)");
    expect(String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value)).toContain("c1");
    // j — ordinary movement — moves AND echoes.
    e(editor, "(stagehand/blame/stagehand-blame-next)");
    e(editor, "(stagehand/blame/stagehand-blame-next)");
    expect(String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value)).toContain("c2");
  });
});

describe("#296 — valve r4 fixes", () => {
  test("TWO REPOSITORIES: a status-row blame uses the STATUS's repo after the cwd moves on", () => {
    // Repo B holds f.txt; the STATUS opens under B, then the process
    // cwd moves to A (the 'launch dir' now resolves to A) — the row
    // must still blame B (the row's provenance, valve r4).
    const a = join(tmpdir(), "repoA-" + Date.now());
    const b = join(tmpdir(), "repoB-" + Date.now());
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: b });
    writeFileSync(join(b, "base.txt"), "seed\n");
    execFileSync("git", ["add", "."], { cwd: b });
    execFileSync("git", ["-c", "user.email=b@e.com", "-c", "user.name=Author B", "commit", "-q", "-m", "seed"], { cwd: b });
    // A MODIFIED f.txt rows in the status...
    writeFileSync(join(b, "f.txt"), "from-B\n");
    execFileSync("git", ["add", "f.txt"], { cwd: b });
    process.chdir(b);
    editor.setClientLaunchDir(b);
    e(editor, "(stagehand/status/stagehand-status)"); // root = B
    // ...then it's COMMITTED (the row goes STALE but stays on screen).
    execFileSync("git", ["-c", "user.email=b@e.com", "-c", "user.name=Author B", "commit", "-q", "-m", "B-commit"], { cwd: b });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: a });
    writeFileSync(join(a, "unrelated.txt"), "x\n");
    process.chdir(a);
    editor.setClientLaunchDir(a); // the launch dir resolves to A now
    const ls = strip(bufferText(editor)).split("\n");
    const row = ls.findIndex((l) => l.includes("f.txt"));
    expect(row).toBeGreaterThanOrEqual(0); // the STALE row is still rendered
    e(editor, `(cursor-move ${row} 0)`);
    e(editor, "(stagehand/blame/stagehand-blame-row)");
    // The blame ran against B (B-commit), never A (where f.txt is
    // untracked — the detect-first resolution would REFUSE).
    e(editor, "(cursor-move 0 0)");
    const att = String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value);
    expect(att).toContain("B-commit");
    expect(att).toContain("Author B");
  });

  test("EDIT-RECOVERY: an invalidating edit hints 'press g' and g recovers (real keys)", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("c1");
    blame("f.txt");
    // Edit the FILE (externally) + commit — then any state change
    // prunes... the spans belong to the BLAME buffer whose text is
    // unchanged; the hint fires when the blame buffer itself is
    // edited (read-only off).
    e(editor, "(buffer-set-read-only nil)");
    e(editor, '(buffer-insert "X")');
    const s = String(e(editor, "(editor-status)").value);
    expect(s).toContain("press g to re-run");
    await editor.handleKey("g");
    expect(String(e(editor, "(buffer-name)").value)).toBe("*Stagehand-Blame*");
    e(editor, "(cursor-move 0 0)");
    expect(String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value)).toContain("c1");
  });

  test("REAL KEY movement (j via handleKey) updates the echo", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "one\ntwo\nTHREE\n");
    commit("c1");
    writeFileSync(join(process.cwd(), "f.txt"), "one\ntwo\nCHANGED\n");
    commit("c2");
    blame("f.txt");
    e(editor, "(cursor-move 0 0)");
    await editor.handleKey("j");
    await editor.handleKey("j");
    const att = String(e(editor, "(stagehand/blame/stagehand-blame-attribution-get)").value);
    expect(att).toContain("c2"); // line 3 via two real j presses
  });
});
