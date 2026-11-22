import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file grep-buffer.test.ts
 * @description #307 — the *grep* hit-buffer subsystem driven by the
 * TEST PRODUCER: the validation matrix (exact keys, field classes,
 * empty pattern/text), validation-before-staleness precedence,
 * generation drops, post-completion drops, the three complete
 * states, rollback semantics, RET landing + clamps, n/p/g/q.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const st = (ed: Editor) => String(e(ed, "(editor-status)").value);
const reg = (backend = "test", pattern = "pat", scope = ".", rerun = "(lambda () nil)") =>
  `(hashmap "backend" "${backend}" "pattern" "${pattern}" "scope" "${scope}" "rerun" ${rerun})`;
const hit = (file: string, line: number, col: number, text: string) =>
  `(hashmap "file" "${file}" "line" ${line} "col" ${col} "text" "${text}")`;

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i307-"));
  dirs.push(dir);
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module editor/commands/grep)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("#307 — the producer interface", () => {
  test("register returns gen 1; the searching placeholder renders; hits stream", () => {
    const g = String(e(editor, `(grep-buffer-register ${reg()})`).value);
    expect(g).toBe("1");
    expect(strip(bufferText(editor))).toContain("searching…");
    e(editor, `(grep-buffer-append-hit 1 ${hit("a.txt", 3, 5, "match one")})`);
    expect(strip(bufferText(editor))).toContain("a.txt:3:5:match one");
    e(editor, `(grep-buffer-append-hit 1 ${hit("b.txt", 1, 1, "")})`);
    expect(strip(bufferText(editor))).toContain("b.txt:1:1:");
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    expect(String(e(editor, "(editor/commands/grep/grep-status-get)").value)).toBe("done");
    expect(st(editor)).toContain("2 hits");
  });

  test("EMPTY pattern registers; display renders <glob-only>", () => {
    e(editor, `(grep-buffer-register ${reg("test", "", ".")})`);
    expect(strip(bufferText(editor))).toContain("<glob-only>");
    e(editor, '(grep-buffer-complete 1 "no-matches" nil)');
    expect(strip(bufferText(editor))).toContain("no matches for <glob-only>");
  });

  test("VALIDATION matrix: unknown keys + each field class error BEFORE staleness", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    // Unknown key on a COMPLETED generation still errors (precedence).
    expect(() => e(editor, `(grep-buffer-register (hashmap "backend" "b" "pattern" "p" "scope" "s" "rerun" (lambda () nil) "extra" 1))`)).toThrow(/bad fields/);
    expect(() => e(editor, `(grep-buffer-append-hit 99 ${hit("", 1, 1, "t")})`)).toThrow(/file/);
    expect(() => e(editor, `(grep-buffer-append-hit 99 ${hit("f", 0, 1, "t")})`)).toThrow(/line/);
    expect(() => e(editor, `(grep-buffer-append-hit 99 ${hit("f", 1, 0, "t")})`)).toThrow(/col/);
    expect(() => e(editor, '(grep-buffer-complete "x" "done" nil)')).toThrow(/gen/);
    expect(() => e(editor, '(grep-buffer-complete 99 "weird" nil)')).toThrow(/status/);
    expect(() => e(editor, '(grep-buffer-complete 99 "error" nil)')).toThrow(/message/);
    expect(() => e(editor, "(grep-buffer-rollback 99)")).toThrow(/not the latest/); // current is nil → gen 99 mismatches
  });

  test("generation drops: superseded + post-completion appends are SILENT", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a.txt", 1, 1, "first")})`);
    e(editor, `(grep-buffer-register ${reg()})`); // gen 2 supersedes
    e(editor, `(grep-buffer-append-hit 1 ${hit("stale.txt", 1, 1, "dropped")})`); // silent
    e(editor, `(grep-buffer-append-hit 2 ${hit("b.txt", 1, 1, "live")})`);
    e(editor, '(grep-buffer-complete 2 "done" nil)');
    e(editor, `(grep-buffer-append-hit 2 ${hit("post.txt", 1, 1, "dropped")})`); // silent
    const hits = String(e(editor, "(length (editor/commands/grep/grep-hits-get))").value);
    expect(hits).toBe("1");
    expect(strip(bufferText(editor))).not.toContain("stale.txt");
    expect(strip(bufferText(editor))).not.toContain("post.txt");
  });

  test("ROLLBACK: latest-only; completed refused; restore fidelity; retired ids", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a.txt", 1, 1, "gen1")})`);
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 2 ${hit("b.txt", 2, 2, "gen2")})`);
    // Rolling back the OLD generation → error.
    expect(() => e(editor, "(grep-buffer-rollback 1)")).toThrow(/not the latest/);
    // Roll back the LATEST → restores gen 1's content.
    e(editor, "(grep-buffer-rollback 2)");
    expect(strip(bufferText(editor))).toContain("gen1");
    expect(strip(bufferText(editor))).not.toContain("gen2");
    expect(String(e(editor, "(editor/commands/grep/grep-current-gen-get)").value)).toBe("1");
    // The RESTORED generation accepts no callbacks for its OLD id.
    e(editor, `(grep-buffer-append-hit 2 ${hit("x", 1, 1, "no")})`); // silent (not current)
    // Completing the restored gen 1 works; rolling back a COMPLETED gen errors.
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    expect(() => e(editor, "(grep-buffer-rollback 1)")).toThrow(/already complete/);
  });

  test("ERROR completion: zero hits renders the message; with hits it rides as a suffix", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, '(grep-buffer-complete 1 "error" "boom")');
    expect(strip(bufferText(editor))).toContain("boom");
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 2 ${hit("a.txt", 1, 1, "hit")})`);
    e(editor, '(grep-buffer-complete 2 "error" "partial")');
    const v = strip(bufferText(editor));
    expect(v).toContain("a.txt:1:1:hit");
    expect(v).toContain("partial");
  });
});

