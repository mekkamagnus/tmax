/** screen-buffer.test.ts — virtual terminal screen buffer tests */
import { describe, test, expect } from "bun:test";
import { ScreenBuffer } from "../../src/core/screen-buffer.ts";

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
