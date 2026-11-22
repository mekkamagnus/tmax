import { describe, test, expect } from "bun:test";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState } from "../../src/core/contracts/editor.ts";
import { renderBufferLines, getWrappedCursorRow, getWrappedCursorColumn } from "../../src/frontend/render/buffer-lines.ts";


/**
 * @file cjk-block-cursor.test.ts
 * @description #328 — the BLOCK-cursor paint walks VISUAL widths under
 * wrap (the #321 lesson applied to the painted cursor): wide
 * characters past a wrap boundary put the painted block on the same
 * row/cell as the (already-fixed) hardware cursor.
 */

function makeState(content: string, cursor: { line: number; column: number }): EditorState {
  const buf = TextBufferImpl.create(content);
  return {
    currentBuffer: buf as any,
    cursorPosition: cursor,
    mode: "normal",
    statusMessage: "",
    viewportTop: 0,
    config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: true },
    commandLine: "",
    mxCommand: "",
    currentFilename: "note.md",
    currentMajorMode: "fundamental",
    activeMinorModes: [],
  };
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

/** The ANSI reverse-video run's index within the stripped row. */
const blockCursorAt = (row: string): { stripped: string; blockIndex: number; blockWidth: number } => {
  const stripped = stripAnsi(row);
  // The block cursor is a THEME-COLORED run (48;5;231 bg — the dark
  // theme's cursor face) ending at the next reset.
  const m = /\x1b\[48;5;231m([^\x1b]*)\x1b\[0m/.exec(row);
  if (!m) return { stripped, blockIndex: -1, blockWidth: 0 };
  const before = stripAnsi(row.slice(0, m.index));
  // VISUAL cells (a wide char is 2 cells — char counts mislead).
  const sw = (t: string): number => [...t].reduce((w, ch) => w + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
  return { stripped, blockIndex: sw(before), blockWidth: sw(stripAnsi(m[1]!)) };
};

describe("#328 — block cursor under wrap + wide characters", () => {
  test("a cursor after 界 past a wrap boundary paints on the CORRECT row and cell", () => {
    // Width 12, no gutter (line numbers off): cw = 12. The line
    // "界界界界界界界界界界" = 10 wide chars = 20 cells → wraps at
    // cell 12: row 0 = 6 chars, row 1 = 4 chars. Cursor at logical
    // col 8 (after 8 界) = visual cell 16 → row 1, cell 4.
    const line = "界界界界界界界界界界";
    const state = makeState(line, { line: 0, column: 8 });
    const rows = renderBufferLines(state, 12, 24);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Row 1 carries the block cursor at VISUAL cell 4 (the char
    // BEFORE it — visual cells 0..3 = 界界).
    const { blockIndex, blockWidth } = blockCursorAt(rows[1]!);
    expect(blockIndex).toBe(4); // the EXACT paint cell (gate r2)
    expect(blockWidth).toBe(2); // a full wide char cell
    // The block starts at visual cell 4: the stripped row 1 is
    // "界界界" (3 chars) with the block over the LAST one — its
    // index within the stripped text is at the 3rd char (cell 4).
    const { stripped } = blockCursorAt(rows[1]!);
    expect(stripped).toContain("界");
    // The HARDWARE cursor's column agrees (the same visual math).
    const hwCol = getWrappedCursorColumn(state, 12);
    const hwRow = getWrappedCursorRow(state, 24, 12);
    expect(hwRow).toBe(1);
    // No gutter → the hardware column IS the within-segment visual cell.
    expect(hwCol).toBe(4);
  });

  test("boundary-exact (the cursor AT a wrap boundary) prefers the NEXT row — block and hardware agree", () => {
    // 7 界 = 14 cells over width 12: row 0 = 6 chars (12 cells),
    // row 1 = 1 char. The cursor at logical 6 (visual 12, exactly the
    // boundary) starts row 1 cell 0 — the renderer's next-row
    // preference; the block must match the hardware cursor.
    const line = "界界界界界界界";
    const state = makeState(line, { line: 0, column: 6 });
    const rows = renderBufferLines(state, 12, 24);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const r1 = blockCursorAt(rows[1]!);
    expect(r1.blockIndex).toBe(0); // the block leads row 1
    expect(getWrappedCursorRow(state, 24, 12)).toBe(1);
    expect(getWrappedCursorColumn(state, 12)).toBe(0);
  });

  test("ASCII-only wrap still paints correctly (no wide-char regression)", () => {
    const line = "abcdefghij";
    const state = makeState(line, { line: 0, column: 7 });
    const rows = renderBufferLines(state, 5, 24);
    // cw=5: rows "abcde" / "fghij"; cursor col 7 → row 1 cell 2 ('h').
    const { blockIndex } = blockCursorAt(rows[1]!);
    expect(blockIndex).toBe(2);
    expect(getWrappedCursorRow(state, 24, 5)).toBe(1);
    expect(getWrappedCursorColumn(state, 5)).toBe(2);
  });

  test("CURSOR-AT-EOL under wrap (gate r1 regression): the block paints PAST-END, hardware agrees", () => {
    // ASCII: "abcdefgh" col 8 (end) at width 5 → rows abcde/fgh; the
    // block sits past 'h' at cell 3 (the r1 fallback painted cell 0).
    const st1 = makeState("abcdefgh", { line: 0, column: 8 });
    const r1 = renderBufferLines(st1, 5, 24);
    const b1 = blockCursorAt(r1[1]!);
    expect(b1.blockIndex).toBe(3);
    expect(getWrappedCursorRow(st1, 24, 5)).toBe(1);
    expect(getWrappedCursorColumn(st1, 5)).toBe(3);
    // WIDE: 7 界 col 7 (end) at width 12 → row 1 holds 1 char; the
    // cursor past-end = visual cell 2 — the block paints the past-end
    // cell (row padding), NOT over the first char.
    const st2 = makeState("界界界界界界界", { line: 0, column: 7 });
    const r2 = renderBufferLines(st2, 12, 24);
    const b2 = blockCursorAt(r2[1]!);
    expect(b2.blockIndex).toBe(2);
    expect(getWrappedCursorRow(st2, 24, 12)).toBe(1);
    expect(getWrappedCursorColumn(st2, 12)).toBe(2);
  });

  test("wrap CONTENT sanity: 10 wide chars over width 12 → 6 + 4", () => {
    const state = makeState("界界界界界界界界界界", { line: 0, column: 0 });
    const rows = renderBufferLines(state, 12, 24);
    const sw = (t: string): number => [...t].reduce((w, ch) => w + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
    expect(sw(stripAnsi(rows[0]!))).toBe(12);
    expect(sw(stripAnsi(rows[1]!))).toBe(12); // padded to the width
  });
});
