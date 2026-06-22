/**
 * @file section-end-motions.test.ts
 * @description SPEC-044 Phase 3.D — `[]` and `][` section-end motions.
 * Section-end boundary = `}` at column 0 (C-style block close).
 * `[]` jumps backward, `][` jumps forward.
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

describe("SPEC-044 Phase 3.D — section-end motions [] and ][", () => {
  test("][ jumps forward to next } at column 0", async () => {
    const editor = await createStartedEditor([
      "line one",
      "}",
      "line three",
      "}",
      "line five",
    ].join("\n"));
    executeTlisp(editor, "(cursor-move 0 0)");
    await press(editor, "]");
    await press(editor, "[");
    expect(cursor(editor)).toEqual([1, 0]);
  });

  test("[] jumps backward to previous } at column 0", async () => {
    const editor = await createStartedEditor([
      "line one",
      "}",
      "line three",
      "}",
      "line five",
    ].join("\n"));
    executeTlisp(editor, "(cursor-move 4 0)");
    await press(editor, "[");
    await press(editor, "]");
    expect(cursor(editor)).toEqual([3, 0]);
  });

  test("][ does not land on { at column 0", async () => {
    const editor = await createStartedEditor([
      "{",
      "body",
      "}",
    ].join("\n"));
    executeTlisp(editor, "(cursor-move 0 0)");
    await press(editor, "]");
    await press(editor, "[");
    // Forward to next } — skips line 0 ({) and line 1 (body).
    expect(cursor(editor)).toEqual([2, 0]);
  });

  test("count 2 with ][ skips two section-end boundaries", async () => {
    const editor = await createStartedEditor([
      "a",
      "}",
      "b",
      "}",
      "c",
      "}",
      "d",
    ].join("\n"));
    executeTlisp(editor, "(cursor-move 0 0)");
    await press(editor, "2");
    await press(editor, "]");
    await press(editor, "[");
    expect(cursor(editor)).toEqual([3, 0]);
  });

  test("][ at the last section-end stays put (no further boundary)", async () => {
    const editor = await createStartedEditor([
      "a",
      "}",
      "b",
    ].join("\n"));
    executeTlisp(editor, "(cursor-move 1 0)");
    await press(editor, "]");
    await press(editor, "[");
    expect(cursor(editor)).toEqual([1, 0]);
  });
});
