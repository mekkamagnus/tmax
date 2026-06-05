import { describe, expect, test } from "bun:test";
import { tokenizeTerminalInput } from "../../src/core/terminal.ts";

describe("tokenizeTerminalInput", () => {
  test("splits pasted plain text into individual keys", () => {
    expect(tokenizeTerminalInput("iHello")).toEqual(["i", "H", "e", "l", "l", "o"]);
  });

  test("preserves semantic arrow-key identity", () => {
    expect(tokenizeTerminalInput("\x1b[A")).toEqual(["Up"]);
  });

  test("handles mixed escape sequence and characters", () => {
    expect(tokenizeTerminalInput("\x1b[Ai")).toEqual(["Up", "i"]);
  });

  test("keeps alt-modified key as one event", () => {
    expect(tokenizeTerminalInput("\x1bx")).toEqual(["\x1bx"]);
  });
});
