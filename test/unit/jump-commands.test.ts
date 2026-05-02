/**
 * @file jump-commands.test.ts
 * @description Test suite for Vim-style jump commands (US-1.6.1)
 *
 * Tests for:
 * - gg: move to first line
 * - G: move to last line
 * - {count}G: move to specific line
 * - Ctrl+f: page down (scroll full page)
 * - Ctrl+b: page up (scroll full page)
 * - Ctrl+d: half page down
 * - Ctrl+u: half page up
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Jump Commands (US-1.6.1)", () => {
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let editor: Editor;
  let interpreter: any;

  // Setup before each test
  const setup = (content: string = "hello world") => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    editor.createBuffer("test", content);
    interpreter = editor.getInterpreter();
  };

  // Helper to create a multi-line buffer
  const createMultiLineBuffer = (lineCount: number): string => {
    const lines: string[] = [];
    for (let i = 1; i <= lineCount; i++) {
      lines.push(`Line ${i}`);
    }
    return lines.join("\n");
  };

  describe("gg - jump to first line", () => {
    test("should move cursor to first line", () => {
      setup(createMultiLineBuffer(10));

      // Start at line 5
      interpreter.execute("(cursor-move 5 0)");

      // Execute gg command
      const result = interpreter.execute("(jump-to-first-line)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should be at line 0
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should move to first non-blank column", () => {
      setup("  Line 1\nLine 2\nLine 3");

      // Start at line 2
      interpreter.execute("(cursor-move 2 5)");

      // Execute gg
      interpreter.execute("(jump-to-first-line)");

      // Cursor should be at first non-blank of line 0
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(2);
    });

    test("should stay at first line when already there", () => {
      setup(createMultiLineBuffer(10));

      // Start at line 0
      interpreter.execute("(cursor-move 0 0)");

      // Execute gg
      interpreter.execute("(jump-to-first-line)");

      // Should stay at line 0
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
    });

    test("should handle single line buffer", () => {
      setup("Only one line");

      // Start at column 5
      interpreter.execute("(cursor-move 0 5)");

      // Execute gg
      interpreter.execute("(jump-to-first-line)");

      // Should stay at line 0, move to first non-blank
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(0);
    });
  });

  describe("G - jump to last line", () => {
    test("should move cursor to last line", () => {
      setup(createMultiLineBuffer(10));

      // Start at line 2
      interpreter.execute("(cursor-move 2 0)");

      // Execute G command
      const result = interpreter.execute("(jump-to-last-line)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should be at line 9 (last line, 0-indexed)
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(9);
    });

    test("should move to first non-blank column of last line", () => {
      setup("Line 1\nLine 2\n  Last Line");

      // Start at line 0
      interpreter.execute("(cursor-move 0 0)");

      // Execute G
      interpreter.execute("(jump-to-last-line)");

      // Cursor should be at line 2, column 2 (first non-blank)
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(2);
      expect(state.cursorPosition.column).toBe(2);
    });

    test("should stay at last line when already there", () => {
      setup(createMultiLineBuffer(10));

      // Start at last line
      interpreter.execute("(cursor-move 9 0)");

      // Execute G
      interpreter.execute("(jump-to-last-line)");

      // Should stay at line 9
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(9);
    });

    test("should handle single line buffer", () => {
      setup("Only one line");

      // Start at column 5
      interpreter.execute("(cursor-move 0 5)");

      // Execute G
      interpreter.execute("(jump-to-last-line)");

      // Should stay at line 0, move to first non-blank
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(0);
    });
  });

  describe("{count}G - jump to specific line", () => {
    test("50G should move to line 50", () => {
      setup(createMultiLineBuffer(100));

      // Start at line 0
      interpreter.execute("(cursor-move 0 0)");

      // Execute 50G (line 50 is index 49 in 0-based)
      const result = interpreter.execute("(jump-to-line 50)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should be at line 49 (0-indexed)
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(49);
    });

    test("1G should move to first line", () => {
      setup(createMultiLineBuffer(10));

      // Start at line 5
      interpreter.execute("(cursor-move 5 0)");

      // Execute 1G
      interpreter.execute("(jump-to-line 1)");

      // Should be at line 0
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
    });

    test("should clamp to last line if count exceeds buffer", () => {
      setup(createMultiLineBuffer(10));

      // Start at line 0
      interpreter.execute("(cursor-move 0 0)");

      // Execute 100G (buffer only has 10 lines)
      interpreter.execute("(jump-to-line 100)");

      // Should clamp to line 9 (last line)
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(9);
    });

    test("should handle line 0 gracefully", () => {
      setup(createMultiLineBuffer(10));

      // Execute 0G - should go to first line (same as 1G)
      interpreter.execute("(jump-to-line 0)");

      // Should go to line 0
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
    });

    test("should move to first non-blank column of target line", () => {
      setup("Line 1\nLine 2\n  Line 3\nLine 4");

      // Start at line 0
      interpreter.execute("(cursor-move 0 0)");

      // Execute 3G (line 3 has leading spaces)
      interpreter.execute("(jump-to-line 3)");

      // Should be at line 2, column 2
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(2);
      expect(state.cursorPosition.column).toBe(2);
    });
  });

  describe("Ctrl+f - page down (full page)", () => {
    test("should scroll down one full page", () => {
      setup(createMultiLineBuffer(50));

      // Start at line 0
      interpreter.execute("(cursor-move 0 0)");

      // Execute Ctrl+f (page down)
      const result = interpreter.execute("(page-down)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should move down by page size
      const state = editor.getState();
      expect(state.cursorPosition.line).toBeGreaterThan(0);
      // Should move approximately one page (default terminal height is around 24 lines)
      expect(state.cursorPosition.line).toBeLessThan(50);
    });

    test("should not scroll beyond last line", () => {
      setup(createMultiLineBuffer(10));

      // Start near end
      interpreter.execute("(cursor-move 8 0)");

      // Execute Ctrl+f
      interpreter.execute("(page-down)");

      // Should clamp to last line
      const state = editor.getState();
      expect(state.cursorPosition.line).toBeLessThan(10);
    });

    test("should handle small buffer", () => {
      setup(createMultiLineBuffer(5));

      // Start at line 0
      interpreter.execute("(cursor-move 0 0)");

      // Execute Ctrl+f
      interpreter.execute("(page-down)");

      // Should not go beyond buffer
      const state = editor.getState();
      expect(state.cursorPosition.line).toBeLessThan(5);
    });
  });

  describe("Ctrl+b - page up (full page)", () => {
    test("should scroll up one full page", () => {
      setup(createMultiLineBuffer(50));

      // Start at line 40
      interpreter.execute("(cursor-move 40 0)");

      // Execute Ctrl+b (page up)
      const result = interpreter.execute("(page-up)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should move up by page size
      const state = editor.getState();
      expect(state.cursorPosition.line).toBeLessThan(40);
      expect(state.cursorPosition.line).toBeGreaterThanOrEqual(0);
    });

    test("should not scroll before first line", () => {
      setup(createMultiLineBuffer(10));

      // Start near beginning
      interpreter.execute("(cursor-move 2 0)");

      // Execute Ctrl+b
      interpreter.execute("(page-up)");

      // Should clamp to line 0
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
    });

    test("should handle small buffer", () => {
      setup(createMultiLineBuffer(5));

      // Start at line 4
      interpreter.execute("(cursor-move 4 0)");

      // Execute Ctrl+b
      interpreter.execute("(page-up)");

      // Should not go before line 0
      const state = editor.getState();
      expect(state.cursorPosition.line).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Ctrl+d - half page down", () => {
    test("should scroll down half a page", () => {
      setup(createMultiLineBuffer(50));

      // Start at line 0
      interpreter.execute("(cursor-move 0 0)");

      // Execute Ctrl+d (half page down)
      const result = interpreter.execute("(half-page-down)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should move down by half page size
      const state = editor.getState();
      expect(state.cursorPosition.line).toBeGreaterThan(0);
      // Half page should be less than full page
      expect(state.cursorPosition.line).toBeLessThan(50);
    });

    test("should not scroll beyond last line", () => {
      setup(createMultiLineBuffer(10));

      // Start near end
      interpreter.execute("(cursor-move 8 0)");

      // Execute Ctrl+d
      interpreter.execute("(half-page-down)");

      // Should clamp to last line
      const state = editor.getState();
      expect(state.cursorPosition.line).toBeLessThan(10);
    });

    test("should move less than full page down", () => {
      setup(createMultiLineBuffer(50));

      // Start at line 0
      interpreter.execute("(cursor-move 0 0)");

      // Execute Ctrl+d
      interpreter.execute("(half-page-down)");

      const state1 = editor.getState();
      const halfPageDistance = state1.cursorPosition.line;

      // Execute Ctrl+f for comparison
      interpreter.execute("(page-down)");
      const state2 = editor.getState();
      const fullPageDistance = state2.cursorPosition.line - halfPageDistance;

      // Half page should be approximately half of full page
      expect(halfPageDistance).toBeLessThan(fullPageDistance + halfPageDistance);
    });
  });

  describe("Ctrl+u - half page up", () => {
    test("should scroll up half a page", () => {
      setup(createMultiLineBuffer(50));

      // Start at line 40
      interpreter.execute("(cursor-move 40 0)");

      // Execute Ctrl+u (half page up)
      const result = interpreter.execute("(half-page-up)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should move up by half page size
      const state = editor.getState();
      expect(state.cursorPosition.line).toBeLessThan(40);
      expect(state.cursorPosition.line).toBeGreaterThanOrEqual(0);
    });

    test("should not scroll before first line", () => {
      setup(createMultiLineBuffer(10));

      // Start near beginning
      interpreter.execute("(cursor-move 2 0)");

      // Execute Ctrl+u
      interpreter.execute("(half-page-up)");

      // Should clamp to line 0
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
    });

    test("should move less than full page up", () => {
      setup(createMultiLineBuffer(50));

      // Start at line 40
      interpreter.execute("(cursor-move 40 0)");

      // Execute Ctrl+u
      interpreter.execute("(half-page-up)");

      const state1 = editor.getState();
      const halfPageDistance = 40 - state1.cursorPosition.line;

      // Reset and execute Ctrl+b for comparison
      interpreter.execute("(cursor-move 40 0)");
      interpreter.execute("(page-up)");
      const state2 = editor.getState();
      const fullPageDistance = 40 - state2.cursorPosition.line - halfPageDistance;

      // Half page should be approximately half of full page
      expect(halfPageDistance).toBeLessThan(fullPageDistance + halfPageDistance);
    });
  });

  describe("Edge cases", () => {
    test("should handle empty buffer", () => {
      setup("");

      interpreter.execute("(cursor-move 0 0)");

      // Should not crash
      const result1 = interpreter.execute("(jump-to-first-line)");
      expect(Either.isRight(result1)).toBe(true);

      const result2 = interpreter.execute("(jump-to-last-line)");
      expect(Either.isRight(result2)).toBe(true);
    });

    test("should handle buffer with only empty lines", () => {
      setup("\n\n\n\n");

      // Start at line 2
      interpreter.execute("(cursor-move 2 0)");

      // Execute gg
      interpreter.execute("(jump-to-first-line)");
      let state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);

      // Execute G
      interpreter.execute("(jump-to-last-line)");
      state = editor.getState();
      expect(state.cursorPosition.line).toBe(4);
    });

    test("gg should work from any column", () => {
      setup("Line 1\nLine 2\nLine 3");

      // Start at line 1, column 3
      interpreter.execute("(cursor-move 1 3)");

      // Execute gg
      interpreter.execute("(jump-to-first-line)");

      // Should move to line 0, first non-blank column
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(0);
    });

    test("G should work from any column", () => {
      setup("Line 1\nLine 2\nLine 3");

      // Start at line 0, column 3
      interpreter.execute("(cursor-move 0 3)");

      // Execute G
      interpreter.execute("(jump-to-last-line)");

      // Should move to line 2, first non-blank column
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(2);
      expect(state.cursorPosition.column).toBe(0);
    });

    test("page navigation should handle varying line lengths", () => {
      setup("Line 1\nVery long line 2 with lots of text\nLine 3\nShort\nLine 5");

      // Start at line 0
      interpreter.execute("(cursor-move 0 0)");

      // Page down should work
      const result1 = interpreter.execute("(page-down)");
      expect(Either.isRight(result1)).toBe(true);

      // Page up should work
      const result2 = interpreter.execute("(page-up)");
      expect(Either.isRight(result2)).toBe(true);

      // Should return near starting position
      const state = editor.getState();
      expect(state.cursorPosition.line).toBeLessThan(5);
    });
  });

  describe("Integration with other commands", () => {
    test("gg followed by word navigation should work", () => {
      setup("Line 1\nLine 2\nLine 3");

      // Start at line 2
      interpreter.execute("(cursor-move 2 0)");

      // Execute gg
      interpreter.execute("(jump-to-first-line)");

      // Execute word-next (w)
      interpreter.execute("(word-next)");

      // Should be at line 0, after "Line"
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBeGreaterThan(0);
    });

    test("G followed by line navigation should work", () => {
      setup("Line 1\nLine 2\nLine 3");

      // Start at line 0
      interpreter.execute("(cursor-move 0 0)");

      // Execute G
      interpreter.execute("(jump-to-last-line)");

      // Execute line-first-column (0)
      interpreter.execute("(line-first-column)");

      // Should be at line 2, column 0
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(2);
      expect(state.cursorPosition.column).toBe(0);
    });
  });
});
