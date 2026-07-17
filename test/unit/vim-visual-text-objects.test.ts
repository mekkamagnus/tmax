/**
 * @file vim-visual-text-objects.test.ts
 * @description SPEC-069 Phase 3 — visual text-objects (viw/vaw/vi"/va().
 *
 * In visual mode, i/a stash the inner/around choice and the next key (the
 * class char) re-anchors the selection to the text-object region. These tests
 * drive a selection with vi/va and then operate on it with d/y, asserting the
 * region the selection covered (via the deletion result + register).
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

function getRegister(editor: Editor): string {
  const value = executeTlisp(editor, `(get-register "\\\"")`);
  if (value.type === "nil") return "";
  if (value.type === "string") return value.value as string;
  throw new Error(`Register " held unexpected type: ${value.type}`);
}

function moveTo(editor: Editor, line: number, column: number): void {
  executeTlisp(editor, `(cursor-move ${line} ${column})`);
}

describe("SPEC-069 Phase 3 — visual text-objects", () => {
  test("viw from mid-word selects the whole word", async () => {
    const editor = await createStartedEditor("hello world");
    moveTo(editor, 0, 2); // mid-word on 'l'
    await press(editor, "viw");
    await press(editor, "d");
    expect(bufferText(editor)).toBe(" world");
    expect(getRegister(editor)).toBe("hello");
  });

  test("vaw includes the trailing whitespace", async () => {
    const editor = await createStartedEditor("hello world");
    moveTo(editor, 0, 2); // mid-word on 'l'
    await press(editor, "vaw");
    await press(editor, "d");
    expect(bufferText(editor)).toBe("world");
    expect(getRegister(editor)).toBe("hello ");
  });

  test("vi\" selects the inner quoted string", async () => {
    const editor = await createStartedEditor(`say "hi" there`);
    moveTo(editor, 0, 5); // on 'h' inside the quotes
    await press(editor, "vi\"");
    await press(editor, "d");
    expect(bufferText(editor)).toBe(`say "" there`);
    expect(getRegister(editor)).toBe("hi");
  });

  test("va) selects including the parens", async () => {
    const editor = await createStartedEditor("(xy) tail");
    moveTo(editor, 0, 1); // on 'x'
    await press(editor, "va)");
    await press(editor, "d");
    expect(bufferText(editor)).toBe(" tail");
    expect(getRegister(editor)).toBe("(xy)");
  });

  test("yank on a viw selection leaves the buffer untouched", async () => {
    const editor = await createStartedEditor("hello world");
    moveTo(editor, 0, 2); // mid-word on 'l'
    await press(editor, "viw");
    await press(editor, "y");
    expect(bufferText(editor)).toBe("hello world");
    expect(getRegister(editor)).toBe("hello");
  });
});
