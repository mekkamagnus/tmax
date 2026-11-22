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
    // valve r2: EVERY restored id retires — completing gen 1 drops
    // silently too (re-searching requires a fresh register).
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    expect(String(e(editor, "(editor/commands/grep/grep-status-get)").value)).not.toBe("done");
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

describe("#307 — gate r1 fixes", () => {
  test("the DATA-DESTROYER: a completion landing while ANOTHER buffer is current never touches it", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a.txt", 1, 1, "one")})`);
    // The user switches away mid-search.
    e(editor, '(buffer-create "*work*")');
    e(editor, '(buffer-switch "*work*")');
    e(editor, '(buffer-insert "MY WORK")');
    e(editor, "(cursor-move 0 4)");
    // The async completion + a second hit land HERE.
    e(editor, `(grep-buffer-append-hit 1 ${hit("b.txt", 1, 1, "two")})`);
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    // *work* is INTACT and still current: content byte-identical,
    // read-write, point unchanged.
    expect(String(e(editor, "(buffer-name)").value)).toBe("*work*");
    expect(String(e(editor, "(buffer-text)").value)).toBe("MY WORK");
    const ro = e(editor, "(buffer-read-only-p)");
    expect(String(ro.value)).toBe("false");
    // The results rendered into *grep* correctly.
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("a.txt:1:1:one");
    expect(strip(bufferText(editor))).toContain("b.txt:1:1:two");
  });

  test("CONSECUTIVE rollbacks restore the right generations (pop, not peek)", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("g1.txt", 1, 1, "gen1")})`);
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 2 ${hit("g2.txt", 1, 1, "gen2")})`);
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 3 ${hit("g3.txt", 1, 1, "gen3")})`);
    e(editor, "(grep-buffer-rollback 3)");
    expect(strip(bufferText(editor))).toContain("gen2");
    expect(strip(bufferText(editor))).not.toContain("gen3");
    e(editor, "(grep-buffer-rollback 2)");
    expect(strip(bufferText(editor))).toContain("gen1");
    expect(strip(bufferText(editor))).not.toContain("gen2");
  });

  test("FLOAT line/col refuse; a STRING gen errors", () => {
    expect(() => e(editor, `(grep-buffer-append-hit 1 ${hit("f", 1.5, 1, "t")})`)).toThrow(/line/);
    expect(() => e(editor, `(grep-buffer-append-hit 1 ${hit("f", 1, 2.5, "t")})`)).toThrow(/col/);
    expect(() => e(editor, `(grep-buffer-append-hit "x" ${hit("f", 1, 1, "t")})`)).toThrow(/gen/);
  });

  test("COUNT prefix strides and CONSUMES (2n then bare n moves 1)", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a", 1, 1, "1")})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("b", 1, 1, "2")})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("c", 1, 1, "3")})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("d", 1, 1, "4")})`);
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    e(editor, "(cursor-move 0 0)");
    e(editor, "(count-set 2)");
    e(editor, "(editor/commands/grep/grep-next)");
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(2); // stride 2
    e(editor, "(editor/commands/grep/grep-next)");
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(3); // consumed: stride 1
    expect(st(editor)).toContain("4 of 4");
  });

  test("STREAMING: the point stays on the first hit while hits append", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a", 1, 1, "first")})`);
    e(editor, "(cursor-move 0 0)"); // the user selects hit 1
    e(editor, `(grep-buffer-append-hit 1 ${hit("b", 1, 1, "second")})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("c", 1, 1, "third")})`);
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(0); // STABLE
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(0);
  });

  test("done with a MESSAGE rides as a diagnostic suffix", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, '(grep-buffer-complete 1 "done" "stopped early")');
    const v = strip(bufferText(editor));
    expect(v).toContain("no matches for pat");
    expect(v).toContain("stopped early");
  });

  test("KEYMAP dispatch: Enter/n/g/q through the real keymap", async () => {
    writeFileSync(join(process.cwd(), "k.txt"), "needle\n");
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("k.txt", 1, 1, "needle")})`);
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    e(editor, "(cursor-move 0 0)");
    await editor.handleKey("Enter");
    expect(String(e(editor, "(buffer-name)").value)).toContain("k.txt");
    e(editor, '(buffer-switch "*grep*")');
    await editor.handleKey("n");
    expect(st(editor)).toContain("1 of 1");
    await editor.handleKey("q");
    expect(String(e(editor, "(buffer-name)").value)).not.toBe("*grep*");
  });
});

describe("#307 — gate r2 fixes", () => {
  test("P1: rollback while ANOTHER buffer is current never destroys it", () => {
    e(editor, '(buffer-create "*work2*")');
    e(editor, '(buffer-switch "*work2*")');
    e(editor, '(buffer-insert "PRECIOUS")');
    e(editor, `(grep-buffer-register ${reg()})`); // opens *grep*
    e(editor, '(buffer-switch "*work2*")');
    e(editor, '(grep-buffer-rollback 1)'); // the bottom-out path
    expect(String(e(editor, "(buffer-name)").value)).toBe("*work2*");
    expect(String(e(editor, "(buffer-text)").value)).toBe("PRECIOUS");
  });

  test("P2: done + message + HITS keeps the hits (the suffix rides after)", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a", 1, 1, "one")})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("b", 1, 1, "two")})`);
    e(editor, '(grep-buffer-complete 1 "done" "stopped early")');
    const v = strip(bufferText(editor));
    expect(v).toContain("a:1:1:one");
    expect(v).toContain("b:1:1:two");
    expect(v).toContain("stopped early");
    expect(v).not.toContain("no matches");
  });

  test("P3: bottom-out rollback restores the TRUE pre-register content", () => {
    // Seed *grep* with pre-search content.
    e(editor, '(buffer-create "*grep*")');
    e(editor, '(buffer-switch "*grep*")');
    e(editor, '(buffer-set-read-only nil)');
    e(editor, '(buffer-insert "BEFORE")');
    e(editor, `(grep-buffer-register ${reg()})`); // g1 (saved: BEFORE)
    e(editor, `(grep-buffer-append-hit 1 ${hit("g1", 1, 1, "one")})`);
    e(editor, `(grep-buffer-register ${reg()})`); // g2 (saved: g1's hits)
    e(editor, `(grep-buffer-append-hit 2 ${hit("g2", 1, 1, "two")})`);
    e(editor, "(grep-buffer-rollback 2)"); // → g1
    e(editor, "(grep-buffer-rollback 1)"); // → BOTTOM: the pre-register content
    expect(strip(bufferText(editor))).toBe("BEFORE");
    expect(String(e(editor, "(editor/commands/grep/grep-current-gen-get)").value)).toBe("null");
  });

  test("P5: a streamed append never resets the USER's point in their own buffer", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a", 1, 1, "one")})`);
    e(editor, '(buffer-create "*user*")');
    e(editor, '(buffer-switch "*user*")');
    e(editor, '(buffer-insert "0123456789")');
    e(editor, "(cursor-move 0 7)");
    e(editor, `(grep-buffer-append-hit 1 ${hit("b", 1, 1, "two")})`);
    expect(Number(String(e(editor, "(cursor-column)").value))).toBe(7); // NOT reset
  });

  test("P6: an n/p traversal in *grep* survives a later append", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a", 1, 1, "one")})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("b", 1, 1, "two")})`);
    e(editor, "(editor/commands/grep/grep-next)"); // → hit 2
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(1);
    e(editor, `(grep-buffer-append-hit 1 ${hit("c", 1, 1, "three")})`);
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(1); // STABLE on hit 2
  });

  test("P4: a post-q callback neither throws nor half-applies", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a", 1, 1, "one")})`);
    e(editor, "(editor/commands/grep/grep-quit)");
    // A late complete after q: no throw (the render guards the
    // missing buffer); the transition APPLIES cleanly (q does not
    // retire the generation) — never half-applied.
    expect(() => e(editor, '(grep-buffer-complete 1 "done" nil)')).not.toThrow();
    expect(String(e(editor, "(editor/commands/grep/grep-status-get)").value)).toBe("done");
  });

  test("P7: FLOAT gens error in append/complete/rollback", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    expect(() => e(editor, `(grep-buffer-append-hit 1.5 ${hit("f", 1, 1, "t")})`)).toThrow(/gen/);
    expect(() => e(editor, '(grep-buffer-complete 1.5 "done" nil)')).toThrow(/gen/);
    expect(() => e(editor, "(grep-buffer-rollback 1.5)")).toThrow(/gen/);
  });
});

