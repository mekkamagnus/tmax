import { describe, expect, it } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { bufferText, createStartedEditor, executeTlisp, moveCursor } from "../helpers/editor-fixture.ts";

// SPEC-067 — ~ (toggle case of char under cursor, then advance).

/** Send each character of KEYS as a real keypress. */
async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

function col(editor: Editor): number {
  return executeTlisp(editor, "(cursor-column)").value as number;
}

describe("SPEC-067 ~ toggle case", () => {
  it("~ toggles a lowercase char to uppercase and advances the cursor", async () => {
    const editor = await createStartedEditor("abc");
    moveCursor(editor, 0, 0);
    await press(editor, "~");
    expect(bufferText(editor)).toBe("Abc");
    expect(col(editor)).toBe(1);
  });

  it("~ toggles an uppercase char to lowercase", async () => {
    const editor = await createStartedEditor("ABC");
    moveCursor(editor, 0, 0);
    await press(editor, "~");
    expect(bufferText(editor)).toBe("aBC");
  });

  it("~ on a non-alpha char is a no-op on text but still advances the cursor", async () => {
    const editor = await createStartedEditor("1bc");
    moveCursor(editor, 0, 0);
    await press(editor, "~");
    expect(bufferText(editor)).toBe("1bc");
    expect(col(editor)).toBe(1);
  });

  it("count prefix 3~ toggles three chars", async () => {
    const editor = await createStartedEditor("abcdef");
    moveCursor(editor, 0, 0);
    await press(editor, "3~");
    expect(bufferText(editor)).toBe("ABCdef");
  });

  it("undo round-trip restores the original case", async () => {
    const editor = await createStartedEditor("hello");
    moveCursor(editor, 0, 0);
    await press(editor, "~");
    expect(bufferText(editor)).toBe("Hello");
    await press(editor, "u");
    expect(bufferText(editor)).toBe("hello");
  });
});
