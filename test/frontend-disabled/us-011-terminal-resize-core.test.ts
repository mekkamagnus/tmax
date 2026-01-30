/**
 * @file us-011-terminal-resize-core.test.ts
 * @description Tests for terminal resize handling and viewport management (core functionality)
 */

import { describe, test, expect } from "bun:test";
import { InkTerminalIO } from "../../src/frontend/ink-adapter.ts";
import { Either } from "../../src/utils/task-either.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";

/**
 * Test suite for terminal resize handling
 */
describe("Terminal Resize Handling", () => {
  let terminalIO: InkTerminalIO;

  test("setup", () => {
    terminalIO = new InkTerminalIO();
  });

  test("should handle terminal resize without crashing", () => {
    // Test initial size retrieval
    const initialSize = terminalIO.getSize();
    expect($1).toBe(true));
    
    // Update to a new size (simulating resize)
    terminalIO.updateSize(120, 40);
    const newSize = terminalIO.getSize();
    expect($1).toBe(true));
    expect(newSize.right.width).toBe(120);
    expect(newSize.right.height).toBe(40);
  });

  test("should notify size change listeners", () => {
    let receivedSize: { width: number; height: number } | null = null;
    
    // Register a listener
    terminalIO.onSizeChange((size) => {
      receivedSize = size;
    });
    
    // Trigger a size update
    terminalIO.updateSize(80, 25);
    
    // Verify the listener was called
    expect($1).toBe(true);
    expect(receivedSize?.width).toBe(80);
    expect(receivedSize?.height).toBe(25);
  });

  test("should handle rapid resize events gracefully", () => {
    // Simulate multiple rapid resize events
    for (let i = 0; i < 10; i++) {
      terminalIO.updateSize(80 + i, 24 + i);
      const size = terminalIO.getSize();
      expect($1).toBe(true));
    }
  });

  test("cleanup", () => {
    terminalIO = undefined as any;
  });
});

/**
 * Test suite for non-TTY environment handling
 */
describe("Non-TTY Environment Handling", () => {
  let terminalIO: InkTerminalIO;

  test("setup", () => {
    terminalIO = new InkTerminalIO();
  });

  test("should handle non-TTY environment gracefully", () => {
    // Mock Deno.stdin.isTerminal to return false to simulate non-TTY
    const originalIsTerminal = Deno.stdin?.isTerminal;
    
    if (Deno.stdin) {
      try {
        // @ts-ignore - we're intentionally modifying for testing
        Deno.stdin.isTerminal = () => false;

        const ttyResult = terminalIO.isStdinTTY();
        expect($1).toBe(true));
        expect(ttyResult.right).toBe(false);
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
      expect($1).toBe(true));
      expect(ttyResult.right).toBe(false);
    }
  });

  test("should handle missing Deno.stdin gracefully", () => {
    // Temporarily remove Deno.stdin to test fallback
    const originalStdin = Deno.stdin;
    
    try {
      // @ts-ignore - intentionally removing for testing
      delete Deno.stdin;
      
      const ttyResult = terminalIO.isStdinTTY();
      expect($1).toBe(true));
      expect(ttyResult.right).toBe(false);
    } finally {
      // Restore Deno.stdin
      (Deno as any).stdin = originalStdin;
    }
  });

  test("cleanup", () => {
    terminalIO = undefined as any;
  });
});

/**
 * Test suite for file I/O error handling during rendering
 */
describe("File I/O Error Handling During Rendering", () => {
  test("should handle file read errors gracefully during buffer operations", () => {
    // Create a buffer with content that might cause issues
    const problematicContent = "Line 1\nLine 2\n" + "A".repeat(10000) + "\nLine 4";
    const buffer = FunctionalTextBufferImpl.create(problematicContent);

    // Test operations that could potentially cause issues
    const lineCountResult = buffer.getLineCount();
    expect($1).toBe(true));
    
    const lineResult = buffer.getLine(0);
    expect($1).toBe(true));
    
    // Test with potentially problematic line numbers
    const testLines = [-1, 0, 1, 2, 10, 100];
    for (const lineNum of testLines) {
      const result = buffer.getLine(lineNum);
      // Should not crash, even if result is Left for out-of-bounds
      expect($1).toBe(true);
    }
  });

  test("should handle binary file content gracefully", () => {
    // Create a buffer with binary-like content
    const binaryContent = "\x00\x01\x02\x03Hello World\xff\xfe\xfd\xfc";
    const buffer = FunctionalTextBufferImpl.create(binaryContent);

    // Operations should not crash with binary content
    const lineCountResult = buffer.getLineCount();
    expect($1).toBe(true));
    
    const contentResult = buffer.getContent();
    expect($1).toBe(true));
    expect($1).toBe(true);
  });
});

