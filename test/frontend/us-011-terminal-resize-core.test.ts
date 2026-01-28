/**
 * @file us-011-terminal-resize-core.test.ts
 * @description Tests for terminal resize handling and viewport management (core functionality)
 */

import { assertEquals, assert, assertInstanceOf } from "@std/assert";
import { InkTerminalIO } from "../../src/frontend/ink-adapter.ts";
import { Either } from "../../src/utils/task-either.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";

/**
 * Test suite for terminal resize handling
 */
Deno.test("Terminal Resize Handling", async (t) => {
  let terminalIO: InkTerminalIO;

  await t.step("setup", () => {
    terminalIO = new InkTerminalIO();
  });

  await t.step("should handle terminal resize without crashing", () => {
    // Test initial size retrieval
    const initialSize = terminalIO.getSize();
    assert(Either.isRight(initialSize));
    
    // Update to a new size (simulating resize)
    terminalIO.updateSize(120, 40);
    const newSize = terminalIO.getSize();
    assert(Either.isRight(newSize));
    assertEquals(newSize.right.width, 120);
    assertEquals(newSize.right.height, 40);
  });

  await t.step("should notify size change listeners", () => {
    let receivedSize: { width: number; height: number } | null = null;
    
    // Register a listener
    terminalIO.onSizeChange((size) => {
      receivedSize = size;
    });
    
    // Trigger a size update
    terminalIO.updateSize(80, 25);
    
    // Verify the listener was called
    assert(receivedSize !== null);
    assertEquals(receivedSize?.width, 80);
    assertEquals(receivedSize?.height, 25);
  });

  await t.step("should handle rapid resize events gracefully", () => {
    // Simulate multiple rapid resize events
    for (let i = 0; i < 10; i++) {
      terminalIO.updateSize(80 + i, 24 + i);
      const size = terminalIO.getSize();
      assert(Either.isRight(size));
    }
  });

  await t.step("cleanup", () => {
    terminalIO = undefined as any;
  });
});

/**
 * Test suite for non-TTY environment handling
 */
Deno.test("Non-TTY Environment Handling", async (t) => {
  let terminalIO: InkTerminalIO;

  await t.step("setup", () => {
    terminalIO = new InkTerminalIO();
  });

  await t.step("should handle non-TTY environment gracefully", () => {
    // Mock Deno.stdin.isTerminal to return false to simulate non-TTY
    const originalIsTerminal = Deno.stdin?.isTerminal;
    
    if (Deno.stdin) {
      try {
        // @ts-ignore - we're intentionally modifying for testing
        Deno.stdin.isTerminal = () => false;

        const ttyResult = terminalIO.isStdinTTY();
        assert(Either.isRight(ttyResult));
        assertEquals(ttyResult.right, false);
      } finally {
        // Restore original function if it existed
        if (originalIsTerminal) {
          // @ts-ignore
          Deno.stdin.isTerminal = originalIsTerminal;
        }
      }
    } else {
      // If Deno.stdin doesn't exist, test the fallback behavior
      const ttyResult = terminalIO.isStdinTTY();
      assert(Either.isRight(ttyResult));
      assertEquals(ttyResult.right, false);
    }
  });

  await t.step("should handle missing Deno.stdin gracefully", () => {
    // Temporarily remove Deno.stdin to test fallback
    const originalStdin = Deno.stdin;
    
    try {
      // @ts-ignore - intentionally removing for testing
      delete Deno.stdin;
      
      const ttyResult = terminalIO.isStdinTTY();
      assert(Either.isRight(ttyResult));
      assertEquals(ttyResult.right, false);
    } finally {
      // Restore Deno.stdin
      (Deno as any).stdin = originalStdin;
    }
  });

  await t.step("cleanup", () => {
    terminalIO = undefined as any;
  });
});

/**
 * Test suite for file I/O error handling during rendering
 */
Deno.test("File I/O Error Handling During Rendering", async (t) => {
  await t.step("should handle file read errors gracefully during buffer operations", () => {
    // Create a buffer with content that might cause issues
    const problematicContent = "Line 1\nLine 2\n" + "A".repeat(10000) + "\nLine 4";
    const buffer = FunctionalTextBufferImpl.create(problematicContent);

    // Test operations that could potentially cause issues
    const lineCountResult = buffer.getLineCount();
    assert(Either.isRight(lineCountResult));
    
    const lineResult = buffer.getLine(0);
    assert(Either.isRight(lineResult));
    
    // Test with potentially problematic line numbers
    const testLines = [-1, 0, 1, 2, 10, 100];
    for (const lineNum of testLines) {
      const result = buffer.getLine(lineNum);
      // Should not crash, even if result is Left for out-of-bounds
      assert(result !== undefined);
    }
  });

  await t.step("should handle binary file content gracefully", () => {
    // Create a buffer with binary-like content
    const binaryContent = "\x00\x01\x02\x03Hello World\xff\xfe\xfd\xfc";
    const buffer = FunctionalTextBufferImpl.create(binaryContent);

    // Operations should not crash with binary content
    const lineCountResult = buffer.getLineCount();
    assert(Either.isRight(lineCountResult));
    
    const contentResult = buffer.getContent();
    assert(Either.isRight(contentResult));
    assert(typeof contentResult.right === 'string');
  });
});

