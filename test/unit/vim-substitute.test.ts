/**
 * @file vim-substitute.test.ts
 * @description SPEC-069 Phase 3 — substitute keys s and S.
 *
 * s (substitute char) deletes COUNT chars (yanking to register ") and enters
 * insert mode — equivalent to cl. S (substitute line) clears COUNT lines and
 * enters insert — identical to cc. Both are bound in normal.tlisp.
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

async function pressKey(editor: Editor, key: string): Promise<void> {
  await editor.handleKey(key);
}

function getRegister(editor: Editor): string {
  const value = executeTlisp(editor, `(get-register "\\\"")`);
  if (value.type === "nil") return "";
  if (value.type === "string") return value.value as string;
  throw new Error(`Register " held unexpected type: ${value.type}`);
}

function mode(editor: Editor): string {
  return editor.getState().mode;
}

function cursor(editor: Editor): { line: number; column: number } {
  return editor.getState().cursorPosition;
}

describe("SPEC-069 Phase 3 — substitute s / S", () => {
  test("s deletes one char, yanks it, and enters insert", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "s");
    expect(bufferText(editor)).toBe("ello");
    expect(getRegister(editor)).toBe("h");
    expect(mode(editor)).toBe("insert");
    expect(cursor(editor)).toEqual({ line: 0, column: 0 });
  });

  test("s then type a replacement and Esc restores length", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "s");
    await press(editor, "X");
    await pressKey(editor, "Escape");
    expect(bufferText(editor)).toBe("Xello");
    expect(mode(editor)).toBe("normal");
  });

  test("3s deletes three chars then enters insert", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "3s");
    expect(bufferText(editor)).toBe("lo");
    expect(getRegister(editor)).toBe("hel");
    expect(mode(editor)).toBe("insert");
  });

  test("S clears the line content and enters insert, identical to cc", async () => {
    const sEditor = await createStartedEditor("hello\nworld");
    await press(sEditor, "S");

    const ccEditor = await createStartedEditor("hello\nworld");
    await press(ccEditor, "cc");

    expect(bufferText(sEditor)).toBe(bufferText(ccEditor));
    expect(mode(sEditor)).toBe("insert");
    expect(mode(ccEditor)).toBe("insert");
  });

  test("undo restores the buffer after s + replacement", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "s");
    await press(editor, "X");
    await pressKey(editor, "Escape");
    await press(editor, "u");
    expect(bufferText(editor)).toBe("hello");
  });
});