/**
 * Test suite for empty buffer handling
 */
describe("Empty Buffer Handling", () => {
  test("should display empty buffers correctly", () => {
    const emptyBuffer = FunctionalTextBufferImpl.create("");

    const lineCountResult = emptyBuffer.getLineCount();
    expect($1).toBe(true));
    // An empty buffer has 1 line (an empty line)
    expect(lineCountResult.right).toBe(1);

    const contentResult = emptyBuffer.getContent();
    expect($1).toBe(true));
    expect(contentResult.right).toBe("");

    // Getting the first (and only) line should return an empty string
    const lineResult = emptyBuffer.getLine(0);
    expect($1).toBe(true));
    expect(lineResult.right).toBe("");
  });

  test("should handle buffers with only newlines", () => {
    const newlineBuffer = FunctionalTextBufferImpl.create("\n\n\n");

    const lineCountResult = newlineBuffer.getLineCount();
    expect($1).toBe(true));
    // 3 newlines create 4 lines (empty content between newlines)
    expect(lineCountResult.right).toBe(4);

    for (let i = 0; i < 4; i++) {
      const lineResult = newlineBuffer.getLine(i);
      expect($1).toBe(true));
      expect(lineResult.right).toBe(""); // Each line should be empty
    }
  });
});

/**
 * Test suite for long line handling
 */
describe("Long Line Handling", () => {
  test("should handle very long lines gracefully", () => {
    // Create a buffer with extremely long lines
    const longLine = "A".repeat(10000); // 10,000 character line
    const buffer = FunctionalTextBufferImpl.create(longLine);

    const lineResult = buffer.getLine(0);
    expect($1).toBe(true));
    // The line should have the expected length (or close to it)
    expect($1).toBe(true); // Allow for some implementation details

    const contentResult = buffer.getContent();
    expect($1).toBe(true));
    // The content should have the expected length (or close to it)
    expect($1).toBe(true); // Allow for some implementation details
    expect($1).toBe(true) === "AAAAAAAAAA");
  });

  test("should handle multiple very long lines", () => {
    const longLines = [
      "First line: " + "A".repeat(5000),
      "Second line: " + "B".repeat(7500),
      "Third line: " + "C".repeat(10000)
    ];
    const bufferContent = longLines.join('\n');
    const buffer = FunctionalTextBufferImpl.create(bufferContent);

    const lineCountResult = buffer.getLineCount();
    expect($1).toBe(true));
    expect(lineCountResult.right).toBe(3);

    for (let i = 0; i < 3; i++) {
      const lineResult = buffer.getLine(i);
      expect($1).toBe(true));
      expect($1).toBe(true))); // Check beginning
    }
  });
});

/**
 * Test suite for Unicode and special character handling
 */
describe("Unicode and Special Character Handling", () => {
  test("should handle Unicode characters correctly", () => {
    const unicodeContent = "Hello 世界 🌍 café naïve résumé\nSecond line: مرحبا بالعالم 👋\nThird line: 🇺🇸 Español: ñáéíóú";
    const buffer = FunctionalTextBufferImpl.create(unicodeContent);

    const lineCountResult = buffer.getLineCount();
    expect($1).toBe(true));
    expect(lineCountResult.right).toBe(3);

    const contentResult = buffer.getContent();
    expect($1).toBe(true));
    expect($1).toBe(true));
    expect($1).toBe(true));
    expect($1).toBe(true));
    expect($1).toBe(true));
    expect($1).toBe(true));
    expect($1).toBe(true));
  });

  test("should handle control characters gracefully", () => {
    const controlCharsContent = "Line with null: \x00\nLine with bell: \x07\nLine with escape: \x1b";
    const buffer = FunctionalTextBufferImpl.create(controlCharsContent);

    const lineCountResult = buffer.getLineCount();
    expect($1).toBe(true));
    expect(lineCountResult.right).toBe(3);

    // Should not crash when accessing lines with control characters
    for (let i = 0; i < 3; i++) {
      const lineResult = buffer.getLine(i);
      expect($1).toBe(true));
    }
  });
});