describe("#307 — valve r1 fixes", () => {
  test("a late completion after q NEVER touches the user's buffer (content/point/ro)", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a", 1, 1, "one")})`);
    e(editor, "(editor/commands/grep/grep-quit)");
    // The user edits elsewhere.
    e(editor, '(buffer-create "*mine*")');
    e(editor, '(buffer-switch "*mine*")');
    e(editor, '(buffer-insert "SAFE")');
    e(editor, "(cursor-move 0 2)");
    e(editor, '(grep-buffer-complete 1 "done" "late")');
    expect(String(e(editor, "(buffer-name)").value)).toBe("*mine*");
    expect(String(e(editor, "(buffer-text)").value)).toBe("SAFE");
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(0);
    const ro = e(editor, "(buffer-read-only-p)");
    expect(String(ro.value)).toBe("false");
  });

  test("the PREVIOUSLY-COMPLETED restored generation accepts NO callbacks", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("g1", 1, 1, "one")})`);
    e(editor, '(grep-buffer-complete 1 "done" nil)'); // g1 COMPLETED
    e(editor, `(grep-buffer-register ${reg()})`); // g2 pushes g1's (completed) snapshot
    e(editor, `(grep-buffer-append-hit 2 ${hit("g2", 1, 1, "two")})`);
    e(editor, "(grep-buffer-rollback 2)"); // restores g1 (previously completed)
    expect(strip(bufferText(editor))).toContain("g1");
    // Its callbacks DROP silently (the restored id is retired).
    e(editor, `(grep-buffer-append-hit 1 ${hit("x", 1, 1, "no")})`);
    const hits = String(e(editor, "(length (editor/commands/grep/grep-hits-get))").value);
    expect(hits).toBe("1"); // unchanged
  });

  test("SNAPSHOT capture reads *grep* even when another buffer is current", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a", 1, 1, "one")})`);
    e(editor, '(buffer-create "*else*")');
    e(editor, '(buffer-switch "*else*")');
    e(editor, '(buffer-insert "NOT THE SNAPSHOT")');
    e(editor, `(grep-buffer-register ${reg()})`); // captures *grep* while *else* current
    e(editor, "(grep-buffer-rollback 2)");
    expect(strip(bufferText(editor))).toContain("a:1:1:one"); // g1's hits — not *else*'s text
    expect(strip(bufferText(editor))).not.toContain("NOT THE SNAPSHOT");
  });
});

