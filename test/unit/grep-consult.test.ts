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
  test("* and ? translate (newline-inclusive); [class] passes through; literals CLASS-ESCAPED (valve r2/r5)", () => {
    // valve r5: [^]* — the negated-empty class — because JS's . does
    // NOT match newlines and fnmatch's * does.
    expect(String(e(editor, '(editor/commands/grep-consult/grep-consult-glob->regex "*.tlisp")').value)).toBe("^[^]*[.]tlisp$");
    expect(String(e(editor, '(editor/commands/grep-consult/grep-consult-glob->regex "a?c")').value)).toBe("^a[^]c$");
    expect(String(e(editor, '(editor/commands/grep-consult/grep-consult-glob->regex "a.txt")').value)).toBe("^a[.]txt$");
    expect(String(e(editor, '(editor/commands/grep-consult/grep-consult-glob->regex "x[a-c]y")').value)).toBe("^x[a-c]y$");
  });

  test("'*' matches a NEWLINE in the filename (valve r5 — the NUL enumeration preserved it)", () => {
    const r = e(editor, '(condition-case nil (editor/commands/grep-consult/grep-consult-glob-match-p "we\\nird.lisp" (editor/commands/grep-consult/grep-consult-parse-globs "*.lisp")) (error (m) (concat "THREW:" m)))');
    expect(["t", "true"].includes(String(r.value))).toBe(true);
  });

  test("the escaped dot is LITERAL: '*.tlisp' does NOT match 'Xtlisp' (valve r2's repro)", () => {
    const m = (path: string, glob: string) =>
      e(editor, `(editor/commands/grep-consult/grep-consult-glob-match-p "${path}" (list (list (editor/commands/grep-consult/grep-consult-glob->regex "${glob}")) (list)))`);
    expect(["t", "true"].includes(String(m("src/b.tlisp", "*.tlisp").value))).toBe(true);
    expect(["t", "true"].includes(String(m("src/Xtlisp", "*.tlisp").value))).toBe(false);
    expect(["t", "true"].includes(String(m("a.txt", "a.txt").value))).toBe(true);
    expect(["t", "true"].includes(String(m("aXtxt", "a.txt").value))).toBe(false);
  });

  test("untranslatable: bare ^, backslash, empty class [], unterminated class, INVALID class → nil", () => {
    const tr = (g: string) => String(e(editor, `(editor/commands/grep-consult/grep-consult-glob->regex "${g}")`).value);
    expect(["nil", "null"].includes(tr("a^b"))).toBe(true);
    expect(["nil", "null"].includes(tr("[]"))).toBe(true);
    expect(["nil", "null"].includes(tr("[ab"))).toBe(true);
    // valve r3: syntactically closed but invalid — the compile-probe
    // rejects (used to pass and silently no-match at match time).
    expect(["nil", "null"].includes(tr("a[z-a]b"))).toBe(true);
  });

  test("NEGATIVES-ONLY matches everything not negated (valve r2 — the issue's combination clause)", () => {
    // parse "!*.md" → positives empty, negatives [^.*[.]md$].
    const parsed = e(editor, '(editor/commands/grep-consult/grep-consult-parse-globs "!*.md")').value as unknown[];
    const m = (path: string) =>
      e(editor, `(editor/commands/grep-consult/grep-consult-glob-match-p "${path}" (editor/commands/grep-consult/grep-consult-parse-globs "!*.md"))`);
    expect(["t", "true"].includes(String(m("src/a.tlisp").value))).toBe(true); // not negated
    expect(["t", "true"].includes(String(m("src/b.md").value))).toBe(false); // negated
  });

  test("a valid negative + an ignored entry ('!*.lisp,!') is NOT the all-ignored case", () => {
    const r = e(editor, '(editor/commands/grep-consult/grep-consult-parse-globs "!*.lisp,!")').value as unknown[];
    const pos = e(editor, '(length (nth 0 (editor/commands/grep-consult/grep-consult-parse-globs "!*.lisp,!")))').value;
    const neg = e(editor, '(length (nth 1 (editor/commands/grep-consult/grep-consult-parse-globs "!*.lisp,!")))').value;
    expect(Number(neg)).toBe(1); // the valid negative survived
    const m = (path: string) =>
      e(editor, `(editor/commands/grep-consult/grep-consult-glob-match-p "${path}" (editor/commands/grep-consult/grep-consult-parse-globs "!*.lisp,!"))`);
    expect(["t", "true"].includes(String(m("a.txt").value))).toBe(true); // not negated → matches
    expect(["t", "true"].includes(String(m("b.lisp").value))).toBe(false); // negated
  });

  test("a file matches ≥1 positive AND no negative", () => {
    // path "src/a.tlisp": *.tlisp positive, !*.md negative.
    const m = (path: string, pos: string, neg: string) =>
      e(editor, `(editor/commands/grep-consult/grep-consult-glob-match-p "${path}" (list (list "${pos}") (list "${neg}")))`);
    // NB: a .tlisp file ends in 'lisp' — a *.lisp negative WOULD
    // reject it; use *.md as the rejecting negative.
    expect(["t", "true"].includes(String(m("src/a.tlisp", "^.*[.]tlisp$", "^.*[.]md$").value))).toBe(true);
    expect(["t", "true"].includes(String(m("src/b.lisp", "^.*[.]tlisp$", "^.*[.]md$").value))).toBe(false); // no positive
    expect(["t", "true"].includes(String(m("src/c.md", "^.*[.]tlisp$", "^.*[.]md$").value))).toBe(false); // negated
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

  test("run-with-idle-timer accepts a LAMBDA (valve r5 — the spec's <fn>)", async () => {
    e(editor, "(defvar c311c nil)");
    e(editor, "(setq c311c nil)");
    const r = e(editor, '(condition-case nil (progn (run-with-idle-timer 30 (lambda () (setq c311c t))) "ok") (error (m) (concat "THREW:" m)))');
    expect(String(r.value)).toBe("ok");
    await new Promise((res) => setTimeout(res, 120));
    expect(String(e(editor, "c311c").value)).toContain("true");
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

  test("CANDIDATE NAVIGATION (valve r2): Up/Down select hits IN THE PROMPT; the echo shows it; RET jumps to the SELECTED hit", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult)');
    for (const key of "consult") await editor.handleKey(key);
    for (let i = 0; i < 240; i++) {
      if (st(editor).includes("hits")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(st(editor)).toContain("2 hits");
    // The candidates ARE the hits: the prompt shows rows (valve r2
    // found the table always empty — Up/Down selected nothing).
    const rows0 = (editor.getState() as unknown as { minibufferView?: { rows?: { selected?: boolean; segments?: { text?: string }[] }[] } }).minibufferView?.rows ?? [];
    expect(rows0.length).toBe(2);
    // valve r4: ORDER-AGNOSTIC — find the b.lisp row's index (rg's
    // file order is not contractual), press Down until IT is
    // selected (from the raw-prompt selection -1: idx+1 presses).
    const rowText = (r: { segments?: { text?: string }[] }) => (r.segments ?? []).map((s) => s.text ?? "").join("");
    const bIdx = rows0.findIndex((r) => rowText(r).includes("b.lisp"));
    expect(bIdx).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < bIdx + 1; i++) await editor.handleKey("Down");
    const rows1 = (editor.getState() as unknown as { minibufferView?: { rows?: { selected?: boolean }[] } }).minibufferView?.rows ?? [];
    expect(rows1[bIdx]?.selected).toBe(true);
    expect(st(editor)).toContain("b.lisp");
    // RET jumps to the SELECTED hit (b.lisp — not the top hit).
    await editor.handleKey("Enter");
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("normal");
    const cur = String(e(editor, "(buffer-current)").value);
    expect(cur).toContain("b.lisp");
  });

  test("SCOPE cwd (valve r2): launched BELOW the project root, glob file-list searches still resolve (rg runs with :cwd scope)", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    const below = join(process.cwd(), "below");
    execFileSync("mkdir", ["-p", below]);
    process.chdir(below);
    const ed2 = await createStartedEditor("");
    ed2.setClientLaunchDir(below);
    e(ed2, "(require-module editor/commands/grep-consult)");
    e(ed2, '(editor/commands/grep-consult/grep-consult)');
    // The scope resolves to the project ROOT; the glob query forces
    // the file-list variant (root-relative paths + :cwd scope).
    for (const key of "consult#*.lisp") await ed2.handleKey(key);
    for (let i = 0; i < 240; i++) {
      if (st(ed2).includes("hits") || st(ed2).includes("no matches") || st(ed2).includes("error")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(st(ed2)).toContain("1 hits"); // b.lisp from the root
    // valve r3: GLOB-QUERY CANDIDATES — the consult style filters the
    // PATTERN side; the prompt shows rows (the default style zeroed
    // them on the raw '#*.lisp' input).
    const rows = (ed2.getState() as unknown as { minibufferView?: { rows?: unknown[] } }).minibufferView?.rows ?? [];
    expect(rows.length).toBe(1);
  });

  test("QUOTEPATH (valve r3): a non-ASCII filename is enumerated RAW (core.quotepath=false)", async () => {
    writeFileSync(join(process.cwd(), "é.lisp"), "consult unicode\n");
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consult#*.lisp")');
    for (let i = 0; i < 240; i++) {
      if (st(editor).includes("hits") || st(editor).includes("no files")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    // BOTH .lisp files — é.lisp enumerated unquoted (was: git's
    // octal-escaped form missed the glob).
    expect(st(editor)).toContain("2 hits");
  });

  test("IGNORED-ENTRY NOTE with valid entries (valve r3): '#*.lisp,!' filters AND notes", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consult#*.lisp,!")');
    // valve r5: wait for HITS only — the note assert rides the
    // durable lastNote record (gating the loop on the TRANSIENT
    // status was the codex-sandbox timeout).
    let sawHits = false;
    for (let i = 0; i < 300; i++) {
      if (st(editor).includes("hits")) { sawHits = true; break; }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(sawHits).toBe(true);
    expect(st(editor)).toContain("1 hits"); // the valid entry still filters
    // …and the note fired (was: all-ignored only) — asserted via the
    // durable lastNote record.
    expect(String(e(editor, '(hashmap-get (editor/commands/grep-consult/grep-consult-state-get) "lastNote")').value)).toContain("glob entry ignored");
  });

  test("ACCEPT during a pending generation (valve r3): the selected candidate resolves against the RESTORED completed hits", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult)');
    for (const key of "consu") await editor.handleKey(key);
    for (let i = 0; i < 240; i++) {
      if (st(editor).includes("hits")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(st(editor)).toContain("2 hits");
    // valve r4: ORDER-AGNOSTIC — the expected target is whatever the
    // TOP hit's file is (rg's file order is not contractual).
    // Captured NOW (the pending generation below empties the list).
    const topFile = String(e(editor, "(nth 0 (nth 0 (editor/commands/grep/grep-hits-get)))").value).split("/").pop() ?? "";
    expect(topFile.length).toBeGreaterThan(0);
    // Extend the query ('consul' still matches both displays) and
    // stall the next fire — a pending gen2 that never completes…
    const shim = join(process.cwd(), "stalled-rg.sh");
    writeFileSync(shim, "#!/bin/sh\nexec sleep 30\n");
    execFileSync("chmod", ["+x", shim]);
    e(editor, `(editor/commands/grep/grep-rg-executable-set! "${shim}")`);
    for (const key of "l") await editor.handleKey(key);
    for (let i = 0; i < 120; i++) {
      if (String(e(editor, "(editor/commands/grep/grep-current-gen-get)").value) !== "1") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    // …then accept. The selected candidate (the prompt's TOP hit —
    // typing resets the selection, vertico-style) was taken against
    // the COMPLETED generation's candidates; accept rolls the
    // pending back FIRST so the value resolves and the jump LANDS
    // (without the rollback the partial's empty hit list broke
    // grep-ret entirely — no jump at all).
    await editor.handleKey("Enter");
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("normal");
    const cur = String(e(editor, "(buffer-current)").value);
    expect(cur).toContain(topFile);
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

  test("FIRST-SEARCH pending + query edit (valve r5): the killed partial's placeholder does not linger", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    // Stall rg; the first search fires and never completes.
    const shim = join(process.cwd(), "stalled-rg.sh");
    writeFileSync(shim, "#!/bin/sh\nexec sleep 30\n");
    execFileSync("chmod", ["+x", shim]);
    e(editor, `(editor/commands/grep/grep-rg-executable-set! "${shim}")`);
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "hello")');
    let searching = false;
    for (let i = 0; i < 120; i++) {
      if (String(e(editor, "(editor/commands/grep/grep-buffer-content)").value).includes("searching")) { searching = true; break; }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(searching).toBe(true);
    // Edit the query below threshold (no completed snapshot exists):
    // the killed partial rolls back to the PRE-REGISTER content —
    // the 'searching…' placeholder no longer lingers on screen.
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "x")');
    const content = String(e(editor, "(editor/commands/grep/grep-buffer-content)").value);
    expect(content).not.toContain("searching");
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
  });

  test("RESTORE rule, STRUCTURAL (valve r2): rollback restores content AND the generation's hits/state", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consult")');
    for (let i = 0; i < 240; i++) {
      if (st(editor).includes("hits")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(st(editor)).toContain("2 hits");
    const completed = String(e(editor, '(editor/commands/grep/grep-buffer-content)').value);
    const gen1 = Number(e(editor, "(editor/commands/grep/grep-current-gen-get)").value);
    // Swap the stalling shim; the next fire registers gen2 and
    // replaces the render — but never completes.
    const shim = join(process.cwd(), "stalled-rg.sh");
    writeFileSync(shim, "#!/bin/sh\nexec sleep 30\n");
    execFileSync("chmod", ["+x", shim]);
    e(editor, `(editor/commands/grep/grep-rg-executable-set! "${shim}")`);
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consulz")');
    for (let i = 0; i < 120; i++) {
      if (String(e(editor, '(editor/commands/grep/grep-buffer-content)').value).includes("searching")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(Number(e(editor, "(editor/commands/grep/grep-current-gen-get)").value)).toBeGreaterThan(gen1);
    // The next input kills the pending and rolls the producer BACK:
    // content, hits, AND generation id — RET/navigation then agree
    // with the display (valve r2's structural finding).
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "x")');
    expect(String(e(editor, '(editor/commands/grep/grep-buffer-content)').value)).toBe(completed);
    expect(Number(e(editor, "(editor/commands/grep/grep-current-gen-get)").value)).toBe(gen1);
    const hits = e(editor, "(editor/commands/grep/grep-hits-get)").value as unknown[];
    expect(hits.length).toBe(2);
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
  });

  test("ALL glob entries ignored (gate r2): NO filtering — the search runs on ALL files + the note", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    e(editor, '(editor/commands/grep-consult/grep-consult-test-begin)');
    e(editor, '(editor/commands/grep-consult/grep-consult-on-input "consult#!")');
    // valve r5: wait for HITS only; the note assert rides lastNote.
    let sawHits = false;
    for (let i = 0; i < 300; i++) {
      if (st(editor).includes("hits")) { sawHits = true; break; }
      await new Promise((r) => setTimeout(r, 10));
    }
    // BOTH files searched (the inverted zero-files behavior is gone).
    expect(sawHits).toBe(true);
    expect(st(editor)).toContain("2 hits");
    expect(String(e(editor, '(hashmap-get (editor/commands/grep-consult/grep-consult-state-get) "lastNote")').value)).toContain("glob entries ignored");
  });

  test("CANCEL kill-branch against a REAL live pending process (gate r3): stalled rg, escape kills *grep*", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    // Enter with the REAL rg (the preflight probes it), THEN swap a
    // stalling shim in so the fired search never completes.
    e(editor, '(editor/commands/grep-consult/grep-consult)');
    const shim = join(process.cwd(), "stalled-rg.sh");
    writeFileSync(shim, "#!/bin/sh\nexec sleep 30\n");
    execFileSync("chmod", ["+x", shim]);
    e(editor, `(editor/commands/grep/grep-rg-executable-set! "${shim}")`);
    for (const key of "consu") await editor.handleKey(key);
    // The fire spawns the shim: *grep* holds the placeholder, the
    // pending process lives, NO completion ever lands.
    let searching = false;
    for (let i = 0; i < 120; i++) {
      const c = String(e(editor, "(editor/commands/grep/grep-buffer-content)").value);
      if (c.includes("searching")) { searching = true; break; }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(searching).toBe(true);
    expect(String(e(editor, '(member "*grep*" (buffer-list))').value)).not.toMatch(/^(nil|null|false)$/);
    // Escape: the cancel contract runs against the REAL pending —
    // process killed, and with NO completed search *grep* DIES.
    await editor.handleKey("Escape");
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("normal");
    expect(["nil", "null"].includes(String(e(editor, "(editor/commands/grep-consult/grep-consult-state-get)").value))).toBe(true);
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
    expect(String(e(editor, '(member "*grep*" (buffer-list))').value)).toMatch(/^(nil|null|false)$/);
    // gate r3: the completion hook is UNSET on close (the read seam
    // makes the no-leak invariant assertable).
    expect(["nil", "null"].includes(String(e(editor, "(editor/commands/grep/grep-completion-hook-get)").value))).toBe(true);
  });

  test("RESTORE rule against a REAL live pending process (gate r3): the killed partial never stays on screen", async () => {
    execFileSync("git", ["-C", process.cwd(), "add", "."]);
    // Complete a real search first (the snapshot source).
    e(editor, '(editor/commands/grep-consult/grep-consult)');
    for (const key of "consult") await editor.handleKey(key);
    for (let i = 0; i < 240; i++) {
      if (st(editor).includes("hits")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(st(editor)).toContain("2 hits");
    const completed = String(e(editor, "(editor/commands/grep/grep-buffer-content)").value);
    expect(completed).toContain("consult alpha");
    // Swap the stalling shim; the next fire replaces the render with
    // the placeholder and the pending process never completes.
    const shim = join(process.cwd(), "stalled-rg.sh");
    writeFileSync(shim, "#!/bin/sh\nexec sleep 30\n");
    execFileSync("chmod", ["+x", shim]);
    e(editor, `(editor/commands/grep/grep-rg-executable-set! "${shim}")`);
    for (const key of "zx") await editor.handleKey(key);
    let replaced = false;
    for (let i = 0; i < 120; i++) {
      const c = String(e(editor, "(editor/commands/grep/grep-buffer-content)").value);
      if (c.includes("searching")) { replaced = true; break; }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(replaced).toBe(true);
    // The next input KILLS the pending and restores the completed
    // render synchronously — the partial never stays on screen.
    await editor.handleKey("q");
    expect(String(e(editor, "(editor/commands/grep/grep-buffer-content)").value)).toBe(completed);
    await editor.handleKey("Escape");
    expect(String(e(editor, "(idle-timer-count)").value)).toBe("0");
  });

  test("NON-PROJECT refusal (gate r3): outside a git repo the entry refuses with the SPC s g hint", async () => {
    // A plain dir with files but NO git repo.
    const dir = mkdtempSync(join(tmpdir(), "i311np-"));
    writeFileSync(join(dir, "loose.txt"), "consult gamma\n");
    process.chdir(dir);
    const ed2 = await createStartedEditor("");
    ed2.setClientLaunchDir(dir);
    e(ed2, "(require-module editor/commands/grep-consult)");
    const r = e(ed2, '(condition-case nil (progn (editor/commands/grep-consult/grep-consult) "ok") (error (m) (concat "THREW:" m)))');
    expect(String(r.value)).toContain("ok");
    const mb = (ed2.getState() as unknown as { minibufferView?: { prompt?: string } }).minibufferView;
    expect(mb ?? null).toBe(null); // refused — no prompt opened
    expect(st(ed2)).toContain("not in a project");
    // The refusal is honest: state stayed clean.
    expect(["nil", "null"].includes(String(e(ed2, "(editor/commands/grep-consult/grep-consult-state-get)").value))).toBe(true);
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
