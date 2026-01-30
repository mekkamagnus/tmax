/**
 * @file terminal.test.ts
 * @description Tests for terminal I/O system
 */

import { describe, test, expect } from "bun:test";
import { TerminalIOImpl } from "../../src/core/terminal.ts";
import type { TerminalIO } from "../../src/core/types.ts";

describe("TerminalIO", () => {
  let terminal: TerminalIO;

  test("should create terminal instance", () => {
    terminal = new TerminalIOImpl();
    expect(terminal).toBeDefined();
  });

  test("should get terminal size", () => {
    const size = terminal.getSize();
    expect(size).toBeDefined();
    expect(typeof size.width).toBe("number");
    expect(typeof size.height).toBe("number");
  });

  test("should have cursor movement methods", () => {
    expect(terminal.moveCursor).toBeDefined();
    expect(terminal.write).toBeDefined();
    expect(terminal.clear).toBeDefined();
  });

  test("should have raw mode methods", () => {
    expect(terminal.enterRawMode).toBeDefined();
    expect(terminal.exitRawMode).toBeDefined();
  });
});
