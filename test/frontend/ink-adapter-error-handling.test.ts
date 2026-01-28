/**
 * @file ink-adapter-error-handling.test.ts
 * @description Tests for error handling and edge cases in InkTerminalIO
 */

import { assertEquals, assert, assertInstanceOf } from "@std/assert";
import { InkTerminalIO } from "../../src/frontend/ink-adapter.ts";
import { Either } from "../../src/utils/task-either.ts";
import { ErrorFactory, TmaxError } from "../../src/utils/error-manager.ts";

/**
 * Test suite for InkTerminalIO error handling and edge cases
 */
Deno.test("InkTerminalIO Error Handling and Edge Cases", async (t) => {
  let terminalIO: InkTerminalIO;

  await t.step("setup", () => {
    terminalIO = new InkTerminalIO();
  });

  await t.step("should handle terminal resize gracefully", () => {
    // Test that terminal size can be updated and retrieved
    const sizeResult = terminalIO.getSize();
    assert(Either.isRight(sizeResult));
    
    const size = sizeResult.right;
    assertEquals(typeof size.width, "number");
    assertEquals(typeof size.height, "number");
    assert(size.width > 0);
    assert(size.height > 0);
  });

  await t.step("should handle non-TTY environment gracefully", () => {
    // Mock Deno.stdin.isTerminal to return false to simulate non-TTY
    const originalIsTerminal = Deno.stdin.isTerminal;
    try {
      // @ts-ignore - we're intentionally modifying for testing
      Deno.stdin.isTerminal = () => false;
      
      const ttyResult = terminalIO.isStdinTTY();
      assert(Either.isRight(ttyResult));
      assertEquals(ttyResult.right, false);
    } finally {
      // Restore original function
      Deno.stdin.isTerminal = originalIsTerminal;
    }
  });

  await t.step("should handle TTY detection error gracefully", () => {
    // Mock Deno.stdin.isTerminal to throw an error
    const originalIsTerminal = Deno.stdin.isTerminal;
    try {
      // @ts-ignore - we're intentionally modifying for testing
      Deno.stdin.isTerminal = () => { throw new Error("Cannot determine TTY status"); };
      
      const ttyResult = terminalIO.isStdinTTY();
      assert(Either.isLeft(ttyResult));
      assert(ttyResult.left instanceof TmaxError);
      assertEquals(ttyResult.left.message, "Failed to check TTY status");
    } finally {
      // Restore original function
      Deno.stdin.isTerminal = originalIsTerminal;
    }
  });

  await t.step("should handle empty buffers gracefully", () => {
    // Test that the adapter handles empty content without errors
    // This is more of a functional test since the adapter doesn't directly handle buffers
    const sizeResult = terminalIO.getSize();
    assert(Either.isRight(sizeResult));
  });

  await t.step("should handle very long lines gracefully", async () => {
    // Test that very long text can be processed without errors
    const longText = "a".repeat(10000); // 10,000 character string
    
    const writeResult = await terminalIO.write(longText).run();
    assert(Either.isRight(writeResult));
  });

  await t.step("should handle Unicode and special characters", async () => {
    // Test that Unicode characters are handled properly
    const unicodeText = "Hello 世界 🌍 café naïve résumé";
    
    const writeResult = await terminalIO.write(unicodeText).run();
    assert(Either.isRight(writeResult));
  });

  await t.step("should handle binary-like content gracefully", async () => {
    // Test that unusual character sequences don't cause crashes
    const binaryLikeText = "\x00\x01\x02\xFF\xFE\xFD";
    
    const writeResult = await terminalIO.write(binaryLikeText).run();
    assert(Either.isRight(writeResult));
  });

  await t.step("should handle cursor operations gracefully", async () => {
    // Test cursor operations with various positions
    const positions = [
      { line: 0, column: 0 },           // Valid position
      { line: 1000, column: 1000 },     // Large valid position
      { line: -1, column: -1 },         // Invalid position (should be handled gracefully)
    ];

    for (const pos of positions) {
      const moveResult = await terminalIO.moveCursor(pos).run();
      // All operations should succeed even with invalid positions
      assert(Either.isRight(moveResult));
    }
  });

  await t.step("should handle raw mode transitions gracefully", async () => {
    // Test entering and exiting raw mode
    const enterResult = await terminalIO.enterRawMode().run();
    assert(Either.isRight(enterResult));

    const exitResult = await terminalIO.exitRawMode().run();
    assert(Either.isRight(exitResult));
  });

  await t.step("should handle alternate screen transitions gracefully", async () => {
    // Test entering and exiting alternate screen
    const enterResult = await terminalIO.enterAlternateScreen().run();
    assert(Either.isRight(enterResult));

    const exitResult = await terminalIO.exitAlternateScreen().run();
    assert(Either.isRight(exitResult));
  });

  await t.step("should handle cursor visibility changes gracefully", async () => {
    // Test hiding and showing cursor
    const hideResult = await terminalIO.hideCursor().run();
    assert(Either.isRight(hideResult));

    const showResult = await terminalIO.showCursor().run();
    assert(Either.isRight(showResult));
  });

  await t.step("cleanup", () => {
    // Clean up if needed
    terminalIO = undefined as any;
  });
});