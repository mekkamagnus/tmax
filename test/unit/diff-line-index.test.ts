import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/** #312 — the diff-line-index primitive + the RET resolution. */
type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const st = (ed: Editor) => String(e(ed, "(editor-status)").value);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const idx = (ed: Editor, expr: string) => e(ed, `(editor/fikra/diff-line-index/${expr})`);

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

const setup = async (): Promise<Editor> => {
  const dir = mkdtempSync(join(tmpdir(), "i312-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  process.chdir(dir);
  const ed = await createStartedEditor("");
  ed.setClientLaunchDir(dir);
  e(ed, "(require-module editor/fikra/diff-line-index)");
  e(ed, "(require-module fikra/chat)");
  idx(ed, "diff-line-index-reset");
  // The registry's LAZY INVALIDATION drops slots for buffers that
  // do not exist — the test buffer must be real before recording.
  e(ed, '(buffer-create "*Fikra*")');
  return ed;
};
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const target = (path: string, line: number, side: string) =>
  `(hashmap "path" "${path}" "line" ${line} "side" "${side}" "hunk" nil)`;

describe("#312 — the registry primitive", () => {
  test("record + lookup round-trip; 0-based lines; unknown → nil", async () => {
    editor = await setup();
    idx(editor, `diff-line-index-record "*Fikra*" 5 ${target("src/a.ts", 10, "new")}`);
    const hit = e(editor, '(hashmap-get (editor/fikra/diff-line-index/diff-line-index-lookup "*Fikra*" 5) "path")');
    expect(String(hit.value)).toBe("src/a.ts");
    const miss = idx(editor, 'diff-line-index-lookup "*Fikra*" 6');
    expect(["nil", "null"].includes(String(miss.value))).toBe(true);
  });

  test("APPEND-STABILITY: an existing entry is never rewritten", async () => {
    editor = await setup();
    idx(editor, `diff-line-index-record "*Fikra*" 3 ${target("one.ts", 1, "new")}`);
    idx(editor, `diff-line-index-record "*Fikra*" 3 ${target("two.ts", 2, "new")}`);
    const p = e(editor, '(hashmap-get (editor/fikra/diff-line-index/diff-line-index-lookup "*Fikra*" 3) "path")');
    expect(String(p.value)).toBe("one.ts");
  });

  test("per-buffer ISOLATION + drop-buffer", async () => {
    editor = await setup();
    idx(editor, `diff-line-index-record "*Fikra*" 1 ${target("a.ts", 1, "new")}`);
    idx(editor, `diff-line-index-record "*Fikra-Diff*" 1 ${target("b.ts", 1, "new")}`);
    console.error("BISECT-state:", String(e(editor, "(editor/fikra/diff-line-index/diff-line-index-state-get)").value).slice(0, 100));
    expect(Number(idx(editor, 'diff-line-index-entry-count "*Fikra*"').value)).toBe(1);
    expect(Number(idx(editor, 'diff-line-index-entry-count "*Fikra-Diff*"').value)).toBe(1);
    idx(editor, 'diff-line-index-drop-buffer "*Fikra*"');
    expect(Number(idx(editor, 'diff-line-index-entry-count "*Fikra*"').value)).toBe(0);
    expect(Number(idx(editor, 'diff-line-index-entry-count "*Fikra-Diff*"').value)).toBe(1);
  });

  test("REPLAY repopulation: clear-buffer keeps the name registered; re-record from scratch", async () => {
    editor = await setup();
    idx(editor, `diff-line-index-record "*Fikra*" 1 ${target("old-map.ts", 1, "new")}`);
    idx(editor, 'diff-line-index-clear-buffer "*Fikra*"');
    expect(Number(idx(editor, 'diff-line-index-entry-count "*Fikra*"').value)).toBe(0);
    idx(editor, `diff-line-index-record "*Fikra*" 1 ${target("new-map.ts", 9, "new")}`);
    const p = e(editor, '(hashmap-get (editor/fikra/diff-line-index/diff-line-index-lookup "*Fikra*" 1) "path")');
    expect(String(p.value)).toBe("new-map.ts");
  });

  test("LAZY INVALIDATION: lookup on a dead buffer drops its slot", async () => {
    editor = await setup();
    // A buffer name that does not exist:
    idx(editor, `diff-line-index-record "*Ghost*" 1 ${target("g.ts", 1, "new")}`);
    const miss = idx(editor, 'diff-line-index-lookup "*Ghost*" 1');
    expect(["nil", "null"].includes(String(miss.value))).toBe(true);
    expect(Number(idx(editor, 'diff-line-index-entry-count "*Ghost"').value)).toBe(0);
  });
});

describe("#312 — RET via the index", () => {
  const enterFikra = async (lines: string[], cursorLine: number) => {
    e(editor, '(buffer-create "*Fikra*")');
    e(editor, '(buffer-switch "*Fikra*")');
    e(editor, "(buffer-set-read-only nil)");
    for (const ln of lines) e(editor, `(buffer-append "${ln}\n")`);
    e(editor, `(cursor-move ${cursorLine} 0)`);
  };

  test("NEW-side exact landing; old-side approximate + note; deleted refusal; regex fallback on miss", async () => {
    editor = await setup();
    writeFileSync(join(process.cwd(), "real.ts"), "l0\nl1\nl2\nl3\nl4\n");
    // NEW-side: line 3 exactly.
    await enterFikra(["header", "row-a", "row-b"], 2);
    idx(editor, `diff-line-index-record "*Fikra*" 2 ${target(join(process.cwd(), "real.ts"), 3, "new")}`);
    e(editor, "(fikra/chat/fikra-follow-link)");
    expect(Number(e(editor, "(cursor-line)").value)).toBe(3);
    expect(String(e(editor, "(buffer-current)").value)).toContain("real.ts");

    // OLD-side: recorded line 1 — lands + the approximate note.
    e(editor, '(buffer-switch "*Fikra*")');
    e(editor, "(buffer-set-read-only nil)");
    idx(editor, 'diff-line-index-clear-buffer "*Fikra*"');
    idx(editor, `diff-line-index-record "*Fikra*" 0 ${target(join(process.cwd(), "real.ts"), 1, "old")}`);
    e(editor, "(cursor-move 0 0)");
    e(editor, "(fikra/chat/fikra-follow-link)");
    expect(Number(e(editor, "(cursor-line)").value)).toBe(1);
    expect(st(editor)).toContain("old-side line — approximate");

    // DELETED file: honest refusal, no buffer switch.
    e(editor, '(buffer-switch "*Fikra*")');
    idx(editor, 'diff-line-index-clear-buffer "*Fikra*"');
    idx(editor, `diff-line-index-record "*Fikra*" 1 ${target(join(process.cwd(), "gone.ts"), 0, "new")}`);
    e(editor, "(cursor-move 1 0)");
    e(editor, "(fikra/chat/fikra-follow-link)");
    expect(st(editor)).toContain("file deleted in worktree");
    expect(String(e(editor, "(buffer-current)").value)).toContain("Fikra");

    // MISS → the regex FALLBACK (a plain path line, no index entry).
    // PRE-EXISTING main behavior kept as-is per the issue ("regex
    // extraction stays as fallback"): extract returns a match INDEX
    // and find-file on it errs — the pin is that the fallback RAN
    // (no 'no file path' status, no index-lookup crash).
    e(editor, '(buffer-switch "*Fikra*")');
    e(editor, "(buffer-set-read-only nil)");
    e(editor, `(buffer-append "see ${join(process.cwd(), "real.ts")} here\n")`);
    idx(editor, 'diff-line-index-clear-buffer "*Fikra*"');
    e(editor, "(cursor-move 3 0)");
    const fb = e(editor, '(condition-case nil (progn (fikra/chat/fikra-follow-link) "ran") (error (m) (concat "fallback-quirk: " m)))');
    expect(String(fb.value)).not.toContain("Undefined symbol");
    expect(st(editor)).not.toContain("no file path");
  });
});
