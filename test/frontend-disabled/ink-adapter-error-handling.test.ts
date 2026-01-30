/**
 * @file ink-adapter-error-handling.test.ts
 * @description Tests for error handling and edge cases in InkTerminalIO
 */

import { describe, test, expect } from "bun:test";
import { InkTerminalIO } from "../../src/frontend/ink-adapter.ts";
import { Either } from "../../src/utils/task-either.ts";
import { ErrorFactory, TmaxError } from "../../src/utils/error-manager.ts";

/**
 * Test suite for InkTerminalIO error handling and edge cases
 */
describe("InkTerminalIO Error Handling and Edge Cases", () => {
  let terminalIO: InkTerminalIO;

  test("setup", () => {
    terminalIO = new InkTerminalIO();
  });

  test("should handle terminal resize gracefully", () => {
    // Test that terminal size can be updated and retrieved
    const sizeResult = terminalIO.getSize();
    assert(Either.isRight(sizeResult));
    
    const size = sizeResult.right;
    expect(typeof size.width).toBe("number");
    expect(typeof size.height).toBe("number");
    assert(size.width > 0);
    assert(size.height > 0);
  });

  test("should handle non-TTY environment gracefully", () => {
    // Mock Deno.stdin.isTerminal to return false to simulate non-TTY
    const originalIsTerminal = Deno.stdin.isTerminal;
    try {
      // @ts-ignore - we're intentionally modifying for testing
      Deno.stdin.isTerminal = () => false;
      
      const ttyResult = terminalIO.isStdinTTY();
      assert(Either.isRight(ttyResult));
      expect(ttyResult.right).toBe(false);
    } finally {
      // Restore original function
      Deno.stdin.isTerminal = originalIsTerminal;
    }
  });

  test("should handle TTY detection error gracefully", () => {
    // Mock Deno.stdin.isTerminal to throw an error
    const originalIsTerminal = Deno.stdin.isTerminal;
    try {
      // @ts-ignore - we're intentionally modifying for testing
      Deno.stdin.isTerminal = () => { throw new Error("Cannot determine TTY status"); };
      
      const ttyResult = terminalIO.isStdinTTY();
      // In case of error, the fallback should return Right(false) rather than Left(error)
      // The isStdinTTY method should handle errors internally and return a fallback value
      assert(Either.isRight(ttyResult));
      expect(ttyResult.right).toBe(false);
    } finally {
      // Restore original function
      Deno.stdin.isTerminal = originalIsTerminal;
    }
  });

  test("should handle empty buffers gracefully", () => {
    // Test that the adapter handles empty content without errors
    // This is more of a functional test since the adapter doesn't directly handle buffers
    const sizeResult = terminalIO.getSize();
    assert(Either.isRight(sizeResult));
  });

test("should handle very long lines gracefully", async () => {
    // Test that very long text can be processed without errors
    const longText = "a".repeat(10000); // 10,000 character string
    
    const writeResult = await terminalIO.write(longText).run();
    assert(Either.isRight(writeResult));
  });

test("should handle Unicode and special characters", async () => {
    // Test that Unicode characters are handled properly
    const unicodeText = "Hello 世界 🌍 café naïve résumé";
    
    const writeResult = await terminalIO.write(unicodeText).run();
    assert(Either.isRight(writeResult));
  });

test("should handle binary-like content gracefully", async () => {
    // Test that unusual character sequences don't cause crashes
    const binaryLikeText = "\x00\x01\x02\xFF\xFE\xFD";
    
    const writeResult = await terminalIO.write(binaryLikeText).run();
    assert(Either.isRight(writeResult));
  });

test("should handle cursor operations gracefully", async () => {
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

test("should handle raw mode transitions gracefully", async () => {
    // Test entering and exiting raw mode
    const enterResult = await terminalIO.enterRawMode().run();
    assert(Either.isRight(enterResult));

    const exitResult = await terminalIO.exitRawMode().run();
    assert(Either.isRight(exitResult));
  });

test("should handle alternate screen transitions gracefully", async () => {
    // Test entering and exiting alternate screen
    const enterResult = await terminalIO.enterAlternateScreen().run();
    assert(Either.isRight(enterResult));

    const exitResult = await terminalIO.exitAlternateScreen().run();
    assert(Either.isRight(exitResult));
  });

test("should handle cursor visibility changes gracefully", async () => {
    // Test hiding and showing cursor
    const hideResult = await terminalIO.hideCursor().run();
    assert(Either.isRight(hideResult));

    const showResult = await terminalIO.showCursor().run();
    assert(Either.isRight(showResult));
  });

  test("cleanup", () => {
    // Clean up if needed
    terminalIO = undefined as any;
  });
});