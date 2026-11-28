/**
 * @file major-mode-key-precedence.test.ts
 * @description A key bound by the current major mode wins over the global
 *   vim keymap (#368). Global keys still work for keys the mode leaves alone.
 */
import { describe, expect, test } from "bun:test";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

const TIMEOUT_MS = 20000;

describe("major-mode key precedence (#368)", () => {
  for (const key of ["i", "n", "q", "u", "m", "p", "t"]) {
    test(`info mode runs its own "${key}" binding before the vim key`, async () => {
      const editor = await createStartedEditor("hello\nworld");
      executeTlisp(editor, `(defvar probe-hit "")`);
      executeTlisp(editor, `(key-bind "${key}" "(setq probe-hit \\"${key}\\")" "normal" "probe-mode")`);
      executeTlisp(editor, `(major-mode-register "probe-mode" '() nil)`);
      executeTlisp(editor, `(major-mode-set "probe-mode")`);
      await editor.handleKey(key);
      expect(editor.getState().mode).toBe("normal");
      expect((executeTlisp(editor, "probe-hit") as { value: unknown }).value).toBe(key);
    }, TIMEOUT_MS);
  }

  test("a key the major mode does not bind still uses the global binding", async () => {
    const editor = await createStartedEditor("hello\nworld");
    executeTlisp(editor, `(defvar probe-hit "")`);
    executeTlisp(editor, `(major-mode-register "probe-mode" '() nil)`);
    executeTlisp(editor, `(key-bind "n" "(setq probe-hit \\"n\\")" "normal" "probe-mode")`);
    executeTlisp(editor, `(major-mode-set "probe-mode")`);
    await editor.handleKey("j");
    expect(editor.getState().cursorPosition.line).toBe(1);
  }, TIMEOUT_MS);
});
