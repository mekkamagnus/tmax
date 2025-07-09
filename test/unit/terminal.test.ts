/**
 * @file terminal.test.ts
 * @description Tests for terminal I/O system
 */

import { assertEquals, assertExists } from "@std/assert";
import { TerminalIOImpl } from "../../src/core/terminal.ts";
import type { TerminalIO } from "../../src/core/types.ts";

/**
 * Test suite for terminal I/O functionality
 */
Deno.test("TerminalIO", async (t) => {
  let terminal: TerminalIO;

  await t.step("should create terminal instance", () => {
    terminal = new TerminalIOImpl();
    assertExists(terminal);
  });

  await t.step("should get terminal size", () => {
    const size = terminal.getSize();
    assertExists(size);
    assertEquals(typeof size.width, "number");
    assertEquals(typeof size.height, "number");
  });

  await t.step("should have cursor movement methods", () => {
    assertExists(terminal.moveCursor);
    assertExists(terminal.write);
    assertExists(terminal.clear);
  });

  await t.step("should have raw mode methods", () => {
    assertExists(terminal.enterRawMode);
    assertExists(terminal.exitRawMode);
  });
});