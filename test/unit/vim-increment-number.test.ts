import { describe, expect, it } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { bufferText, createStartedEditor, executeTlisp, moveCursor } from "../helpers/editor-fixture.ts";

// SPEC-067 — C-a / C-x (increment / decrement the number at/after cursor).
// Cursor is placed with moveCursor so tests assert on a known column rather
// than depending on word-motion semantics.

/** Current cursor column. */
function column(editor: Editor): number {
  return executeTlisp(editor, "(cursor-column)").value as number;
}

describe("SPEC-067 C-a / C-x increment & decrement number", () => {
  it("C-a increments the number under the cursor", async () => {
    const editor = await createStartedEditor("value = 42 done");
    moveCursor(editor, 0, 8); // on '4' of '42'
    await editor.handleKey("C-a");
    expect(bufferText(editor)).toBe("value = 43 done");
  });

  it("C-x decrements the number under the cursor", async () => {
    const editor = await createStartedEditor("value = 42 done");
    moveCursor(editor, 0, 8); // on '4' of '42'
    await editor.handleKey("C-x");
    expect(bufferText(editor)).toBe("value = 41 done");
  });

  it("count prefix multiplies the delta (5C-a adds 5)", async () => {
    const editor = await createStartedEditor("n = 10");
    moveCursor(editor, 0, 4); // on '1' of '10'
    await editor.handleKey("5");
    await editor.handleKey("C-a");
    expect(bufferText(editor)).toBe("n = 15");
  });

  it("C-a searches forward when the cursor is before the number", async () => {
    const editor = await createStartedEditor("no num here 7 end");
    // cursor at col 0 (well before '7'); C-a finds '7' forward
    await editor.handleKey("C-a");
    expect(bufferText(editor)).toBe("no num here 8 end");
  });

  it("C-a handles negative numbers (increment toward zero)", async () => {
    const editor = await createStartedEditor("temp = -5 ok");
    moveCursor(editor, 0, 8); // on '5' of '-5'
    await editor.handleKey("C-a");
    // -5 + 1 = -4
    expect(bufferText(editor)).toBe("temp = -4 ok");
  });

  it("C-x on a negative number moves it away from zero", async () => {
    const editor = await createStartedEditor("temp = -5 ok");
    moveCursor(editor, 0, 8); // on '5'
    await editor.handleKey("C-x");
    // -5 - 1 = -6
    expect(bufferText(editor)).toBe("temp = -6 ok");
  });

  it("cursor lands on the last digit of the new number", async () => {
    const editor = await createStartedEditor("x 42 y");
    moveCursor(editor, 0, 2); // on '4' of '42'
    await editor.handleKey("C-a"); // 42 -> 43
    // "43": last digit '3' is at column 3
    expect(column(editor)).toBe(3);
  });

  it("C-a on a line with no number is a no-op (vim behavior)", async () => {
    const editor = await createStartedEditor("just some words");
    const before = bufferText(editor);
    await editor.handleKey("C-a");
    expect(bufferText(editor)).toBe(before);
  });

  it("undo round-trip restores the original number", async () => {
    const editor = await createStartedEditor("count = 100");
    moveCursor(editor, 0, 8); // on '1' of '100'
    await editor.handleKey("C-a");
    expect(bufferText(editor)).toBe("count = 101");
    await editor.handleKey("u");
    expect(bufferText(editor)).toBe("count = 100");
  });
});