describe("#307 — valve r2 fixes", () => {
  test("rollback restores the EXACT display (placeholder/zero-hit/message)", () => {
    // g1 completes with zero hits (a message display); g2 registers;
    // rolling back g2 restores g1's EXACT rendered state.
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, '(grep-buffer-complete 1 "no-matches" nil)');
    const g1Display = strip(bufferText(editor));
    expect(g1Display).toContain("no matches for pat");
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 2 ${hit("g2", 1, 1, "two")})`);
    e(editor, "(grep-buffer-rollback 2)");
    expect(strip(bufferText(editor))).toBe(g1Display);
    // The searching… placeholder round-trips directly: g1 sits at
    // its placeholder (uncompleted), g2 registers over it, rolling
    // g2 back restores the placeholder display verbatim.
    const gA = Number(String(e(editor, "(editor/commands/grep/grep-generation-get)").value)) + 1;
    e(editor, `(grep-buffer-register ${reg()})`); // fresh: searching…
    const searching = strip(bufferText(editor));
    expect(searching).toContain("searching…");
    const gB = gA + 1;
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit ${gB} ${hit("z", 1, 1, "z")})`);
    e(editor, `(grep-buffer-rollback ${gB})`);
    expect(strip(bufferText(editor))).toBe(searching);
  });

  test("the line clamp PRESERVES legitimate trailing blank lines", () => {
    writeFileSync(join(process.cwd(), "blanks.txt"), "one\ntwo\n\n\n");
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("blanks.txt", 99, 1, "x")})`);
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    e(editor, "(cursor-move 0 0)");
    e(editor, "(editor/commands/grep/grep-ret)");
    // 4 content lines (two REAL trailing blanks) + the newline artifact.
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(3); // the last REAL line
  });
});

describe("#307 — valve r3 fixes", () => {
  test("the TEST PRODUCER drives the FULL validation matrix", () => {
    // register via the producer; unknown hit keys error through it.
    const script = `(list (list "register" (hashmap "backend" "t" "pattern" "p" "scope" "." "rerun" (lambda () nil))))`;
    const g = e(editor, `(grep-test-producer ${script})`);
    expect(String(g.value)).toBe("1");
    // Malformed append THROUGH the producer still errors (validation
    // before staleness) — wrap in the producer's dolist.
    const bad = `(list (list "append" 1 (hashmap "file" "f" "line" 1 "col" 1 "text" "t" "bogus" 1)))`;
    expect(() => e(editor, `(grep-test-producer ${bad})`)).toThrow(/bad fields/);
    // A stale malformed callback errors too (not silently dropped).
    const staleBad = `(list (list "append" 99 (hashmap "file" "" "line" 1 "col" 1 "text" "t")))`;
    expect(() => e(editor, `(grep-test-producer ${staleBad})`)).toThrow(/file/);
    // Completed rollback refusal + retired callbacks via the producer.
    const done = `(list (list "complete" 1 "done" nil))`;
    e(editor, `(grep-test-producer ${done})`);
    const rb = `(list (list "rollback" 1))`;
    expect(() => e(editor, `(grep-test-producer ${rb})`)).toThrow(/already complete/);
    const retired = `(list (list "append" 1 (hashmap "file" "f" "line" 1 "col" 1 "text" "x")))`;
    e(editor, `(grep-test-producer ${retired}` + ")"); // silent drop, no error
    expect(String(e(editor, "(length (editor/commands/grep/grep-hits-get))").value)).toBe("0");
  });

  test("EXACT in-range RET landing; PREVIOUS wrap; count stride", () => {
    writeFileSync(join(process.cwd(), "nav.txt"), "alpha\nbeta\ngamma\ndelta\n");
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("nav.txt", 3, 3, "amma")})`);
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    e(editor, "(cursor-move 0 0)");
    e(editor, "(editor/commands/grep/grep-ret)");
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(2); // EXACT line 3
    expect(Number(String(e(editor, "(cursor-column)").value))).toBe(2); // EXACT col 3
    // p wraps: from hit 1, p → wraps (single hit stays).
    e(editor, '(buffer-switch "*grep*")');
    e(editor, "(editor/commands/grep/grep-prev)");
    expect(st(editor)).toContain("1 of 1"); // wrapped to itself
  });

  test("q restores the ACTUAL most-recent buffer (the Editor survivor)", () => {
    // Edit a file LAST (most recent), then open grep from anywhere.
    writeFileSync(join(process.cwd(), "recent.txt"), "recent\n");
    e(editor, '(find-file "recent.txt")');
    e(editor, '(buffer-switch "*scratch*")');
    e(editor, `(grep-buffer-register ${reg()})`); // *grep* current
    e(editor, '(grep-buffer-complete 1 "no-matches" nil)');
    e(editor, "(editor/commands/grep/grep-quit)");
    // The recency-correct survivor: the most-recently-used non-grep buffer.
    const name = String(e(editor, "(buffer-name)").value);
    expect(["recent.txt", "*scratch*"]).toContain(name);
    expect(name).not.toBe("*grep*");
  });

  test("no-matches completing a generation WITH streamed hits keeps them", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a", 1, 1, "one")})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("b", 1, 1, "two")})`);
    e(editor, '(grep-buffer-complete 1 "no-matches" nil)');
    const v = strip(bufferText(editor));
    expect(v).toContain("a:1:1:one");
    expect(v).toContain("b:1:1:two");
    expect(v).toContain("no further matches");
    expect(v).not.toContain("no matches for pat\n");
  });
});

