/**
 * @file visual-case-ops.test.ts
 * @description SPEC-044 Phase 5.C — Visual-mode gu, gU, g~ operators.
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

describe("SPEC-044 Phase 5.C — visual-mode gu/gU/g~", () => {
  test("u lowercases the visual selection", async () => {
    const editor = await createStartedEditor("HELLO world");
    executeTlisp(editor, "(cursor-move 0 0)");
    await press(editor, "v");
    // Move cursor right 5 to extend the selection to columns 0-5 ("HELLO ").
    executeTlisp(editor, "(cursor-move 0 5)");
    executeTlisp(editor, "(visual-update-end)");
    await press(editor, "u");
    expect(bufferText(editor)).toBe("hello world");
  });

  test("U uppercases the visual selection", async () => {
    const editor = await createStartedEditor("hello world");
    executeTlisp(editor, "(cursor-move 0 0)");
    await press(editor, "v");
    executeTlisp(editor, "(cursor-move 0 5)");
    executeTlisp(editor, "(visual-update-end)");
    await press(editor, "U");
    expect(bufferText(editor)).toBe("HELLO world");
  });

  test("~ toggles case of the visual selection", async () => {
    const editor = await createStartedEditor("hello WORLD");
    executeTlisp(editor, "(cursor-move 0 0)");
    await press(editor, "v");
    executeTlisp(editor, "(cursor-move 0 4)");
    executeTlisp(editor, "(visual-update-end)");
    await press(editor, "~");
    expect(bufferText(editor)).toBe("HELLO WORLD");
  });

  test("u exits visual mode after applying", async () => {
    const editor = await createStartedEditor("HELLO");
    executeTlisp(editor, "(cursor-move 0 0)");
    await press(editor, "v");
    executeTlisp(editor, "(cursor-move 0 4)");
    executeTlisp(editor, "(visual-update-end)");
    await press(editor, "u");
    const mode = executeTlisp(editor, "(editor-mode)").value;
    expect(mode).toBe("normal");
  });
});
