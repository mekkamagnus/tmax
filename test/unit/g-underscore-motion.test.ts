/**
 * @file g-underscore-motion.test.ts
 * @description SPEC-044 Phase 3.G — `g_` motion to last non-blank char.
 */

import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import {
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

describe("SPEC-044 Phase 3.G — g_ last non-blank motion", () => {
  test("g_ lands on the last non-blank char of the line", async () => {
    const editor = await createStartedEditor("hello   ");
    executeTlisp(editor, "(cursor-move 0 0)");
    await press(editor, "g");
    await press(editor, "_");
    // Last non-blank is 'o' at index 4 (trailing spaces don't count).
    expect(cursor(editor)).toEqual([0, 4]);
  });

  test("g_ on a line with no trailing whitespace lands on last char", async () => {
    const editor = await createStartedEditor("hello");
    executeTlisp(editor, "(cursor-move 0 0)");
    await press(editor, "g");
    await press(editor, "_");
    expect(cursor(editor)).toEqual([0, 4]);
  });

  test("g_ on an all-blank line lands at column 0", async () => {
    const editor = await createStartedEditor("    ");
    executeTlisp(editor, "(cursor-move 0 0)");
    await press(editor, "g");
    await press(editor, "_");
    expect(cursor(editor)).toEqual([0, 0]);
  });
});
