/**
 * @file input-tokenizer.test.ts
 * @description BUG-50 / #62 — tokenizeTerminalInput handles Home/End/Ctrl-arrow/
 * Shift-arrow/F-keys as single tokens (was splitting into constituent bytes).
 */
import { describe, expect, test } from "bun:test";
import { tokenizeTerminalInput } from "../../src/frontend/render/input.ts";

describe("tokenizeTerminalInput — extended escape sequences (#62 / BUG-50)", () => {
  test("Home / End (CSI + SS3)", () => {
    expect(tokenizeTerminalInput("\x1b[H").keys).toEqual(["Home"]);
    expect(tokenizeTerminalInput("\x1b[F").keys).toEqual(["End"]);
    expect(tokenizeTerminalInput("\x1bOH").keys).toEqual(["Home"]);
    expect(tokenizeTerminalInput("\x1bOF").keys).toEqual(["End"]);
  });

  test("Ctrl-arrows", () => {
    expect(tokenizeTerminalInput("\x1b[1;5A").keys).toEqual(["Ctrl-Up"]);
    expect(tokenizeTerminalInput("\x1b[1;5B").keys).toEqual(["Ctrl-Down"]);
    expect(tokenizeTerminalInput("\x1b[1;5C").keys).toEqual(["Ctrl-Right"]);
    expect(tokenizeTerminalInput("\x1b[1;5D").keys).toEqual(["Ctrl-Left"]);
  });

  test("Shift-arrows", () => {
    expect(tokenizeTerminalInput("\x1b[1;2A").keys).toEqual(["Shift-Up"]);
    expect(tokenizeTerminalInput("\x1b[1;2C").keys).toEqual(["Shift-Right"]);
  });

  test("F-keys (F1-F12)", () => {
    expect(tokenizeTerminalInput("\x1bOP").keys).toEqual(["F1"]);
    expect(tokenizeTerminalInput("\x1bOQ").keys).toEqual(["F2"]);
    expect(tokenizeTerminalInput("\x1b[15~").keys).toEqual(["F5"]);
    expect(tokenizeTerminalInput("\x1b[24~").keys).toEqual(["F12"]);
  });

  test("existing keys still work (no regression)", () => {
    expect(tokenizeTerminalInput("\x1b[A").keys).toEqual(["Up"]);
    expect(tokenizeTerminalInput("\x1b[B").keys).toEqual(["Down"]);
    expect(tokenizeTerminalInput("\x1b[5~").keys).toEqual(["PageUp"]);
    expect(tokenizeTerminalInput("a").keys).toEqual(["a"]);
    expect(tokenizeTerminalInput("\r").keys).toEqual(["\n"]);
  });

  test("mixed input: text + escape sequences", () => {
    const result = tokenizeTerminalInput("hello\x1b[Hworld");
    expect(result.keys).toEqual(["h", "e", "l", "l", "o", "Home", "w", "o", "r", "l", "d"]);
  });
});
