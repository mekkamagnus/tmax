import { describe, expect, it } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor, executeTlisp, moveCursor } from "../helpers/editor-fixture.ts";

// SPEC-067 — gg / G / gi.

/** Send each character of KEYS as a real keypress (gg, 5gg, ...). */
async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

function line(editor: Editor): number {
  return executeTlisp(editor, "(cursor-line)").value as number;
}
function col(editor: Editor): number {
  return executeTlisp(editor, "(cursor-column)").value as number;
}
function mode(editor: Editor): string {
  return editor.getEditorState().mode;
}

describe("SPEC-067 gg / G", () => {
  it("gg moves the cursor to the first line", async () => {
    const editor = await createStartedEditor("l0\nl1\nl2\nl3\nl4\nl5");
    moveCursor(editor, 3, 0); // somewhere in the middle
    await press(editor, "gg");
    expect(line(editor)).toBe(0);
  });

  it("5gg moves the cursor to line 5 (1-indexed)", async () => {
    const editor = await createStartedEditor("l0\nl1\nl2\nl3\nl4\nl5");
    await press(editor, "5gg");
    expect(line(editor)).toBe(4); // index 4 == vim line 5
  });

  it("G moves the cursor to the last line", async () => {
    const editor = await createStartedEditor("l0\nl1\nl2\nl3\nl4\nl5");
    await press(editor, "G");
    expect(line(editor)).toBe(5);
  });
});

describe("SPEC-067 gi (go to last insert position)", () => {
  it("gi returns to where insert mode was last exited and re-enters insert", async () => {
    const editor = await createStartedEditor("alpha\nbeta\ngamma");
    // Insert an X in "beta" at column 2 (on 't'), then leave insert.
    moveCursor(editor, 1, 2);
    await press(editor, "i");
    await press(editor, "X");
    await editor.handleKey("Escape"); // ^ mark recorded at (1, 3)
    expect(mode(editor)).toBe("normal");

    // Wander off, then gi back.
    await press(editor, "gg");
    expect(line(editor)).toBe(0);
    await press(editor, "gi");

    expect(line(editor)).toBe(1);
    expect(col(editor)).toBe(3); // one past the inserted X
    expect(mode(editor)).toBe("insert");
  });

  it("gi with no prior insert position still enters insert mode (vim behavior)", async () => {
    const editor = await createStartedEditor("alpha\nbeta");
    // Fresh buffer — no ^ mark set yet.
    moveCursor(editor, 1, 0);
    await press(editor, "gi");
    expect(mode(editor)).toBe("insert");
    expect(line(editor)).toBe(1); // stays put
  });
});
