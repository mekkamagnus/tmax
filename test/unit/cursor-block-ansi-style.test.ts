import { test, expect } from "bun:test";
import { renderBufferLines } from "/Users/mekael/Documents/programming/typescript/tmax/src/frontend/render/buffer-lines.ts";
import { TextBufferImpl } from "/Users/mekael/Documents/programming/typescript/tmax/src/core/buffer.ts";
import { defaultDarkTheme } from "/Users/mekael/Documents/programming/typescript/tmax/src/syntax/types.ts";
import type { EditorState } from "/Users/mekael/Documents/programming/typescript/tmax/src/core/types.ts";

const state = (content: string, col: number): EditorState => ({
  currentBuffer: TextBufferImpl.create(content) as any,
  cursorPosition: { line: 0, column: col },
  mode: "normal",
  statusMessage: "",
  viewportTop: 0,
  config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: false },
  commandLine: "",
  mxCommand: "",
  currentFilename: "x.ts",
} as any);

test("block cursor does not drop the active span style after the cursor cell", () => {
  // Cursor mid-line (col 3) inside a comment span covering the whole line.
  const spans = [[{ start: 0, end: 13, style: defaultDarkTheme.comment! }]];
  const rows = renderBufferLines(state("// hello world", 3), 40, 4, spans);
  const row = rows[0]!;
  console.log("row:", JSON.stringify(row));
  // The cursor's own style ends with a reset; the text AFTER that reset
  // must re-establish the comment color for the remainder of the line.
  const cursorEnd = row.indexOf("48;5;231m"); // the cursor block bg
  expect(cursorEnd).toBeGreaterThan(-1);
  const afterCursor = row.slice(row.indexOf("\x1b[0m", cursorEnd));
  expect(afterCursor.startsWith("\x1b[0m\x1b[2m\x1b[38;2;92;99;112mello worl")).toBe(true);
});
