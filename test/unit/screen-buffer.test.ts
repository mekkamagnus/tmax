/** screen-buffer.test.ts — virtual terminal screen buffer tests */
import { describe, test, expect } from "bun:test";
import { ScreenBuffer } from "../../src/core/screen-buffer.ts";
import { ANSIParser } from "../../src/syntax/ansi-parser.ts";
import type { Cell } from "../../src/core/screen-buffer.ts";
import { readFileSync } from "node:fs";

describe("ScreenBuffer", () => {
  test("write chars + newline → cursor advances", () => {
    const sb = new ScreenBuffer(5, 10);
    sb.apply({ type: "write", char: "h" });
    sb.apply({ type: "write", char: "i" });
    expect(sb.cursor.col).toBe(2);
    expect(sb.getLine(0)).toBe("hi        ");
  });

  test("newline scrolls when at bottom of scroll region", () => {
    const sb = new ScreenBuffer(3, 5);
    sb.apply({ type: "cursorMove", row: 2, col: 0 });
    sb.apply({ type: "newline" });
    expect(sb.cursor.row).toBe(2); // stays at bottom (scrolled)
    expect(sb.scrollback.length).toBe(1); // top line pushed to scrollback
  });

  test("eraseDisplay mode 2 clears all", () => {
    const sb = new ScreenBuffer(3, 5);
    sb.apply({ type: "write", char: "x" });
    sb.apply({ type: "eraseDisplay", mode: 2 });
    expect(sb.getLine(0)).toBe("     ");
  });

  test("altScreen preserves/restores primary buffer", () => {
    const sb = new ScreenBuffer(3, 5);
    sb.apply({ type: "write", char: "A" });
    sb.apply({ type: "altScreen", enable: true });
    sb.apply({ type: "write", char: "B" });
    expect(sb.getLine(0)).toBe("B    "); // alt screen
    sb.apply({ type: "altScreen", enable: false });
    expect(sb.getLine(0)).toBe("A    "); // primary restored
  });

  test("resize preserves content", () => {
    const sb = new ScreenBuffer(3, 5);
    sb.apply({ type: "write", char: "X" });
    sb.resize(5, 8);
    expect(sb.rows).toBe(5);
    expect(sb.cols).toBe(8);
    expect(sb.getLine(0).startsWith("X")).toBe(true);
  });

  test("scrollUp pushes to scrollback", () => {
    const sb = new ScreenBuffer(3, 5);
    sb.apply({ type: "write", char: "A" });
    sb.apply({ type: "cursorMove", row: 1, col: 0 });
    sb.apply({ type: "write", char: "B" });
    sb.apply({ type: "scrollUp", n: 1 });
    expect(sb.scrollback.length).toBe(1);
    expect(sb.getLine(0).startsWith("B")).toBe(true); // B shifted up
  });

  test("SGR attributes applied to cells", () => {
    const sb = new ScreenBuffer(2, 5);
    sb.apply({ type: "setSGR", attrs: { bold: true, fg: 2 } });
    sb.apply({ type: "write", char: "Z" });
    expect(sb.cells[0]![0]!.bold).toBe(true);
    expect(sb.cells[0]![0]!.fg).toBe(2);
  });
});

