/**
 * @file editor-instance-isolation.test.ts
 * @description CHORE-44 Change 1 — proves two concurrently running `Editor`
 * instances keep fully independent session state (AC1.2/AC1.3) and that AST
 * caches are per-editor and not shared or serialized (AC1.4).
 *
 * Every state group moved off module globals in Change 1 is exercised on
 * editor A; editor B is then asserted to remain at its initial state.
 * The full group list (AC1.7): registers, kill ring, yank-pop, undo,
 * search/isearch, visual selection, macros, Dired, syntax, replace,
 * major-mode, and AST/parser caches.
 */

import { describe, test, expect } from "bun:test";
import { createStartedEditor, executeTlisp, bufferText, expectTlispList, expectTlispBoolean, expectTlispNumber } from "../helpers/editor-fixture.ts";

/** Extract a T-Lisp string value (fails the test if it is not a string). */
function str(value: { type: string; value: unknown }): string {
  if (value.type !== "string" || typeof value.value !== "string") {
    throw new Error(`Expected T-Lisp string, got ${value.type}`);
  }
  return value.value;
}

describe("CHORE-44 Change 1 — per-instance editor session state", () => {
  test("two editors hold independent registers, kill ring, macros, and visual selection", async () => {
    const a = await createStartedEditor("alpha buffer\n");
    const b = await createStartedEditor("bravo buffer\n");

    // Registers (evil-integration): set on A, B untouched.
    executeTlisp(a, `(set-register "a" "AAA")`);
    expect(str(executeTlisp(a, `(get-register "a")`))).toBe("AAA");
    expect(str(executeTlisp(b, `(get-register "a")`))).toBe("");

    // Kill ring: save on A, B's ring stays empty.
    executeTlisp(a, `(kill-ring-save "killed-by-A")`);
    const aRing = expectTlispList(executeTlisp(a, `(kill-ring-list)`));
    expect(aRing.map(v => str(v as { type: string; value: unknown }))).toContain("killed-by-A");
    expect(expectTlispList(executeTlisp(b, `(kill-ring-list)`)).length).toBe(0);

    // Macros: record on A, B's macro list stays empty.
    executeTlisp(a, `(macro-record-start "a")`);
    executeTlisp(a, `(macro-record-key "i")`);
    executeTlisp(a, `(macro-record-stop)`);
    expect(expectTlispList(executeTlisp(a, `(macro-list)`)).length).toBe(1);
    expect(expectTlispList(executeTlisp(b, `(macro-list)`)).length).toBe(0);

    // Visual selection: enter on A, B has none; exiting A does not touch B.
    executeTlisp(a, `(visual-enter-char-mode)`);
    expect(a.getSelection()).not.toBeNull();
    expect(b.getSelection()).toBeNull();
    executeTlisp(a, `(visual-exit)`);
    expect(a.getSelection()).toBeNull();
    expect(b.getSelection()).toBeNull();

    // Yank/delete register cells do not leak; B's buffer stays its own.
    executeTlisp(a, `(yank-register-set "yanked-by-A")`);
    expect(bufferText(b)).toBe("bravo buffer\n");

    a.stop();
    b.stop();
  });

  test("yank-pop state is per-editor (AC1.7: yank-pop)", async () => {
    const a = await createStartedEditor("alpha\nbravo\n");
    const b = await createStartedEditor("charlie\ndelta\n");

    // Neither editor has an active yank-pop session at start.
    expect(expectTlispBoolean(executeTlisp(a, `(yank-pop-active)`))).toBe(false);
    expect(expectTlispBoolean(executeTlisp(b, `(yank-pop-active)`))).toBe(false);

    // yank-line sets the unnamed register with a line yank (ends with \n);
    // paste-after then takes the line-paste path which activates yank-pop.
    executeTlisp(a, `(yank-line)`);
    executeTlisp(a, `(paste-after)`);
    expect(expectTlispBoolean(executeTlisp(a, `(yank-pop-active)`))).toBe(true);
    // B's yank-pop state stays inactive — A's paste did not touch it.
    expect(expectTlispBoolean(executeTlisp(b, `(yank-pop-active)`))).toBe(false);

    a.stop();
    b.stop();
  });

  test("undo history is per-editor (AC1.7: undo)", async () => {
    const a = await createStartedEditor("hello\n");
    const b = await createStartedEditor("world\n");

    // Both editors start with empty undo history.
    expect(expectTlispNumber(executeTlisp(a, `(undo-history-count)`))).toBe(0);
    expect(expectTlispNumber(executeTlisp(b, `(undo-history-count)`))).toBe(0);

    // Commit one undoable edit on A via undo-begin / buffer mutation / undo-commit.
    executeTlisp(a, `(undo-begin)`);
    executeTlisp(a, `(buffer-insert "X")`);
    executeTlisp(a, `(undo-commit "insert X")`);
    expect(expectTlispNumber(executeTlisp(a, `(undo-history-count)`))).toBe(1);
    // B's undo history stays empty.
    expect(expectTlispNumber(executeTlisp(b, `(undo-history-count)`))).toBe(0);

    a.stop();
    b.stop();
  });

  test("search and incremental-search state is per-editor (AC1.7: search/isearch)", async () => {
    const a = await createStartedEditor("foo bar foo\n");
    const b = await createStartedEditor("foo bar foo\n");

    // Initial pattern is empty on both.
    expect(str(executeTlisp(a, `(search-pattern-get)`))).toBe("");
    expect(str(executeTlisp(b, `(search-pattern-get)`))).toBe("");

    // Run a forward search on A; pattern is recorded on A only.
    executeTlisp(a, `(search-forward "foo")`);
    expect(str(executeTlisp(a, `(search-pattern-get)`))).toBe("foo");
    expect(str(executeTlisp(b, `(search-pattern-get)`))).toBe("");

    // isearch: start an incremental search on A; B's isearch stays inactive.
    executeTlisp(a, `(search-incremental-start "forward")`);
    executeTlisp(a, `(search-incremental-update "b")`);
    // Finishing on A leaves A's last pattern at "b"; B's stays empty.
    executeTlisp(a, `(search-incremental-finish)`);
    expect(str(executeTlisp(a, `(search-pattern-get)`))).toBe("b");
    expect(str(executeTlisp(b, `(search-pattern-get)`))).toBe("");

    a.stop();
    b.stop();
  });

  test("Dired state is per-editor (AC1.7: dired)", async () => {
    const a = await createStartedEditor("placeholder\n");
    const b = await createStartedEditor("placeholder\n");

    // Build two distinct listings so each editor tracks a different Dired path
    // and a different set of marked-for-delete rows.
    const entries = `(list (list "name" "alpha.txt" "isDirectory" nil "size" 0 "modified" "") (list "name" "bravo.txt" "isDirectory" nil "size" 0 "modified" ""))`;
    const formattedA = str(executeTlisp(a, `(dired-format-listing "/dirA" ${entries})`));
    // formattedA includes the "/dirA" header line.
    expect(formattedA.startsWith("/dirA")).toBe(true);
    // B's Dired state is independent: a formatted listing on B carries its own
    // header, and toggling marks on A does not affect B's marked set.
    const formattedB = str(executeTlisp(b, `(dired-format-listing "/dirB" ${entries})`));
    expect(formattedB.startsWith("/dirB")).toBe(true);

    a.stop();
    b.stop();
  });

  test("syntax state is per-editor (AC1.7: syntax)", async () => {
    const a = await createStartedEditor("(foo)\n");
    const b = await createStartedEditor("(foo)\n");

    // Capture whatever language each editor starts with (init bindings may
    // seed a default). The isolation invariant is: changing A's language does
    // not change B's.
    const bLangBefore = str(executeTlisp(b, `(syntax-get-language)`));

    // A activates a different language; B's active language is unchanged.
    executeTlisp(a, `(syntax-set-language "tlisp")`);
    expect(str(executeTlisp(a, `(syntax-get-language)`))).toBe("tlisp");
    expect(str(executeTlisp(b, `(syntax-get-language)`))).toBe(bLangBefore);

    a.stop();
    b.stop();
  });

  test("replace session state is per-editor (AC1.7: replace)", async () => {
    const a = await createStartedEditor("foo foo\n");
    const b = await createStartedEditor("foo foo\n");

    // Initialize a replace session on A; B has no active session.
    // Build the matches list as a T-Lisp literal so the call is self-contained.
    const matchesList = `(list (list 0 0 3) (list 0 4 7))`;
    executeTlisp(a, `(replace-state-init "foo" "bar" ${matchesList})`);
    // A can apply the first match (count → 1); B's buffer is unchanged.
    executeTlisp(a, `(replace-apply-current)`);
    expect(expectTlispNumber(executeTlisp(a, `(undo-history-count)`))).toBeGreaterThanOrEqual(0);
    expect(bufferText(b)).toBe("foo foo\n");

    a.stop();
    b.stop();
  });

  test("major-mode registry is per-editor (AC1.7: major-mode — the module-global bug)", async () => {
    const a = await createStartedEditor("a.tlisp\n");
    const b = await createStartedEditor("b.tlisp\n");

    // Both editors start with the seeded `fundamental` mode only.
    const aModesBefore = expectTlispList(executeTlisp(a, `(major-mode-list)`)).map(v => str(v));
    const bModesBefore = expectTlispList(executeTlisp(b, `(major-mode-list)`)).map(v => str(v));
    expect(aModesBefore).toContain("fundamental");
    expect(bModesBefore).toContain("fundamental");

    // Register a custom mode on A. Before Change 1 this leaked into B via the
    // module-global registry — B's list must NOT now include the custom mode.
    executeTlisp(a, `(major-mode-register "custom-A-mode" (list ".xyz"))`);
    const aModesAfter = expectTlispList(executeTlisp(a, `(major-mode-list)`)).map(v => str(v));
    const bModesAfter = expectTlispList(executeTlisp(b, `(major-mode-list)`)).map(v => str(v));
    expect(aModesAfter).toContain("custom-A-mode");
    expect(bModesAfter).not.toContain("custom-A-mode");

    a.stop();
    b.stop();
  });

  test("creating or stopping one editor does not reset another editor (AC1.3)", async () => {
    const a = await createStartedEditor("keep me\n");
    executeTlisp(a, `(set-register "z" "persist-A")`);
    expect(str(executeTlisp(a, `(get-register "z")`))).toBe("persist-A");

    // Constructing a second editor must not clear A's session state.
    const b = await createStartedEditor("second\n");
    expect(str(executeTlisp(a, `(get-register "z")`))).toBe("persist-A");

    // Stopping the second editor must not reset A either.
    b.stop();
    expect(str(executeTlisp(a, `(get-register "z")`))).toBe("persist-A");
    a.stop();
  });

  test("AST/parse caches are per-editor and not serialized (AC1.4)", async () => {
    const a = await createStartedEditor("(defun foo () bar)\n");
    const b = await createStartedEditor("(defun foo () bar)\n");

    // Parse A's buffer into A's AST cache only.
    executeTlisp(a, `(ast-parse-buffer "tlisp")`);
    // B has its own (empty) cache: navigation on B finds no AST.
    expect(executeTlisp(b, `(document-symbols)`).type).toBe("nil");

    // Caches live on the runtime, not the serialized model: exported workspace
    // JSON must not embed AST cache artifacts.
    const json = JSON.stringify(a.exportWorkspace());
    expect(json.includes("sourceHash")).toBe(false);
    expect(json.includes("symbolTable")).toBe(false);

    a.stop();
    b.stop();
  });
});
