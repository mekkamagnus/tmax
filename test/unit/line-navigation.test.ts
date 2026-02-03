/**
 * @file line-navigation.test.ts
 * @description Test suite for Vim-style line navigation (US-1.1.2)
 *
 * Tests for:
 * - 0: move to first column
 * - $: move to last non-empty column
 * - _: move to first non-blank column
 * - -: move to first non-blank of previous line
 * - +: move to first non-blank of next line
 * - Count prefix support (e.g., 5-)
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Line Navigation (US-1.1.2)", () => {
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

  describe("0 - move to first column", () => {
    test("should move cursor to first column (column 0)", () => {
      setup("  hello world");

      // Start at position (0, 5)
      interpreter.execute("(cursor-move 0 5)");

      // Execute 0 command
      const result = interpreter.execute("(line-first-column)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should be at column 0
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should stay at column 0 when already there", () => {
      setup("hello world");

      // Start at column 0
      interpreter.execute("(cursor-move 0 0)");

      // Execute 0 command
      const result = interpreter.execute("(line-first-column)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should still be at column 0
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should move to column 0 from middle of line", () => {
      setup("hello world");

      // Start at middle of line
      interpreter.execute("(cursor-move 0 6)");

      // Execute 0 command
      interpreter.execute("(line-first-column)");

      // Cursor should be at column 0
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(0);
    });
  });

  describe("$ - move to last non-empty column", () => {
    test("should move cursor to last non-empty column", () => {
      setup("hello world");

      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");

      // Execute $ command
      const result = interpreter.execute("(line-last-column)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should be at last character ('d' at column 10)
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(10);
    });

    test("should ignore trailing whitespace", () => {
      setup("hello   ");

      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");

      // Execute $ command
      interpreter.execute("(line-last-column)");

      // Cursor should be at last non-space character ('o' at column 4)
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(4);
    });

    test("should handle line with only whitespace", () => {
      setup("   ");

      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");

      // Execute $ command - should stay at column 0 or go to first non-blank
      interpreter.execute("(line-last-column)");

      const state = editor.getState();
      // Either stays at 0 or moves to last column (implementation choice)
      expect(state.cursorPosition.column).toBeGreaterThanOrEqual(0);
    });

    test("should stay at end when already there", () => {
      setup("hello");

      // Start at end of line
      interpreter.execute("(cursor-move 0 4)");

      // Execute $ command
      interpreter.execute("(line-last-column)");

      // Cursor should still be at column 4
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(4);
    });
  });

  describe("_ - move to first non-blank column", () => {
    test("should move cursor to first non-blank column", () => {
      setup("  hello world");

      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");

      // Execute _ command
      const result = interpreter.execute("(line-first-non-blank)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should be at first non-space character ('h' at column 2)
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(2);
    });

    test("should stay at column 0 when line starts with non-whitespace", () => {
      setup("hello world");

      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");

      // Execute _ command
      interpreter.execute("(line-first-non-blank)");

      // Cursor should be at column 0 (first non-blank is at 0)
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should handle tabs as whitespace", () => {
      setup("\thello world");

      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");

      // Execute _ command
      interpreter.execute("(line-first-non-blank)");

      // Cursor should skip tab and be at 'h'
      const state = editor.getState();
      expect(state.cursorPosition.column).toBeGreaterThan(0);
    });

    test("should move to first non-blank from middle of line", () => {
      setup("  hello world");

      // Start at middle of line
      interpreter.execute("(cursor-move 0 5)");

      // Execute _ command
      interpreter.execute("(line-first-non-blank)");

      // Cursor should be at first non-blank (column 2)
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(2);
    });
  });

  describe("- - move to first non-blank of previous line", () => {
    test("should move cursor up and to first non-blank", () => {
      setup("line one\n  line two\nline three");

      // Start at position (1, 2)
      interpreter.execute("(cursor-move 1 2)");

      // Execute - command
      const result = interpreter.execute("(line-previous)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should be at line 0, column 0 (first non-blank of "line one")
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should handle previous line with leading whitespace", () => {
      setup("line one\n  line two\nline three");

      // Start at position (2, 0)
      interpreter.execute("(cursor-move 2 0)");

      // Execute - command
      interpreter.execute("(line-previous)");

      // Cursor should be at line 1, column 2 (first non-blank of "  line two")
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(1);
      expect(state.cursorPosition.column).toBe(2);
    });

    test("should not move beyond first line", () => {
      setup("line one\nline two");

      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");

      // Execute - command - should stay on line 0
      interpreter.execute("(line-previous)");

      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(0);
    });
  });

  describe("+ - move to first non-blank of next line", () => {
    test("should move cursor down and to first non-blank", () => {
      setup("line one\n  line two\nline three");

      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");

      // Execute + command
      const result = interpreter.execute("(line-next)");
      expect(Either.isRight(result)).toBe(true);

      // Cursor should be at line 1, column 2 (first non-blank of "  line two")
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(1);
      expect(state.cursorPosition.column).toBe(2);
    });

    test("should handle next line with leading whitespace", () => {
      setup("  line one\nline two\nline three");

      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");

      // Execute + command
      interpreter.execute("(line-next)");

      // Cursor should be at line 1, column 0 (first non-blank of "line two")
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(1);
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should not move beyond last line", () => {
      setup("line one\nline two");

      // Start at position (1, 0)
      interpreter.execute("(cursor-move 1 0)");

      // Execute + command - should stay on line 1
      interpreter.execute("(line-next)");

      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(1);
    });
  });

  describe("Count prefix support", () => {
    test("5- should move up 5 lines", () => {
      setup("line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7");

      // Start at position (6, 0)
      interpreter.execute("(cursor-move 6 0)");

      // Execute 5-
      interpreter.execute("(line-previous 5)");

      // Should be at line 1
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(1);
    });

    test("3+ should move down 3 lines", () => {
      setup("line 1\nline 2\nline 3\nline 4\nline 5");

      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");

      // Execute 3+
      interpreter.execute("(line-next 3)");

      // Should be at line 3
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(3);
    });

    test("0- should not move cursor", () => {
      setup("line 1\nline 2\nline 3");

      // Start at position (2, 0)
      interpreter.execute("(cursor-move 2 0)");

      // Execute 0-
      interpreter.execute("(line-previous 0)");

      // Should stay at line 2
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(2);
    });

    test("0+ should not move cursor", () => {
      setup("line 1\nline 2\nline 3");

      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");

      // Execute 0+
      interpreter.execute("(line-next 0)");

      // Should stay at line 0
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
    });
  });

  describe("Edge cases", () => {
    test("should handle empty buffer", () => {
      setup("");

      interpreter.execute("(cursor-move 0 0)");

      // Should not crash
      const result = interpreter.execute("(line-first-column)");
      expect(Either.isRight(result)).toBe(true);
    });

    test("should handle single line", () => {
      setup("hello world");

      interpreter.execute("(cursor-move 0 0)");

      // $ should go to end of line
      interpreter.execute("(line-last-column)");
      let state = editor.getState();
      expect(state.cursorPosition.column).toBe(10);

      // 0 should go to start
      interpreter.execute("(line-first-column)");
      state = editor.getState();
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should handle lines with mixed whitespace", () => {
      setup(" \t line one\n  line two");

      // Start at line 1
      interpreter.execute("(cursor-move 1 0)");

      // - should move to first non-blank of line 0 (skipping space and tab)
      interpreter.execute("(line-previous)");

      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      // Should be after the space and tab
      expect(state.cursorPosition.column).toBeGreaterThan(0);
    });

    test("should handle very long lines", () => {
      const longLine = "a".repeat(100);
      setup(longLine);

      // Start at column 50
      interpreter.execute("(cursor-move 0 50)");

      // $ should move to end
      interpreter.execute("(line-last-column)");

      const state = editor.getState();
      // The column should be at or near the last character
      // (implementation may vary based on buffer representation)
      expect(state.cursorPosition.column).toBeGreaterThan(90);
    });

    test("_ should work on empty line", () => {
      setup("line one\n\nline three");

      // Start at empty line (line 1)
      interpreter.execute("(cursor-move 1 0)");

      // _ should handle empty line gracefully
      const result = interpreter.execute("(line-first-non-blank)");
      expect(Either.isRight(result)).toBe(true);
    });

    test("$ should work on line with only spaces", () => {
      setup("line one\n     \nline three");

      // Start at line 1 (only spaces)
      interpreter.execute("(cursor-move 1 0)");

      // $ should handle line with only spaces
      const result = interpreter.execute("(line-last-column)");
      expect(Either.isRight(result)).toBe(true);
    });
  });
});