// #202: styled line rendering — colors survive the cells → ANSI round trip.
describe("#202 getStyledLine", () => {
  function feedAndRender(input: string, row = 0): string {
    const screen = new ScreenBuffer(5, 80);
    const parser = new ANSIParser((op) => screen.apply(op));
    parser.feed(input);
    return screen.getStyledLine(row);
  }

  test("plain text emits no escape codes and no row padding", () => {
    expect(feedAndRender("hello")).toBe("hello");
  });

  test("SGR red round-trips EXACTLY (palette bias decoded)", () => {
    const line = feedAndRender("\x1b[31mRED\x1b[0m plain");
    expect(line).toContain("\x1b[38;5;1mRED");
    // An explicit reset closes the red run before the plain text (no bleed).
    expect(line).toContain("RED\x1b[0m plain");
    expect(line).not.toContain("\x1b[38;5;1mRED plain");
    // The off-by-one this test pins: 31 must NOT render as palette 2.
    expect(line).not.toContain("38;5;2mRED");
  });

  test("bold + color combine; 256-color passes through exactly", () => {
    const line = feedAndRender("\x1b[1;32mBG\x1b[0m \x1b[38;5;208mOR\x1b[0m");
    expect(line).toContain("\x1b[1;38;5;2mBG");
    expect(line).toContain("\x1b[38;5;208mOR");
  });

  test("consecutive same-style cells dedupe into one prefix", () => {
    const line = feedAndRender("\x1b[31mABCDE\x1b[0m");
    expect(line.split("ABCDE")[0]).toBe("\x1b[38;5;1m"); // exactly one prefix
  });

  test("truecolor round-trips (RGB fields reach the cell — #164 gap)", () => {
    const line = feedAndRender("\x1b[38;2;10;20;30mX\x1b[0m");
    expect(line).toContain("\x1b[38;2;10;20;30mX");
  });

  test("wide glyphs occupy a continuation cell (columns after them align)", () => {
    const screen = new ScreenBuffer(3, 20);
    const parser = new ANSIParser((op) => screen.apply(op));
    parser.feed("\u{1F30C}\u{1F30C}XY");
    // Measure COLUMNS (cells), not JS string indices — surrogate pairs make
    // indexOf lie about columns. 2 wide emoji = 4 columns; X at cell 4.
    const cells = (screen as unknown as { cells: Cell[][] }).cells[0]!;
    expect(cells[0]!.char).toBe("\u{1F30C}");
    expect(cells[1]!.char).toBe(" "); // continuation
    expect(cells[4]!.char).toBe("X");
    expect(cells[5]!.char).toBe("Y");
    expect(screen.getStyledLine(0).includes("XY")).toBe(true);
  });

  test("transport emoji (rocket) and arrow blocks are WIDE (gate retry 1 gap)", () => {
    const screen = new ScreenBuffer(3, 20);
    const parser = new ANSIParser((op) => screen.apply(op));
    parser.feed("\u{1F680}\u{1F680}Z\u{2B06}W");
    const cells = (screen as unknown as { cells: Cell[][] }).cells[0]!;
    expect(cells[4]!.char).toBe("Z");     // two rockets = 4 columns
    expect(cells[5]!.char).toBe("\u{2B06}");
    expect(cells[7]!.char).toBe("W");     // wide arrow consumed 2 columns
  });

  test("wide glyph at the LAST column wraps without extending the row", () => {
    const screen = new ScreenBuffer(3, 6);
    const parser = new ANSIParser((op) => screen.apply(op));
    parser.feed("abcde\u{1F30C}X"); // wide glyph lands at col 5 (last)
    const row0 = (screen as unknown as { cells: Cell[][] }).cells[0]!;
    expect(row0.length).toBe(6); // row never exceeds cols
    expect(row0[5]!.char).toBe("\u{1F30C}"); // the intact code point (not torn)
    const row1 = (screen as unknown as { cells: Cell[][] }).cells[1]!;
    expect(row1[0]!.char).toBe("X"); // next char wrapped
  });

  test("truecolor BACKGROUND survives blank cells", () => {
    const line = feedAndRender("\x1b[48;2;1;2;3m  X\x1b[0m");
    expect(line).toContain("48;2;1;2;3");
    expect(line).toContain("  X");
  });
});
// #204: precise IL/DL/DCH/ICH — the old approximations (scroll-from-top /
// blank-to-EOL) corrupted Ink-style redraws (claude's input box vanished).
describe("#204 line/char edit ops", () => {
  function fed(input: string, rows = 6, cols = 20): ScreenBuffer {
    const screen = new ScreenBuffer(rows, cols);
    // Same adapter TerminalManager uses: CR/VPA arrive with row/col -1
    // meaning "current" — raw ScreenBuffer.apply does not normalize them.
    const parser = new ANSIParser((op) => {
      if (op.type === "cursorMove") {
        screen.apply({
          type: "cursorMove",
          row: op.row === -1 ? screen.cursor.row : op.row,
          col: op.col === -1 ? screen.cursor.col : op.col,
        });
        return;
      }
      screen.apply(op);
    });
    parser.feed(input);
    return screen;
  }

  test("IL inserts at the cursor; content ABOVE and the cursor line shift down, below-region untouched", () => {
    // 3 rows: AAA/BBB/CCC; cursor to row 1; insert 1 line.
    const s = fed("AAA\r\nBBB\r\nCCC\x1b[2;1H\x1b[L", 4, 8);
    expect(s.getLine(0)).toMatch(/^AAA/);
    expect(s.getLine(1)).toMatch(/^\s+$/); // inserted blank
    expect(s.getLine(2)).toMatch(/^BBB/);   // shifted down
    expect(s.getLine(3)).toMatch(/^CCC/);   // below cursor pushed, not lost
  });

  test("DL deletes at the cursor; lines below shift up", () => {
    const s = fed("AAA\r\nBBB\r\nCCC\x1b[1;1H\x1b[M", 3, 8);
    expect(s.getLine(0)).toMatch(/^BBB/);
    expect(s.getLine(1)).toMatch(/^CCC/);
    expect(s.getLine(2)).toMatch(/^\s+$/);
  });

  test("DCH deletes at the cursor and shifts the REST OF THE LINE left (not blank-to-EOL)", () => {
    // "hello world", cursor at col 5, delete 1 char -> "helloworld"
    const s = fed("hello world\x1b[1;6H\x1b[P", 2, 20);
    expect(s.getLine(0)).toMatch(/^helloworld\s*$/);
  });

  test("IL/DL move the cursor to column 1 and no-op outside the region (xterm)", () => {
    const s1 = fed("abcdef\x1b[1;4H\x1b[L", 4, 10);
    expect((s1 as unknown as { cursor: { col: number } }).cursor.col).toBe(0);
    // cursor ABOVE the region top: IL/DL are no-ops
    const s2 = fed("abc\r\ndef\x1b[3;1r\x1b[1;1H\x1b[L", 4, 8);
    expect(s2.getLine(0)).toMatch(/^abc/);
    expect(s2.getLine(1)).toMatch(/^def/);
  });

  test("ICH inserts blanks at the cursor, rest shifts right", () => {
    const s = fed("abcdef\x1b[1;2H\x1b[2@", 2, 12);
    expect(s.getLine(0)).toMatch(/^a\s\sbcdef\s*$/);
  });
});
// #204 regression: a REAL captured claude welcome-screen stream (35x108
// PTY). Root cause: DECSTBM with an omitted bottom (ESC[r = reset) defaulted
// the region bottom to 24 — on a 35-row terminal every cursorDown clamped at
// row 23, collapsing the input box + status onto one row ("input box not
// showing"). The fix: -1 sentinel resolved to the last row by the buffer.
describe("#204 claude welcome replay (DECSTBM default bottom)", () => {
  test("the input box renders near the BOTTOM, not collapsed onto row 23", () => {
    const data = readFileSync(import.meta.dir + "/../fixtures/claude-welcome-35x108.bin", "utf8");
    const screen = new ScreenBuffer(35, 108);
    const parser = new ANSIParser((op) => {
      if (op.type === "cursorMove") {
        screen.apply({
          type: "cursorMove",
          row: op.row === -1 ? screen.cursor.row : op.row,
          col: op.col === -1 ? screen.cursor.col : op.col,
        });
        return;
      }
      screen.apply(op);
    });
    parser.feed(data);
    const lines = Array.from({ length: screen.rows }, (_, r) => screen.getLine(r));
    const inputRow = lines.findIndex((l) => l.includes("❯"));
    expect(inputRow).toBe(31);           // bottom-anchored input box
    expect(inputRow).not.toBe(23);       // the collapsed row (the bug)
    expect(lines[33]).toContain("md-journal -> glm");  // status line below
    expect(lines[1]).toContain("Claude Code v");       // box top intact
  });

  test("ESC[r (bare reset) sets the region to the FULL screen at any size", () => {
    const screen = new ScreenBuffer(40, 20);
    const parser = new ANSIParser((op) => screen.apply(op));
    parser.feed("\x1b[r"); // reset with NO params
    const region = (screen as unknown as { scrollRegion: { top: number; bottom: number } }).scrollRegion;
    expect(region).toEqual({ top: 0, bottom: 39 }); // NOT 23
  });
});
