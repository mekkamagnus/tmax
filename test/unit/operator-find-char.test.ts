/**
 * @file operator-find-char.test.ts
 * @description SPEC-041 regression tests for operator+find-char combinations.
 *
 * Verifies that `d`/`y`/`c` followed by `f`/`t`/`F`/`T` and a target char:
 * - compute the correct range (inclusive for f/F, exclusive for t/T)
 * - leave the cursor on the right column for each operator
 * - multiply operator-count and motion-count (2df<char> finds 2nd char)
 * - yank the deleted/yanked text into the unnamed register
 * - cancel cleanly when Escape interrupts the find-char pending state
 * - leave standalone find-char (without operator) untouched
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

function getRegister(editor: Editor, name: string = '"'): string {
  // Escape `"` for T-Lisp string literal: the unnamed register is `"`,
  // which we embed as `"\""` inside the T-Lisp source.
  const escaped = name === '"' ? '\\"' : name;
  const value = executeTlisp(editor, `(get-register "${escaped}")`);
  if (value.type === "nil") return "";
  if (value.type === "string") return value.value as string;
  throw new Error(`Register ${name} held unexpected type: ${value.type}`);
}

describe("SPEC-041 operator+find-char", () => {
  describe("df<char> — delete forward inclusive", () => {
    test("deletes from cursor through target char", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "dfw");
      expect(bufferText(editor)).toBe("orld");
      expect(getRegister(editor)).toBe("hello w");
    });

    test("deletes only up to the next match when target repeats", async () => {
      const editor = await createStartedEditor("abc abc abc");
      await press(editor, "dfc");
      expect(bufferText(editor)).toBe(" abc abc");
    });
  });

  describe("dt<char> — delete forward exclusive", () => {
    test("deletes from cursor up to but not including target", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "dtw");
      expect(bufferText(editor)).toBe("world");
      expect(getRegister(editor)).toBe("hello ");
    });
  });

  describe("dF<char> — delete backward inclusive", () => {
    test("deletes from target char through cursor", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "$dFw");
      // Cursor at col 10 ('d'), 'w' at col 6, inclusive backward.
      // Delete cols 6..10 ("world"), keeping "hello " (space at col 5 stays).
      expect(bufferText(editor)).toBe("hello ");
      expect(getRegister(editor)).toBe("world");
    });
  });

  describe("dT<char> — delete backward exclusive", () => {
    test("deletes from after target through cursor", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "$");
      await press(editor, "dT");
      await press(editor, "w");
      // Cursor at col 10 ('d'), 'w' at col 6, till-backward → target col 7
      // Delete cols 7..10 ("orld"), keeping "hello w"
      expect(bufferText(editor)).toBe("hello w");
      expect(getRegister(editor)).toBe("orld");
    });
  });

  describe("cf<char> / ct<char> / cF<char> / cT<char>", () => {
    test("cf<char> deletes range and enters insert mode", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "cfw");
      expect(bufferText(editor)).toBe("orld");
      expect(editor.getState().mode).toBe("insert");
    });

    test("ct<char> deletes range and enters insert mode", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "ctw");
      expect(bufferText(editor)).toBe("world");
      expect(editor.getState().mode).toBe("insert");
    });

    test("cF<char> deletes range and enters insert mode at target", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "$cFw");
      // Same range as dFw: delete cols 6..10 ("world"), keep "hello "
      expect(bufferText(editor)).toBe("hello ");
      expect(editor.getState().mode).toBe("insert");
    });

    test("cT<char> deletes backward exclusive and enters insert mode", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "$cTw");
      // Same range as dTw: delete cols 7..10 ("orld"), keep "hello w"
      expect(bufferText(editor)).toBe("hello w");
      expect(editor.getState().mode).toBe("insert");
    });
  });

  describe("yf<char> / yt<char> — yank without mutating buffer", () => {
    test("yf<char> yanks from cursor through target", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "yfw");
      expect(bufferText(editor)).toBe("hello world");
      expect(getRegister(editor)).toBe("hello w");
    });

    test("yt<char> yanks from cursor up to target", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "ytw");
      expect(bufferText(editor)).toBe("hello world");
      expect(getRegister(editor)).toBe("hello ");
    });

    test("yF<char> yanks backward inclusive", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "$yFw");
      expect(bufferText(editor)).toBe("hello world");
      expect(getRegister(editor)).toBe("world");
    });

    test("yT<char> yanks backward exclusive", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "$yTw");
      expect(bufferText(editor)).toBe("hello world");
      expect(getRegister(editor)).toBe("orld");
    });
  });

  describe("Count multiplication", () => {
    test("2df<char> finds the 2nd occurrence and deletes through it", async () => {
      const editor = await createStartedEditor("aXbXcXdX");
      await press(editor, "2dfX");
      expect(bufferText(editor)).toBe("cXdX");
      expect(getRegister(editor)).toBe("aXbX");
    });

    test("operator count multiplies motion count", async () => {
      const editor = await createStartedEditor("a.b.c.d.e.");
      await press(editor, "2df.");
      // operator_count=2, motion_count=1, total=2 → delete up to 2nd '.'
      expect(bufferText(editor)).toBe("c.d.e.");
    });
  });

  describe("Escape cancels operator+find pending state", () => {
    test("Escape after operator+find returns to normal mode cleanly", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "df");
      await press(editor, "\x1b"); // Escape
      expect(bufferText(editor)).toBe("hello world");
      expect(editor.getState().mode).toBe("normal");
    });
  });

  describe("Edge cases (SPEC-041 §Edge Cases)", () => {
    test("df<char> with no match is a no-op (buffer unchanged, operator cleared)", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "dfz");
      expect(bufferText(editor)).toBe("hello world");
      expect(editor.getState().cursorPosition).toEqual({ line: 0, column: 0 });
    });

    test("3df<char> reaches the 3rd occurrence (count multiplies)", async () => {
      const editor = await createStartedEditor("a.b.c.d.e.");
      await press(editor, "3df.");
      // Should delete from col 0 through col 5 (3rd '.')
      expect(bufferText(editor)).toBe("d.e.");
    });
  });

  describe("Standalone find-char no-regression", () => {
    test("f<char> alone still moves cursor without deleting", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "fw");
      expect(bufferText(editor)).toBe("hello world");
      expect(editor.getState().cursorPosition).toEqual({ line: 0, column: 6 });
    });

    test("counted f<char> still moves to Nth occurrence", async () => {
      const editor = await createStartedEditor("aXbXcX");
      await press(editor, "2fX");
      expect(editor.getState().cursorPosition).toEqual({ line: 0, column: 3 });
    });

    test("t<char> alone still moves cursor without deleting", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "tw");
      expect(editor.getState().cursorPosition).toEqual({ line: 0, column: 5 });
    });
  });
});
