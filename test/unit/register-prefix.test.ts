/**
 * @file register-prefix.test.ts
 * @description SPEC-044 Phase 2.G — "x register-prefix parser.
 *
 * `"ayy` yanks into register a; `"ap` pastes from a; `"Ayy` appends. The
 * prefix stashes the target register via a T-Lisp defvar (vim-pending-register),
 * consumed by the operator-apply and paste pathways. Pattern mirrors the
 * SPEC-041 stash used for operator+find and operator+text-object.
 */

import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import {
  bufferText,
  createStartedEditor,
  executeTlisp,
} from "../helpers/editor-fixture.ts";

async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

function getRegister(editor: Editor, name: string): string {
  const escaped = name === '"' ? '\\"' : name;
  const value = executeTlisp(editor, `(get-register "${escaped}")`);
  if (value.type === "nil") return "";
  if (value.type === "string") return value.value as string;
  throw new Error(`Register ${name} held unexpected type: ${value.type}`);
}

describe('SPEC-044 Phase 2.G — "x register-prefix parser', () => {
  describe('"ayy — yank into named register', () => {
    test("stores the yanked line in register a (not just the unnamed register)", async () => {
      const editor = await createStartedEditor("hello\nworld");
      await press(editor, '"ayy');
      expect(getRegister(editor, "a")).toBe("hello\n");
      // Unnamed register also receives the yank per vim semantics.
      expect(getRegister(editor, '"')).toBe("hello\n");
    });

    test("does NOT clobber register b", async () => {
      const editor = await createStartedEditor("alpha\nbeta\ngamma");
      await press(editor, '"byy');
      await press(editor, "j");
      await press(editor, '"ayy');
      expect(getRegister(editor, "b")).toBe("alpha\n");
      expect(getRegister(editor, "a")).toBe("beta\n");
    });
  });

  describe('"ap — paste from named register', () => {
    test("pastes from register a instead of the default \"", async () => {
      const editor = await createStartedEditor("first\nsecond");
      // Yank line 1 into a, then default-yank line 2 into ".
      await press(editor, '"ayy');
      await press(editor, "j");
      await press(editor, "yy");
      expect(getRegister(editor, "a")).toBe("first\n");
      expect(getRegister(editor, '"')).toBe("second\n");
      // Move to start of line 1 and paste from a.
      await press(editor, "gg");
      await press(editor, '"ap');
      expect(bufferText(editor)).toBe("first\nfirst\nsecond");
    });

    test("does not permanently overwrite the unnamed register", async () => {
      const editor = await createStartedEditor("xxx\nyyy");
      await press(editor, '"ayy');
      await press(editor, "j");
      await press(editor, "yy");
      const unnamedBefore = getRegister(editor, '"');
      await press(editor, '"ap');
      // After paste-from-a, the unnamed register must still hold the line-2 yank.
      expect(getRegister(editor, '"')).toBe(unnamedBefore);
    });
  });

  describe('"Ayy — append to named register', () => {
    test('appends to register a (uppercase form of "a)', async () => {
      const editor = await createStartedEditor("line1\nline2");
      await press(editor, '"ayy');
      await press(editor, "j");
      await press(editor, '"Ayy');
      expect(getRegister(editor, "a")).toBe("line1\nline2\n");
    });
  });

  describe('count × register composition', () => {
    test("3\"ayw yanks three words into register a", async () => {
      const editor = await createStartedEditor("alpha beta gamma delta");
      await press(editor, '3"ayw');
      // Trailing whitespace is not captured by yank-word today (pre-existing
      // primitive behavior, out of scope for the register-prefix slice).
      // The assertion verifies that count × register composes correctly:
      // three words yanked into the named register.
      expect(getRegister(editor, "a")).toBe("alpha beta gamma");
    });
  });

  describe('cancel register prefix', () => {
    test('"<Escape> cancels without affecting subsequent operations', async () => {
      const editor = await createStartedEditor("hello\nworld");
      await press(editor, '"');
      await press(editor, "Escape");
      // After cancel, a plain yy must yank to the default register.
      await press(editor, "yy");
      expect(getRegister(editor, '"')).toBe("hello\n");
      expect(getRegister(editor, "a")).toBe("");
    });
  });
});
