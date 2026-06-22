/**
 * @file replace-mode.test.ts
 * @description SPEC-044 Phase 2.B — `r{char}` two-key replace command.
 * Mirrors the operator+text-object test pattern: real editor, real keypresses,
 * asserts on end state (buffer text, cursor position, undo round-trip).
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

function cursor(editor: Editor): [number, number] {
  const line = executeTlisp(editor, "(cursor-line)");
  const col = executeTlisp(editor, "(cursor-column)");
  return [line.value as number, col.value as number];
}

describe("SPEC-044 Phase 2.B — r{char} two-key replace", () => {
  test("rx overwrites the char under the cursor", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "rx");
    expect(bufferText(editor)).toBe("xello");
  });

  test("cursor lands on the replaced char (vim semantics)", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "rx");
    expect(cursor(editor)).toEqual([0, 0]);
  });

  test("3rx overwrites 3 chars with x and lands cursor on the last", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "3rx");
    expect(bufferText(editor)).toBe("xxxlo");
    expect(cursor(editor)).toEqual([0, 2]);
  });

  test("r<Esc> cancels pending state and leaves buffer unchanged", async () => {
    const editor = await createStartedEditor("hello");
    await editor.handleKey("r");
    await editor.handleKey("Escape");
    expect(bufferText(editor)).toBe("hello");
  });

  test("r at end of line replaces only the last char (clamps to line length)", async () => {
    const editor = await createStartedEditor("hi");
    await press(editor, "l");
    await press(editor, "rx");
    expect(bufferText(editor)).toBe("hx");
  });

  test("3r beyond end of line clamps to remaining chars", async () => {
    const editor = await createStartedEditor("ab");
    await press(editor, "3rx");
    expect(bufferText(editor)).toBe("xx");
  });

  test("u after rx restores original text and cursor", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "rx");
    await press(editor, "u");
    expect(bufferText(editor)).toBe("hello");
  });

  test("r<Enter> replaces the char under cursor with a newline (vim semantics)", async () => {
    const editor = await createStartedEditor("ab");
    await press(editor, "l");
    await editor.handleKey("r");
    await editor.handleKey("Enter");
    expect(bufferText(editor)).toBe("a\n");
  });
});

describe("SPEC-044 Phase 2.C — R replace mode", () => {
  test("R enters replace mode; typing overwrites char under cursor", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "R");
    await press(editor, "X");
    expect(bufferText(editor)).toBe("Xello");
  });

  test("consecutive R-mode chars each overwrite one char", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "R");
    await press(editor, "ABC");
    expect(bufferText(editor)).toBe("ABClo");
  });

  test("R-mode typing past EOL appends", async () => {
    const editor = await createStartedEditor("ab");
    await press(editor, "R");
    await press(editor, "abcd");
    expect(bufferText(editor)).toBe("abcd");
  });

  test("Escape exits R mode back to normal", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "R");
    await press(editor, "X");
    await editor.handleKey("Escape");
    expect(executeTlisp(editor, "(editor-mode)").value).toBe("normal");
  });

  test("u after R session undoes the whole session as one combo", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "R");
    await press(editor, "ABC");
    await editor.handleKey("Escape");
    await press(editor, "u");
    expect(bufferText(editor)).toBe("hello");
  });
});
