/**
 * @file word-under-cursor-search.test.ts
 * @description Tests for word under cursor search functionality (US-1.5.2)
 *
 * Tests Vim-style * (next occurrence) and # (previous occurrence) commands
 * that search for the word currently under the cursor.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Word Under Cursor Search (US-1.5.2)", () => {
  let editor: Editor;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;

  beforeEach(() => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    editor.start();

    // Create test buffer with multiple occurrences of words
    editor.createBuffer("test.txt", "hello world foo bar hello\ntest hello test world\nfoo bar baz");

    // Set up editor in normal mode
    (editor as any).state.mode = "normal";
  });

  describe("* (word-under-cursor-next) - next occurrence", () => {
    test("moves cursor to next occurrence of word under cursor", async () => {
      // Position cursor on first "hello" at line 0, column 0
      editor.state.cursorPosition = { line: 0, column: 0 };

      // Execute * to search for next "hello"
      const result = await editor.interpreter.execute('(word-under-cursor-next)');

      // Should execute successfully
      expect(result._tag).toBe("Right");

      // Cursor should have moved to line 0 (second "hello" at column 20)
      expect(editor.state.cursorPosition.line).toBe(0);
      expect(editor.state.cursorPosition.column).toBe(20); // "hello" starts at column 20
    });

    test("continues from current position to find next match", async () => {
      // Position cursor on "hello" at line 0, column 20 (second occurrence)
      editor.state.cursorPosition = { line: 0, column: 20 };

      // Execute * to search for next "hello"
      await editor.interpreter.execute('(word-under-cursor-next)');

      // Should find the "hello" at line 1, column 5
      expect(editor.state.cursorPosition.line).toBe(1);
      expect(editor.state.cursorPosition.column).toBe(5);
    });

    test("n continues in same direction after *", async () => {
      // Start at first "hello"
      editor.state.cursorPosition = { line: 0, column: 0 };

      // Press * to find next "hello"
      await editor.interpreter.execute('(word-under-cursor-next)');

      // Should be at column 20
      expect(editor.state.cursorPosition.column).toBe(20);

      // Press n to continue in same direction
      await editor.interpreter.execute('(search-next)');

      // Should find "hello" at line 1, column 5
      expect(editor.state.cursorPosition.line).toBe(1);
      expect(editor.state.cursorPosition.column).toBe(5);
    });

    test("N reverses direction after *", async () => {
      // Start at first "hello"
      editor.state.cursorPosition = { line: 0, column: 0 };

      // Press * to find next "hello" (sets forward direction)
      await editor.interpreter.execute('(word-under-cursor-next)');

      // Should be at column 20
      expect(editor.state.cursorPosition.column).toBe(20);

      // Press N to reverse direction
      await editor.interpreter.execute('(search-previous)');

      // Should go back to first "hello"
      expect(editor.state.cursorPosition.line).toBe(0);
      expect(editor.state.cursorPosition.column).toBe(0);
    });

    test("only matches whole words (special chars handled)", async () => {
      // Create buffer with "hello!" and "hello"
      editor.createBuffer("test2.txt", "hello! world hello\nhello world");

      // Position cursor on "hello" at column 0
      editor.state.cursorPosition = { line: 0, column: 0 };

      // Execute * to search for next "hello"
      await editor.interpreter.execute('(word-under-cursor-next)');

      // Should find "hello" at line 0, column 13 (not "hello!" which is not a whole word match)
      expect(editor.state.cursorPosition.line).toBe(0);
      expect(editor.state.cursorPosition.column).toBe(13);
    });

    test("shows error when word not found", async () => {
      // Create buffer with unique word
      editor.createBuffer("test3.txt", "unique_word");

      editor.state.cursorPosition = { line: 0, column: 0 };

      // Execute * - should return error or stay at same position
      const result = await editor.interpreter.execute('(word-under-cursor-next)');

      // Should either error or stay at same position
      if (result._tag === "Left") {
        expect(result.left).toBeDefined();
      } else {
        expect(editor.state.cursorPosition.line).toBe(0);
        expect(editor.state.cursorPosition.column).toBe(0);
      }
    });

    test("handles word in middle of line", async () => {
      // Position cursor on "world" at line 0
      editor.state.cursorPosition = { line: 0, column: 6 };

      // Execute * to search for next "world"
      await editor.interpreter.execute('(word-under-cursor-next)');

      // Should find "world" at line 1
      expect(editor.state.cursorPosition.line).toBe(1);
      expect(editor.state.cursorPosition.column).toBe(16); // "world" at column 16
    });
  });

  describe("# (word-under-cursor-previous) - previous occurrence", () => {
    test("moves cursor to previous occurrence of word under cursor", async () => {
      // Position cursor on "hello" at line 1
      editor.state.cursorPosition = { line: 1, column: 5 };

      // Execute # to search for previous "hello"
      const result = await editor.interpreter.execute('(word-under-cursor-previous)');

      // Should execute successfully
      expect(result._tag).toBe("Right");

      // Should move to the "hello" at line 0, column 20 (second occurrence on line 0)
      expect(editor.state.cursorPosition.line).toBe(0);
      expect(editor.state.cursorPosition.column).toBe(20);
    });

    test("wraps to end when no previous occurrence", async () => {
      // Position cursor on first "hello" at line 0
      editor.state.cursorPosition = { line: 0, column: 0 };

      // Execute # to search for previous "hello"
      await editor.interpreter.execute('(word-under-cursor-previous)');

      // Should wrap to last "hello" at line 1
      expect(editor.state.cursorPosition.line).toBe(1);
      expect(editor.state.cursorPosition.column).toBe(5);
    });

    test("n continues in same direction after #", async () => {
      // Start at "hello" at line 1
      editor.state.cursorPosition = { line: 1, column: 5 };

      // Press # to find previous "hello"
      await editor.interpreter.execute('(word-under-cursor-previous)');

      // Should be at line 0, column 20
      expect(editor.state.cursorPosition.line).toBe(0);
      expect(editor.state.cursorPosition.column).toBe(20);

      // Press n to continue in same direction (backward)
      await editor.interpreter.execute('(search-next)');

      // Should find the "hello" at column 0
      expect(editor.state.cursorPosition.line).toBe(0);
      expect(editor.state.cursorPosition.column).toBe(0);
    });

    test("N reverses direction after #", async () => {
      // Start at second "hello"
      editor.state.cursorPosition = { line: 1, column: 5 };

      // Press # to find previous "hello" (sets backward direction)
      await editor.interpreter.execute('(word-under-cursor-previous)');

      // Should be at line 0
      expect(editor.state.cursorPosition.line).toBe(0);

      // Press N to reverse direction
      await editor.interpreter.execute('(search-previous)');

      // Should go forward to second "hello"
      expect(editor.state.cursorPosition.line).toBe(1);
      expect(editor.state.cursorPosition.column).toBe(5);
    });

    test("handles underscores in words", async () => {
      // Create buffer with underscore words
      editor.createBuffer("test4.txt", "test_var hello test_var\nworld test_var");

      // Position cursor on "test_var" at line 1
      editor.state.cursorPosition = { line: 1, column: 6 };

      // Execute # to search for previous "test_var"
      await editor.interpreter.execute('(word-under-cursor-previous)');

      // Should find "test_var" at line 0, column 15 (second occurrence on line 0)
      expect(editor.state.cursorPosition.line).toBe(0);
      expect(editor.state.cursorPosition.column).toBe(15);
    });
  });

  describe("Edge cases", () => {
    test("works with numbers in words", async () => {
      // Create buffer with alphanumeric words
      editor.createBuffer("test5.txt", "test123 hello test123\nworld test123");

      // Position cursor on "test123"
      editor.state.cursorPosition = { line: 0, column: 0 };

      // Execute * to search for next "test123"
      await editor.interpreter.execute('(word-under-cursor-next)');

      // Should find "test123" at line 0, column 14
      expect(editor.state.cursorPosition.line).toBe(0);
      expect(editor.state.cursorPosition.column).toBe(14);
    });

    test("handles cursor at different positions within word", async () => {
      // Create buffer with word occurrences
      editor.createBuffer("test6.txt", "hello hello hello");

      // Position cursor in middle of first "hello" (column 2)
      editor.state.cursorPosition = { line: 0, column: 2 };

      // Execute * to search for next "hello"
      await editor.interpreter.execute('(word-under-cursor-next)');

      // Should find second "hello" at column 6
      expect(editor.state.cursorPosition.line).toBe(0);
      expect(editor.state.cursorPosition.column).toBe(6);
    });

    test("handles single occurrence gracefully", async () => {
      // Create buffer with single word occurrence
      editor.createBuffer("test7.txt", "unique");

      editor.state.cursorPosition = { line: 0, column: 0 };

      // Execute * - should stay at current position
      await editor.interpreter.execute('(word-under-cursor-next)');

      // Should stay at same position (only occurrence)
      expect(editor.state.cursorPosition.line).toBe(0);
      expect(editor.state.cursorPosition.column).toBe(0);
    });

    test("handles empty buffer", async () => {
      // Create empty buffer
      editor.createBuffer("test8.txt", "");

      // Execute * - should throw error since there's no word under cursor
      await expect(async () => {
        await editor.interpreter.execute('(word-under-cursor-next)');
      }).toThrow();
    });

    test("search pattern is set correctly", async () => {
      // Position cursor on "hello"
      editor.state.cursorPosition = { line: 0, column: 0 };

      // Execute * to search
      await editor.interpreter.execute('(word-under-cursor-next)');

      // Check that search pattern was set
      const pattern = await editor.interpreter.execute('(search-pattern-get)');

      // The pattern should be set (non-empty)
      expect(pattern._tag).toBe("Right");
      if (pattern._tag === "Right" && pattern.right.type === "string") {
        expect(pattern.right.value.length).toBeGreaterThan(0);
      }
    });
  });
});
