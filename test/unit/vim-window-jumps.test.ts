import { describe, expect, it } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor, executeTlisp, moveCursor } from "../helpers/editor-fixture.ts";

// SPEC-067 — H / M / L (window-relative jumps: top / middle / bottom).
// MockTerminal is 80x24, so terminal-height-get == 24.

async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

function line(editor: Editor): number {
  return executeTlisp(editor, "(cursor-line)").value as number;
}

/**
 * Park viewport-top at 10 by moving to line 10 and pressing `zt`
 * (scroll-cursor-top sets viewport-top = cursor-line). H/M/L then read
 * that viewport-top, so this exercises the full scroll + jump path.
 */
async function withViewportTop(editor: Editor, top: number): Promise<void> {
  moveCursor(editor, top, 0);
  await press(editor, "zt");
}

describe("SPEC-067 H / M / L window jumps", () => {
  it("H moves to the top of the viewport", async () => {
    const editor = await createStartedEditor(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    await withViewportTop(editor, 10);
    // wander down first
    moveCursor(editor, 20, 0);
    await press(editor, "H");
    expect(line(editor)).toBe(10);
  });

  it("M moves to the middle of the viewport", async () => {
    const editor = await createStartedEditor(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    await withViewportTop(editor, 10);
    moveCursor(editor, 11, 0);
    await press(editor, "M");
    // viewport-top + floor(24/2) = 10 + 12 = 22
    expect(line(editor)).toBe(22);
  });

  it("L moves to the bottom region of the viewport", async () => {
    const editor = await createStartedEditor(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    await withViewportTop(editor, 10);
    moveCursor(editor, 11, 0);
    await press(editor, "L");
    // vim-window-bottom(count=1): target = 10 + (24-1) - 1 = 32
    expect(line(editor)).toBe(32);
  });

  it("H/M/L are strictly ordered top < middle < bottom", async () => {
    const editor = await createStartedEditor(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    await withViewportTop(editor, 10);
    moveCursor(editor, 20, 0);
    await press(editor, "H");
    const h = line(editor);
    moveCursor(editor, 20, 0);
    await press(editor, "M");
    const m = line(editor);
    moveCursor(editor, 20, 0);
    await press(editor, "L");
    const l = line(editor);
    expect(h).toBeLessThan(m);
    expect(m).toBeLessThan(l);
  });
});
