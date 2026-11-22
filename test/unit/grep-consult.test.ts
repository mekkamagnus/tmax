import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file grep-consult.test.ts
 * @description #311 — the consult layer: the query grammar
 * (left-to-right ##/# rules), the glob translation + match
 * semantics, the debounce threshold + empty/glob statuses, the timer
 * + process invariants (no orphans on ANY exit), and the minibuffer
 * on-input hook lifecycle.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const st = (ed: Editor) => String(e(ed, "(editor-status)").value);

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i311-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "consult alpha\n");
  writeFileSync(join(dir, "b.lisp"), "consult beta\n");
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module editor/commands/grep-consult)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const parse = (q: string) => ({
  pat: String(e(editor, `(nth 0 (editor/commands/grep-consult/grep-consult-parse-query "${q}"))`).value),
  glob: String(e(editor, `(nth 1 (editor/commands/grep-consult/grep-consult-parse-query "${q}"))`).value),
});

describe("#311 — the query grammar (left-to-right)", () => {
  test("'foo#bar#baz' → pattern foo, glob bar#baz (the issue's example)", () => {
    const r = parse("foo#bar#baz");
    expect(r.pat).toBe("foo");
    expect(r.glob).toBe("bar#baz");
  });

  test("'##' is a literal # in the pattern", () => {
    expect(parse("a##b").pat).toBe("a#b");
    expect(["nil","null"].includes(parse("a##b").glob)).toBe(true); // no boundary crossed
  });

  test("no '#' → the whole query is the pattern", () => {
    expect(parse("justaword").pat).toBe("justaword");
  });

  test("glob-side '#' characters are ORDINARY glob chars", () => {
    const r = parse("x#a#b");
    expect(r.pat).toBe("x");
    expect(r.glob).toBe("a#b");
  });
});

describe("#311 — glob translation + match semantics", () => {
  test("* and ? translate; [class] passes through", () => {
    expect(String(e(editor, '(editor/commands/grep-consult/grep-consult-glob->regex "*.tlisp")').value)).toBe("^.*.tlisp$");
    expect(String(e(editor, '(editor/commands/grep-consult/grep-consult-glob->regex "a?c")').value)).toBe("^a.c$");
  });

  test("a file matches ≥1 positive AND no negative", () => {
    // path "src/a.tlisp": *.tlisp positive, !*.lisp negative.
    const m = (path: string, pos: string, neg: string) =>
      e(editor, `(editor/commands/grep-consult/grep-consult-glob-match-p "${path}" (list (list "${pos}") (list "${neg}")))`);
    // NB: a .tlisp file ends in 'lisp' — a *.lisp negative WOULD
    // reject it; use *.md as the rejecting negative.
    expect(["t", "true"].includes(String(m("src/a.tlisp", "^.*.tlisp$", "^.*.md$").value))).toBe(true);
    expect(["t", "true"].includes(String(m("src/b.lisp", "^.*.tlisp$", "^.*.md$").value))).toBe(false); // no positive
    expect(["t", "true"].includes(String(m("src/c.md", "^.*.tlisp$", "^.*.md$").value))).toBe(false); // negated
  });

  test("an empty entry → the 'empty glob' marker; bare ! → noted", () => {
    const empty = String(e(editor, '(nth 2 (editor/commands/grep-consult/grep-consult-parse-globs ""))').value);
    expect(empty).toBe("empty");
    const bang = String(e(editor, '(nth 2 (editor/commands/grep-consult/grep-consult-parse-globs "!"))').value);
    expect(bang).toContain("ignored");
  });
});

describe("#311 — the timer + process invariants", () => {
  test("run-with-idle-timer fires; cancel-idle-timer cancels; the count drains", async () => {
    e(editor, "(defvar c311 nil)");
    e(editor, '(defun c311-cb () (setq c311 t))');
    e(editor, "(setq c311 nil)");
    const id = Number(e(editor, '(run-with-idle-timer 40 "c311-cb")').value);
    expect(Number.isFinite(id)).toBe(true);
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("1");
    // Cancel before fire.
    e(editor, `(cancel-idle-timer ${id})`);
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
    await new Promise((r) => setTimeout(r, 120));
    expect(String(e(editor, "c311").value)).not.toContain("true");
    // Idempotent cancel of a fired/unknown id.
    expect(String(e(editor, `(cancel-idle-timer ${id})`).value)).toContain("t");
  });

  test("a fired timer runs the callback; the count drains", async () => {
    e(editor, "(defvar c311b nil)");
    e(editor, '(defun c311b-cb () (setq c311b t))');
    e(editor, "(setq c311b nil)");
    e(editor, '(run-with-idle-timer 30 "c311b-cb")');
    await new Promise((r) => setTimeout(r, 120));
    expect(String(e(editor, "c311b").value)).toContain("true");
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
  });
});