describe("#307 — navigation + landing", () => {
  test("RET lands exactly; line clamp notes; col clamp silent; deleted file", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "line1\nline2\nline3\n");
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("f.txt", 2, 6, "ne2")})`);
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    e(editor, "(cursor-move 0 0)");
    e(editor, "(editor/commands/grep/grep-ret)");
    expect(String(e(editor, "(buffer-name)").value)).toContain("f.txt");
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(1); // 0-based line 2
    expect(Number(String(e(editor, "(cursor-column)").value))).toBe(4); // col 6 clamps to EOL (5 chars, 0-based 4)
    // LINE clamp: line 99 → last line + note.
    e(editor, '(buffer-switch "*grep*")');
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 2 ${hit("f.txt", 99, 1, "x")})`);
    e(editor, '(grep-buffer-complete 2 "done" nil)');
    e(editor, "(cursor-move 0 0)");
    e(editor, "(editor/commands/grep/grep-ret)");
    expect(st(editor)).toContain("clamped");
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(2); // last (3 lines)
    // Deleted file.
    e(editor, '(buffer-switch "*grep*")');
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 3 ${hit("gone.txt", 1, 1, "x")})`);
    e(editor, '(grep-buffer-complete 3 "done" nil)');
    e(editor, "(cursor-move 0 0)");
    e(editor, "(editor/commands/grep/grep-ret)");
    expect(st(editor)).toContain("file gone");
  });

  test("SCOPE resolution: relative paths open against the registered scope", () => {
    mkdirSync(join(process.cwd(), "sub"));
    writeFileSync(join(process.cwd(), "sub", "s.txt"), "needle here\n");
    e(editor, `(grep-buffer-register ${reg("test", "needle", ".")})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("sub/s.txt", 1, 1, "needle here")})`);
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    e(editor, "(cursor-move 0 0)");
    e(editor, "(editor/commands/grep/grep-ret)");
    expect(String(e(editor, "(buffer-name)").value)).toContain("s.txt");
  });

  test("n/p wrap; empty results no-op; g re-runs; q restores recency", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "x\n");
    // Empty: complete with no hits → n/p/RET no-op.
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, '(grep-buffer-complete 1 "no-matches" nil)');
    e(editor, "(editor/commands/grep/grep-next)");
    expect(st(editor)).toContain("no hits");
    // With hits: n wraps.
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 2 ${hit("a", 1, 1, "one")})`);
    e(editor, `(grep-buffer-append-hit 2 ${hit("b", 1, 1, "two")})`);
    e(editor, '(grep-buffer-complete 2 "done" nil)');
    e(editor, "(cursor-move 0 0)");
    e(editor, "(editor/commands/grep/grep-next)");
    e(editor, "(editor/commands/grep/grep-next)");
    expect(st(editor)).toContain("1 of 2"); // wrapped
    // g re-runs (a rerun that registers a fresh generation).
    const rerunBody = '(lambda () (grep-buffer-register (hashmap "backend" "test" "pattern" "p" "scope" "." "rerun" (lambda () nil))))';
    e(editor, `(grep-buffer-register ${reg("test", "p", ".", rerunBody)})`);
    e(editor, "(editor/commands/grep/grep-rerun)");
    expect(String(e(editor, "(editor/commands/grep/grep-current-gen-get)").value)).not.toBe("2");
    // q restores the pre-grep buffer.
    e(editor, '(buffer-switch "*scratch*")');
    e(editor, '(buffer-switch "*grep*")');
    e(editor, "(editor/commands/grep/grep-quit)");
    expect(String(e(editor, "(buffer-name)").value)).not.toBe("*grep*");
  });
});
