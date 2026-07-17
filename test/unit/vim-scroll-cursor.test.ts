import { describe, expect, it } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor, executeTlisp, moveCursor } from "../helpers/editor-fixture.ts";

// SPEC-067 — zt / zz / zb (scroll cursor to top / center / bottom of viewport).
// MockTerminal is 80x24, so terminal-height-get == 24.

async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

function viewportTop(editor: Editor): number {
  return executeTlisp(editor, "(viewport-top-get)").value as number;
}

describe("SPEC-067 zt / zz / zb scroll-cursor", () => {
  it("zt aligns the cursor line to the top of the viewport", async () => {
    const editor = await createStartedEditor(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    moveCursor(editor, 30, 0);
    await press(editor, "zt");
    expect(viewportTop(editor)).toBe(30);
  });

  it("zz aligns the cursor line to the middle of the viewport", async () => {
    const editor = await createStartedEditor(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    moveCursor(editor, 30, 0);
    await press(editor, "zz");
    // 30 - floor(24/2) = 30 - 12 = 18
    expect(viewportTop(editor)).toBe(18);
  });

  it("zb aligns the cursor line to the bottom of the viewport", async () => {
    const editor = await createStartedEditor(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    moveCursor(editor, 30, 0);
    await press(editor, "zb");
    // 30 - (24 - 2) = 30 - 22 = 8
    expect(viewportTop(editor)).toBe(8);
  });

  it("zb near the top of the buffer clamps viewport-top at 0", async () => {
    const editor = await createStartedEditor(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    moveCursor(editor, 5, 0);
    await press(editor, "zb");
    // max(0, 5 - 22) = max(0, -17) = 0
    expect(viewportTop(editor)).toBe(0);
  });
});