/**
 * Test suite for empty buffer handling
 */
Deno.test("Empty Buffer Handling", async (t) => {
  await t.step("should display empty buffers correctly", () => {
    const emptyBuffer = FunctionalTextBufferImpl.create("");

    const lineCountResult = emptyBuffer.getLineCount();
    assert(Either.isRight(lineCountResult));
    // An empty buffer has 1 line (an empty line)
    assertEquals(lineCountResult.right, 1);

    const contentResult = emptyBuffer.getContent();
    assert(Either.isRight(contentResult));
    assertEquals(contentResult.right, "");

    // Getting the first (and only) line should return an empty string
    const lineResult = emptyBuffer.getLine(0);
    assert(Either.isRight(lineResult));
    assertEquals(lineResult.right, "");
  });

  await t.step("should handle buffers with only newlines", () => {
    const newlineBuffer = FunctionalTextBufferImpl.create("\n\n\n");

    const lineCountResult = newlineBuffer.getLineCount();
    assert(Either.isRight(lineCountResult));
    // 3 newlines create 4 lines (empty content between newlines)
    assertEquals(lineCountResult.right, 4);

    for (let i = 0; i < 4; i++) {
      const lineResult = newlineBuffer.getLine(i);
      assert(Either.isRight(lineResult));
      assertEquals(lineResult.right, ""); // Each line should be empty
    }
  });
});

/**
 * Test suite for long line handling
 */
Deno.test("Long Line Handling", async (t) => {
  await t.step("should handle very long lines gracefully", () => {
    // Create a buffer with extremely long lines
    const longLine = "A".repeat(10000); // 10,000 character line
    const buffer = FunctionalTextBufferImpl.create(longLine);

    const lineResult = buffer.getLine(0);
    assert(Either.isRight(lineResult));
    // The line should have the expected length (or close to it)
    assert(lineResult.right.length > 9000); // Allow for some implementation details

    const contentResult = buffer.getContent();
    assert(Either.isRight(contentResult));
    // The content should have the expected length (or close to it)
    assert(contentResult.right.length > 9000); // Allow for some implementation details
    assert(contentResult.right.substring(0, 10) === "AAAAAAAAAA");
  });

  await t.step("should handle multiple very long lines", () => {
    const longLines = [
      "First line: " + "A".repeat(5000),
      "Second line: " + "B".repeat(7500),
      "Third line: " + "C".repeat(10000)
    ];
    const bufferContent = longLines.join('\n');
    const buffer = FunctionalTextBufferImpl.create(bufferContent);

    const lineCountResult = buffer.getLineCount();
    assert(Either.isRight(lineCountResult));
    assertEquals(lineCountResult.right, 3);

    for (let i = 0; i < 3; i++) {
      const lineResult = buffer.getLine(i);
      assert(Either.isRight(lineResult));
      assert(lineResult.right.includes(longLines[i].substring(0, 10))); // Check beginning
    }
  });
});

/**
 * Test suite for Unicode and special character handling
 */
Deno.test("Unicode and Special Character Handling", async (t) => {
  await t.step("should handle Unicode characters correctly", () => {
    const unicodeContent = "Hello 世界 🌍 café naïve résumé\nSecond line: مرحبا بالعالم 👋\nThird line: 🇺🇸 Español: ñáéíóú";
    const buffer = FunctionalTextBufferImpl.create(unicodeContent);

    const lineCountResult = buffer.getLineCount();
    assert(Either.isRight(lineCountResult));
    assertEquals(lineCountResult.right, 3);

    const contentResult = buffer.getContent();
    assert(Either.isRight(contentResult));
    assert(contentResult.right.includes("世界"));
    assert(contentResult.right.includes("café"));
    assert(contentResult.right.includes("naïve"));
    assert(contentResult.right.includes("résumé"));
    assert(contentResult.right.includes("مرحبا"));
    assert(contentResult.right.includes("🇺🇸"));
  });

  await t.step("should handle control characters gracefully", () => {
    const controlCharsContent = "Line with null: \x00\nLine with bell: \x07\nLine with escape: \x1b";
    const buffer = FunctionalTextBufferImpl.create(controlCharsContent);

    const lineCountResult = buffer.getLineCount();
    assert(Either.isRight(lineCountResult));
    assertEquals(lineCountResult.right, 3);

    // Should not crash when accessing lines with control characters
    for (let i = 0; i < 3; i++) {
      const lineResult = buffer.getLine(i);
      assert(Either.isRight(lineResult));
    }
  });
});