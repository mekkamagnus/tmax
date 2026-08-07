/** ansi-parser.test.ts — ANSI escape sequence parser tests */
import { describe, test, expect } from "bun:test";
import { ANSIParser } from "../../src/syntax/ansi-parser.ts";
import type { ScreenOp } from "../../src/core/screen-buffer.ts";

function parseOps(input: string): ScreenOp[] {
  const ops: ScreenOp[] = [];
  const parser = new ANSIParser((op) => ops.push(op));
  parser.feed(input);
  return ops;
}

describe("ANSIParser", () => {
  test("plain text → write ops", () => {
    const ops = parseOps("hello");
    expect(ops).toHaveLength(5);
    expect(ops.every((o) => o.type === "write")).toBe(true);
    expect((ops[0] as any).char).toBe("h");
  });

  test("newlines and carriage returns", () => {
    const ops = parseOps("a\nb");
    expect(ops.filter((o) => o.type === "newline")).toHaveLength(1);
  });

  test("cursor up (CUU): \\x1b[3A", () => {
    const ops = parseOps("\x1b[3A");
    expect(ops[0]).toEqual({ type: "cursorUp", n: 3 });
  });

  test("cursor position (CUP): \\x1b[5;10H", () => {
    const ops = parseOps("\x1b[5;10H");
    expect(ops[0]).toEqual({ type: "cursorMove", row: 4, col: 9 });
  });

  test("erase display (ED): \\x1b[2J", () => {
    const ops = parseOps("\x1b[2J");
    expect(ops[0]).toEqual({ type: "eraseDisplay", mode: 2 });
  });

  test("erase line (EL): \\x1b[K", () => {
    const ops = parseOps("\x1b[K");
    expect(ops[0]).toEqual({ type: "eraseLine", mode: 0 });
  });

  test("SGR bold + red fg: \\x1b[1;31m", () => {
    const ops = parseOps("\x1b[1;31m");
    expect(ops[0]).toEqual({ type: "setSGR", attrs: { bold: true, fg: 2 } });
  });

  test("SGR reset: \\x1b[0m", () => {
    const ops = parseOps("\x1b[0m");
    expect((ops[0] as any).attrs.bold).toBe(false);
    expect((ops[0] as any).attrs.fg).toBe(0);
  });

  test("alt screen enable: \\x1b[?1049h", () => {
    const ops = parseOps("\x1b[?1049h");
    expect(ops[0]).toEqual({ type: "altScreen", enable: true });
  });

  test("cursor visibility: \\x1b[?25l (hide) / \\x1b[?25h (show)", () => {
    expect(parseOps("\x1b[?25l")[0]).toEqual({ type: "cursorVisible", visible: false });
    expect(parseOps("\x1b[?25h")[0]).toEqual({ type: "cursorVisible", visible: true });
  });

  test("scroll region (DECSTBM): \\x1b[1;24r", () => {
    const ops = parseOps("\x1b[1;24r");
    expect(ops[0]).toEqual({ type: "setScrollRegion", top: 0, bottom: 23 });
  });

  test("OSC window title stripped: \\x1b]0;title\\x07", () => {
    const ops = parseOps("\x1b]0;my title\x07text");
    expect(ops.filter((o) => o.type === "write")).toHaveLength(4); // "text"
  });

  test("incomplete sequence buffered (no output until complete)", () => {
    const ops: ScreenOp[] = [];
    const parser = new ANSIParser((op) => ops.push(op));
    parser.feed("\x1b[3");
    expect(ops).toHaveLength(0); // incomplete, buffered
    parser.feed("A");
    expect(ops).toEqual([{ type: "cursorUp", n: 3 }]);
  });

  test("backspace moves cursor back", () => {
    const ops = parseOps("\b");
    expect(ops[0]).toEqual({ type: "cursorBack", n: 1 });
  });

  test("tab advances cursor", () => {
    const ops = parseOps("\t");
    expect(ops[0]).toEqual({ type: "cursorForward", n: 8 });
  });
});
