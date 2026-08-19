/** screen-buffer.test.ts — virtual terminal screen buffer tests */
import { describe, test, expect } from "bun:test";
import { ScreenBuffer } from "../../src/core/screen-buffer.ts";
import { ANSIParser } from "../../src/syntax/ansi-parser.ts";
import type { Cell } from "../../src/core/screen-buffer.ts";

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
