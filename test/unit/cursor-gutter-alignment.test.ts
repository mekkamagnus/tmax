/**
 * @file cursor-gutter-alignment.test.ts
 * @description #248: the hardware cursor (getCursorScreenOffset → moveTo in
 *   both frontends) must land on the SAME screen cell as the drawn block
 *   cursor the frame renderer paints. When the line-number gutter is shown
 *   every rendered line is `gutter + content`, so the offset must include the
 *   gutter width. Before the fix the hardware cursor sat gutter-width cells
 *   LEFT of the drawn cursor — visible to users as a second "ghost" cursor.
 */

import { describe, test, expect } from "bun:test";
import { getCursorScreenOffset, renderBufferLines } from "../../src/frontend/render/buffer-lines.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState } from "../../src/core/types.ts";

function makeState(content: string, minor: string[], column: number): EditorState {
  const buf = TextBufferImpl.create(content);
  return {
    currentBuffer: buf as any,
    cursorPosition: { line: 0, column },
    mode: "normal",
    statusMessage: "",
    viewportTop: 0,
    activeMinorModes: minor,
    config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: false },
    commandLine: "",
    mxCommand: "",
    currentFilename: "note.md",
  } as EditorState;
}

// The drawn block cursor is style(ch, { fg: "black", bg: "white" }) →
// \x1b[38;5;16m\x1b[48;5;231m (matcha.ts colorCodes: black=16, white=231).
const BLOCK_CURSOR_SGR = "\x1b[38;5;16m\x1b[48;5;231m";

/** Screen column of the drawn block cursor in a rendered (ANSI) line. */
function drawnCursorCol(rawLine: string): number {
  const at = rawLine.indexOf(BLOCK_CURSOR_SGR);
  if (at < 0) throw new Error("no drawn block cursor found in line");
  return rawLine.slice(0, at).replace(/\x1b\[[0-9;]*m/g, "").length;
}

describe("#248: hardware cursor aligns with the drawn cursor", () => {
  test("GATE: with line-numbers on, offset.col equals the drawn cursor's screen column", () => {
    const content = "(defun hello ()\n  (print \"world\"))";
    for (const column of [0, 6, 15]) { // line start / mid-line / end of line
      const state = makeState(content, ["line-numbers"], column);
      const lines = renderBufferLines(state, 80, 24);
      const drawn = drawnCursorCol(lines[0]!);
      const hardware = getCursorScreenOffset(state, 24, 80).col;
      expect(hardware).toBe(drawn);
    }
  });

  test("GATE: gutter off, offset.col still equals the drawn cursor's screen column", () => {
    const content = "(defun hello ()\n  (print \"world\"))";
    for (const column of [0, 6, 15]) {
      const state = makeState(content, [], column);
      const lines = renderBufferLines(state, 80, 24);
      expect(getCursorScreenOffset(state, 24, 80).col).toBe(drawnCursorCol(lines[0]!));
    }
  });

  test("offset is absolute: cursor at column 0 sits just right of the 4-cell gutter", () => {
    const state = makeState("hello\nworld", ["line-numbers"], 0);
    // 2-line buffer → gutter " 1 │" = 4 visible cells.
    expect(getCursorScreenOffset(state, 24, 80).col).toBe(4);
  });

  test("wider gutter (100+ line buffer, 5 cells) keeps alignment", () => {
    const content = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n");
    const state = makeState(content, ["line-numbers"], 7);
    const lines = renderBufferLines(state, 80, 24);
    const drawn = drawnCursorCol(lines[0]!);
    expect(drawn).toBe(12); // 5-cell gutter + col 7 — sanity on the width derivation
    expect(getCursorScreenOffset(state, 24, 80).col).toBe(drawn);
  });

  test("horizontal-scroll clamp uses the gutter-reduced content width", () => {
    // Long line, narrow terminal: cursor col 18 with width 20. Content fits
    // 20 - 4 = 16 cells, so the viewport must scroll (viewportLeft 3) and the
    // cursor must land on the LAST cell of the row — not past it.
    const long = "x".repeat(40) + "\n";
    const state = makeState(long, ["line-numbers"], 18);
    expect(getCursorScreenOffset(state, 24, 20).col).toBe(19);
  });
});