describe("#311 — the on-input state machine", () => {
  const state = () => e(editor, "(editor/commands/grep-consult/grep-consult-state-get)").value;

  test("below threshold (<2 chars, no glob): no timer armed, the revert status", () => {
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, "(editor/commands/grep-consult/grep-consult-on-input \"a\")");
    expect(st(editor)).toContain("type more");
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
  });

  test("empty query: the 'empty pattern' status, no timer", () => {
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "")');
    expect(st(editor)).toContain("empty pattern");
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
  });

  test("empty glob side: the 'empty glob' status, no timer", () => {
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "abc#")');
    expect(st(editor)).toContain("empty glob");
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
  });

  test("a VALID query arms the 200ms debounce; the state records it", () => {
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consult")');
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("1");
    // The session is live (non-nil).
    expect(["nil", "null"].includes(String((state() as { value?: unknown }).value))).toBe(false);
  });

  test("glob-only ALSO debounces at 200ms (the search still runs)", () => {
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "#*.lisp")');
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("1");
  });

  test("a NEW keystroke cancels the prior timer (exactly one live)", () => {
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "cons")');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consu")');
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("1");
  });

  test("a late callback after teardown drops silently (state nil)", () => {
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, "(editor/commands/grep-consult/grep-consult-test-end)");
    // The hook body with no state → nil, no throw.
    const r = e(editor, '(condition-case nil (progn (editor/commands/grep-consult/grep-consult-on-input "xy") "ok") (error (m) (concat "THREW:" m)))');
    expect(String(r.value)).toContain("ok");
  });

  test("ENTRY end-to-end (gate r1): (grep-consult) opens the truthful prompt; typing streams hits", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    const r = e(editor, '(condition-case nil (progn (editor/commands/grep-consult/grep-consult) "ok") (error (m) (concat "THREW:" m)))');
    expect(String(r.value)).toContain("ok");
    const mb = (editor.getState() as unknown as { minibufferView?: { prompt?: string } }).minibufferView;
    expect(mb?.prompt ?? "").toContain("grep (rg) ");
    expect(mb?.prompt ?? "").toContain(": ");
    // Type through the minibuffer → the on-input hook debounces → hits.
    for (const key of "consult") await editor.handleKey(key);
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("1");
    for (let i = 0; i < 240; i++) {
      const s2 = st(editor);
      if (s2.includes("hits") || s2.includes("no matches")) break;
      await new Promise((r2) => setTimeout(r2, 25));
    }
    expect(st(editor)).toContain("2 hits");
    // The completedSnapshot was WRITTEN (only completion writes it) —
    // gate r2: the old line here evaluated the getter and asserted
    // NOTHING (a no-op pin).
    const snap = e(editor, '(hashmap-get (editor/commands/grep-consult/grep-consult-state-get) "completedSnapshot")').value;
    expect(Number(snap)).toBeGreaterThanOrEqual(1);
    const snapContent = e(editor, '(hashmap-get (editor/commands/grep-consult/grep-consult-state-get) "snapshotContent")').value;
    expect(String(snapContent)).toContain("consult alpha");
    // Accept via Enter — through the REAL accept path (gate r2: Enter
    // used to land via the *grep* keymap's grep-ret, leaving the
    // prompt zombified; mode/count assertions were zombie-compatible).
    await editor.handleKey("Enter");
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("normal");
    expect((editor.getState() as unknown as { minibufferView?: unknown }).minibufferView ?? null).toBe(null);
    expect(["nil", "null"].includes(String(e(editor, "(editor/commands/grep-consult/grep-consult-state-get)").value))).toBe(true);
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
  });

  test("C-g through the REAL minibuffer cancels: timer dead, session cleared (gate r1's dead-code finding)", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult)');
    for (const key of "cons") await editor.handleKey(key);
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("1");
    await editor.handleKey("Escape");
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("normal");
    // The every-close teardown ran: the timer is DEAD (the armed
    // 200ms timer no longer fires a post-close search).
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
    // gate r2 (B5): the cancel CONTRACT ran — the session vars cleared.
    expect(["nil", "null"].includes(String(e(editor, "(editor/commands/grep-consult/grep-consult-state-get)").value))).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
  });

  test("INCREMENTAL RESTART (gate r2): after a completed fire the prompt STAYS live and a SECOND search runs", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult)');
    for (const key of "consult") await editor.handleKey(key);
    for (let i = 0; i < 240; i++) {
      if (st(editor).includes("hits")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(st(editor)).toContain("2 hits");
    const gen1 = Number(e(editor, "(editor/commands/grep/grep-current-gen-get)").value);
    expect(gen1).toBeGreaterThanOrEqual(1);
    // The prompt is NOT a zombie: mx owns the keys, the input shows,
    // the session is live (gate r2: the render used to stomp the
    // mode to normal mid-prompt — 'u' ran undo, edits hit the file).
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("mx");
    const mb = (editor.getState() as unknown as { minibufferView?: { input?: string } }).minibufferView;
    expect(mb?.input ?? "").toBe("consult");
    // Type ONE more char: the input grows, the debounce re-arms.
    await editor.handleKey("a");
    const mb2 = (editor.getState() as unknown as { minibufferView?: { input?: string } }).minibufferView;
    expect(mb2?.input ?? "").toBe("consulta");
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("1");
    // The SECOND search RUNS (a new generation registers — the
    // headline incremental-restart loop).
    for (let i = 0; i < 240; i++) {
      if (Number(e(editor, "(editor/commands/grep/grep-current-gen-get)").value) > gen1) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(Number(e(editor, "(editor/commands/grep/grep-current-gen-get)").value)).toBeGreaterThan(gen1);
    // Enter accepts through the REAL accept path: the prompt CLOSES
    // and the session clears (not grep-ret via the *grep* keymap).
    await editor.handleKey("Enter");
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("normal");
    expect((editor.getState() as unknown as { minibufferView?: unknown }).minibufferView ?? null).toBe(null);
    expect(["nil", "null"].includes(String(e(editor, "(editor/commands/grep-consult/grep-consult-state-get)").value))).toBe(true);
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
  });

  test("ESCAPE after a completed fire (gate r2): the cancel path RUNS — state cleared, *grep* STAYS (snapshot)", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult)');
    for (const key of "consult") await editor.handleKey(key);
    for (let i = 0; i < 240; i++) {
      if (st(editor).includes("hits")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(st(editor)).toContain("2 hits");
    await editor.handleKey("Escape");
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("normal");
    expect(["nil", "null"].includes(String(e(editor, "(editor/commands/grep-consult/grep-consult-state-get)").value))).toBe(true);
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
    // A completed search's results SURVIVE cancel (the snapshot rule).
    expect(String(e(editor, '(member "*grep*" (buffer-list))').value)).not.toMatch(/^(nil|null|false)$/);
  });

  test("CANCEL contract (gate r2): with *grep* live and NO completed snapshot, cancel KILLS the results buffer", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consult")');
    for (let i = 0; i < 240; i++) {
      if (st(editor).includes("hits")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(st(editor)).toContain("2 hits"); // *grep* exists with content
    // Reset the session (fresh state: NO snapshot recorded) while
    // *grep* stays — the cancel contract's kill branch.
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-cancel)');
    expect(["nil", "null"].includes(String(e(editor, "(editor/commands/grep-consult/grep-consult-state-get)").value))).toBe(true);
    expect(String(e(editor, '(member "*grep*" (buffer-list))').value)).toMatch(/^(nil|null|false)$/);
  });

  test("RESTORE-SNAPSHOT rule (gate r2): a replaced *grep* render restores the completed content on next input", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consult")');
    for (let i = 0; i < 240; i++) {
      if (st(editor).includes("hits")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(st(editor)).toContain("2 hits");
    const completed = String(e(editor, '(editor/commands/grep/grep-buffer-content)').value);
    expect(completed).toContain("consult alpha");
    // Simulate a pending stream having replaced the render.
    e(editor, '(editor/commands/grep/grep-restore-content "PARTIAL STREAM")');
    expect(String(e(editor, '(editor/commands/grep/grep-buffer-content)').value)).toContain("PARTIAL STREAM");
    // The next input RESTORES the completed render synchronously (a
    // killed partial never stays on screen). One char: below the
    // threshold — no timer arms, no race.
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "x")');
    expect(String(e(editor, '(editor/commands/grep/grep-buffer-content)').value)).toBe(completed);
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
  });

  test("ALL glob entries ignored (gate r2): NO filtering — the search runs on ALL files + the note", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consult#!")');
    let sawNote = false;
    let sawHits = false;
    for (let i = 0; i < 300; i++) {
      const s = st(editor);
      if (s.includes("glob entries ignored")) sawNote = true;
      if (s.includes("hits")) sawHits = true;
      if (sawNote && sawHits) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    // BOTH files searched (the inverted zero-files behavior is gone).
    expect(sawHits).toBe(true);
    expect(st(editor)).toContain("2 hits");
    // The status note flashed at fire time.
    expect(sawNote).toBe(true);
  });

  test("GLOB FILTERING applied: #*.lisp runs rg on the .lisp file ONLY (gate r1)", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consult#*.lisp")');
    for (let i = 0; i < 240; i++) {
      const s2 = st(editor);
      if (s2.includes("hits") || s2.includes("no matches") || s2.includes("no files")) break;
      await new Promise((r2) => setTimeout(r2, 25));
    }
    expect(st(editor)).toContain("1 hits"); // only b.lisp
    e(editor, '(buffer-switch "*grep*")');
    const v = strip(bufferText(editor));
    expect(v).toContain("b.lisp");
    expect(v).not.toContain("a.txt");
  });

  test("ZERO files after glob filtering: NO process, the named status", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consult#*.nomatch")');
    for (let i = 0; i < 120; i++) {
      const s2 = st(editor);
      if (s2.includes("no files")) break;
      await new Promise((r2) => setTimeout(r2, 25));
    }
    expect(st(editor)).toContain("no files match glob filters");
  });

  test("the debounce FIRES: the search runs, hits land in *grep*", async () => {
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consult")');
    // The fire happens via the timer (200ms).
    for (let i = 0; i < 240; i++) {
      const s = st(editor);
      if (s.includes("hits") || s.includes("no matches") || s.includes("error")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(st(editor)).toContain("2 hits");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("consult alpha");
  });
});
