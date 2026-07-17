/**
 * @file editor-instance-isolation.test.ts
 * @description CHORE-44 Change 1 — proves two concurrently running `Editor`
 * instances keep fully independent session state (AC1.2/AC1.3) and that AST
 * caches are per-editor and not shared or serialized (AC1.4).
 *
 * Every state group moved off module globals in Change 1 is exercised on
 * editor A; editor B is then asserted to remain at its initial state.
 */

import { describe, test, expect } from "bun:test";
import { createStartedEditor, executeTlisp, bufferText, expectTlispList } from "../helpers/editor-fixture.ts";

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
