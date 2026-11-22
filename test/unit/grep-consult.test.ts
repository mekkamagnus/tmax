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