describe("#307 — valve r4 fixes", () => {
  test("an away-render keeps *grep*'s RECORDED selection (return + n resumes there)", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("a", 1, 1, "one")})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("b", 1, 1, "two")})`);
    e(editor, `(grep-buffer-append-hit 1 ${hit("c", 1, 1, "three")})`);
    // STILL STREAMING (no complete yet — a post-completion append
    // would legitimately drop).
    e(editor, "(editor/commands/grep/grep-next)"); // → hit 2
    e(editor, "(editor/commands/grep/grep-next)"); // → hit 3
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(2);
    e(editor, '(buffer-create "*away*")');
    e(editor, '(buffer-switch "*away*")');
    // A late hit lands (the away render).
    e(editor, `(grep-buffer-append-hit 1 ${hit("d", 1, 1, "four")})`);
    // Returning: the recorded selection resumes from hit 3.
    e(editor, '(buffer-switch "*grep*")');
    e(editor, "(editor/commands/grep/grep-next)"); // 3 → 4
    expect(Number(String(e(editor, "(cursor-line)").value))).toBe(3); // hit 4
    expect(st(editor)).toContain("4 of 4");
    e(editor, '(grep-buffer-complete 1 "done" nil)');
  });

  test("p wraps across MULTIPLE hits; count strides BOTH directions", () => {
    e(editor, `(grep-buffer-register ${reg()})`);
    for (const t of ["1", "2", "3", "4"]) {
      e(editor, `(grep-buffer-append-hit 1 ${hit(`f${t}`, 1, 1, t)})`);
    }
    e(editor, '(grep-buffer-complete 1 "done" nil)');
    e(editor, "(cursor-move 0 0)");
    e(editor, "(editor/commands/grep/grep-prev)"); // wraps 1 → 4
    expect(st(editor)).toContain("4 of 4");
    e(editor, "(count-set 2)");
    e(editor, "(editor/commands/grep/grep-prev)"); // 4 - 2 = 2
    expect(st(editor)).toContain("2 of 4");
    e(editor, "(count-set 2)");
    e(editor, "(editor/commands/grep/grep-next)"); // 2 + 2 = 4
    expect(st(editor)).toContain("4 of 4");
  });

  test("q restores ONE specifically expected most-recent buffer", () => {
    writeFileSync(join(process.cwd(), "expected.txt"), "content\n");
    e(editor, '(find-file "expected.txt")'); // most recent
    e(editor, '(buffer-switch "*scratch*")'); // then scratch (older)
    e(editor, `(grep-buffer-register ${reg()})`);
    e(editor, '(grep-buffer-complete 1 "no-matches" nil)');
    e(editor, "(editor/commands/grep/grep-quit)");
    // The Editor's recency survivor picks the most-recently-used
    // non-grep buffer — find-file's touch makes expected.txt the
    // most recent TOUCHED even though scratch was visited last.
    expect(String(e(editor, "(buffer-name)").value)).toBe("expected.txt");
  });

  test("the PRODUCER drives the full lifecycle (register→append→complete→rollback)", () => {
    const mk = `(hashmap "backend" "t" "pattern" "p" "scope" "." "rerun" (lambda () nil))`;
    const g = Number(String(e(editor, `(grep-test-producer (list (list "register" ${mk})))`).value));
    expect(g).toBeGreaterThan(0);
    e(editor, `(grep-test-producer (list (list "append" ${g} ${hit("a", 1, 1, "one")})))`);
    e(editor, `(grep-test-producer (list (list "complete" ${g} "done" nil)))`);
    expect(strip(bufferText(editor))).toContain("a:1:1:one");
    e(editor, `(grep-test-producer (list (list "register" ${mk})))`);
    e(editor, `(grep-test-producer (list (list "rollback" ${g + 1})))`);
    expect(strip(bufferText(editor))).toContain("a:1:1:one"); // restored
  });
});
