/**
 * @file vim-operator-motion.test.ts
 * @description SPEC-069 Phase 1 — generic operator × motion composition.
 *
 * The legacy vim-operator-apply allowed only a hardcoded combo set
 * (dd dw dl d$ dG dgg + y/c mirrors); anything else reported
 * "Unsupported operator". SPEC-069 replaces that fallback with a generic
 * region computation: run the motion, classify it (char-exclusive /
 * char-inclusive / linewise), apply d/y/c over the resulting region.
 *
 * These tests exercise the FALLBACK path specifically — motions that are NOT
 * in the explicit allowlist (e, %, b, h, 0, W, j, k, …). dw/dl/d$/dG stay on
 * the explicit fast path and are covered by their own suites; one regression
 * assert here confirms d$ still routes correctly.
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
  const escaped = name === '"' ? '\\"' : name;
  const value = executeTlisp(editor, `(get-register "${escaped}")`);
  if (value.type === "nil") return "";
  if (value.type === "string") return value.value as string;
  throw new Error(`Register ${name} held unexpected type: ${value.type}`);
}

function cursor(editor: Editor): { line: number; column: number } {
  return editor.getState().cursorPosition;
}

describe("SPEC-069 Phase 1 — generic operator × motion", () => {
  describe("de/d% — forward char-inclusive (landing char included)", () => {
    test("de deletes through end of word", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "de");
      expect(bufferText(editor)).toBe(" world");
      expect(cursor(editor)).toEqual({ line: 0, column: 0 });
      expect(getRegister(editor)).toBe("hello");
    });

    test("d% deletes through matching bracket", async () => {
      const editor = await createStartedEditor("(xy) tail");
      await press(editor, "d%");
      // '(' at col0 matches ')' at col3 → delete cols 0..3 "(xy)"
      expect(bufferText(editor)).toBe(" tail");
      expect(getRegister(editor)).toBe("(xy)");
    });
  });

  describe("db/dh/d0/dW — char-exclusive (destination char excluded)", () => {
    test("db deletes back to previous word start", async () => {
      const editor = await createStartedEditor("hello world");
      executeTlisp(editor, "(cursor-move 0 6)"); // on 'w'
      await press(editor, "db");
      // delete cols 0..5 "hello " → "world"
      expect(bufferText(editor)).toBe("world");
      expect(cursor(editor)).toEqual({ line: 0, column: 0 });
      expect(getRegister(editor)).toBe("hello ");
    });

    test("dh deletes the char to the left", async () => {
      const editor = await createStartedEditor("hello");
      executeTlisp(editor, "(cursor-move 0 4)"); // on 'o'
      await press(editor, "dh");
      // delete col3 'l' → "helo", cursor lands on col3
      expect(bufferText(editor)).toBe("helo");
      expect(cursor(editor)).toEqual({ line: 0, column: 3 });
      expect(getRegister(editor)).toBe("l");
    });

    test("d0 deletes back to first column", async () => {
      const editor = await createStartedEditor("hello");
      executeTlisp(editor, "(cursor-move 0 4)"); // on 'o'
      await press(editor, "d0");
      // delete cols 0..3 "hell" → "o"
      expect(bufferText(editor)).toBe("o");
      expect(cursor(editor)).toEqual({ line: 0, column: 0 });
      expect(getRegister(editor)).toBe("hell");
    });

    test("dW deletes a WORD (punctuation joined) forward", async () => {
      const editor = await createStartedEditor("aa.bb cc");
      await press(editor, "dW");
      // WORD "aa.bb" spans cols 0..4, trailing space col5 → delete cols 0..5
      expect(bufferText(editor)).toBe("cc");
      expect(cursor(editor)).toEqual({ line: 0, column: 0 });
      expect(getRegister(editor)).toBe("aa.bb ");
    });
  });

  describe("ye / ce — inclusive-forward yank and change", () => {
    test("ye yanks through end of word without mutating", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "ye");
      expect(bufferText(editor)).toBe("hello world");
      expect(cursor(editor)).toEqual({ line: 0, column: 0 });
      expect(getRegister(editor)).toBe("hello");
    });

    test("ce deletes through end of word and enters insert mode", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "ce");
      expect(bufferText(editor)).toBe(" world");
      expect(editor.getState().mode).toBe("insert");
      expect(cursor(editor)).toEqual({ line: 0, column: 0 });
      expect(getRegister(editor)).toBe("hello");
    });
  });

  describe("dj / dk — linewise (whole lines)", () => {
    test("dj deletes current + next line", async () => {
      const editor = await createStartedEditor("line0\nline1\nline2");
      await press(editor, "dj");
      expect(bufferText(editor)).toBe("line2");
      expect(cursor(editor)).toEqual({ line: 0, column: 0 });
      expect(getRegister(editor)).toBe("line0\nline1\n");
    });

    test("dk deletes current + previous line", async () => {
      const editor = await createStartedEditor("line0\nline1\nline2");
      executeTlisp(editor, "(cursor-move 1 0)"); // on line1
      await press(editor, "dk");
      expect(bufferText(editor)).toBe("line2");
      expect(cursor(editor)).toEqual({ line: 0, column: 0 });
    });
  });

  describe("Count multiplication", () => {
    test("2de deletes two words (operator count)", async () => {
      const editor = await createStartedEditor("aa bb cc dd");
      await press(editor, "2de");
      // word-end with count 2 → end of "bb" (col4), inclusive → delete cols 0..4
      expect(bufferText(editor)).toBe(" cc dd");
      expect(getRegister(editor)).toBe("aa bb");
    });

    test("d2e deletes two words (motion count)", async () => {
      const editor = await createStartedEditor("aa bb cc dd");
      await press(editor, "d2e");
      expect(bufferText(editor)).toBe(" cc dd");
      expect(getRegister(editor)).toBe("aa bb");
    });
  });

  describe("dot-repeat (.) replays generic operator×motion", () => {
    test("de then . repeats the deletion", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "de");
      expect(bufferText(editor)).toBe(" world");
      await press(editor, ".");
      // cursor was on the leading space; . repeats de → deletes " world"
      expect(bufferText(editor)).toBe("");
    });
  });

  describe("Regression — explicit-path combos still route correctly", () => {
    test("d$ still deletes to end of line (explicit branch)", async () => {
      const editor = await createStartedEditor("hello");
      await press(editor, "d$");
      expect(bufferText(editor)).toBe("");
      expect(getRegister(editor)).toBe("hello");
    });

    test("previously-unsupported combo no longer errors", async () => {
      // Before SPEC-069, `de` set status "Unsupported operator: de" and did
      // nothing. Now it deletes; the buffer must change.
      const editor = await createStartedEditor("hello world");
      await press(editor, "de");
      expect(bufferText(editor)).not.toBe("hello world");
    });
  });
});
