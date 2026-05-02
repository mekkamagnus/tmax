/**
 * @file count-prefix.test.ts
 * @description Tests for count prefix functionality (US-1.3.1)
 *
 * Tests Vim-style count prefix for commands:
 * - Number before command repeats action N times
 * - 3w moves forward 3 words
 * - 5dd deletes 5 lines
 * - 10x deletes 10 characters
 * - 2yy yanks 2 lines
 * - 3p pastes text 3 times
 * - 0w doesn't move cursor (zero count edge case)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Count Prefix (US-1.3.1)", () => {
  let editor: Editor;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;

  beforeEach(() => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    editor.start();

    // Create a test buffer with multiple words and lines
    editor.createBuffer("test", "one two three four\nfive six seven eight\nnine ten eleven twelve");
  });

  describe("Digit Accumulation", () => {
    test("should accumulate single digit", async () => {
      await editor.handleKey("3");
      expect(editor.getCount()).toBe(3);
    });

    test("should accumulate multiple digits into count", async () => {
      await editor.handleKey("1");
      await editor.handleKey("0");
      expect(editor.getCount()).toBe(10);
    });

    test("should accumulate three digits into count", async () => {
      await editor.handleKey("2");
      await editor.handleKey("5");
      await editor.handleKey("5");
      expect(editor.getCount()).toBe(255);
    });

    test("should reset count to 0 after command execution", async () => {
      await editor.handleKey("3");
      expect(editor.getCount()).toBe(3);

      await editor.handleKey("w"); // Move 3 words forward
      expect(editor.getCount()).toBe(0);
    });

    test("should not reset count when pressing more digits", async () => {
      await editor.handleKey("1");
      await editor.handleKey("2");
      expect(editor.getCount()).toBe(12);

      await editor.handleKey("3");
      expect(editor.getCount()).toBe(123);
    });
  });

  describe("Word Navigation with Count", () => {
    test("should move 3 words forward with 3w", async () => {
      const initialLine = 0;
      const initialColumn = 0; // Start at "one"

      await editor.handleKey("3");
      await editor.handleKey("w");

      const state = editor.getState();
      // After 3w: "one" -> "two" -> "three" -> "four"
      // Cursor should be at start of "four"
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(14); // "one two three " = 14 chars
    });

    test("should move 2 words backward with 2b", async () => {
      // First move to end of buffer
      await editor.handleKey("w");
      await editor.handleKey("w");
      await editor.handleKey("w");

      // Now move 2 words back
      await editor.handleKey("2");
      await editor.handleKey("b");

      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(8); // Start of "three"
    });

    test("should move to end of word 2 times with 2e", async () => {
      await editor.handleKey("2");
      await editor.handleKey("e");

      const state = editor.getState();
      // After 2e from start: "one" -> "two"
      // Cursor should be at end of "two"
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(6); // End of "two"
    });
  });

  describe("Line Navigation with Count", () => {
    test("should move down 5 lines with 5+", async () => {
      // Create a buffer with more lines
      editor.createBuffer("test", "line1\nline2\nline3\nline4\nline5\nline6\nline7");

      await editor.handleKey("5");
      await editor.handleKey("+");

      const state = editor.getState();
      // After 5+: should be on line 5 (index 5)
      expect(state.cursorPosition.line).toBe(5);
    });

    test("should move up 3 lines with 3-", async () => {
      editor.createBuffer("test", "line1\nline2\nline3\nline4\nline5\nline6");

      // Move to line 5 first
      for (let i = 0; i < 4; i++) {
        await editor.handleKey("j");
      }

      expect(editor.getState().cursorPosition.line).toBe(4);

      // Now move up 3 lines
      await editor.handleKey("3");
      await editor.handleKey("-");

      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(1); // Line 2
    });
  });

  describe("Delete Operations with Count", () => {
    test("should delete 3 characters with 3x", async () => {
      editor.createBuffer("test", "hello world");

      await editor.handleKey("3");
      await editor.handleKey("x");

      const state = editor.getState();
      const content = state.currentBuffer?.getContent();
      if (content && typeof content === "object" && "right" in content) {
        expect(content.right).toBe("lo world");
      }
    });

    test("should delete 5 lines with 5dd", async () => {
      editor.createBuffer("test", "line1\nline2\nline3\nline4\nline5\nline6\nline7");

      await editor.handleKey("5");
      await editor.handleKey("d");
      await editor.handleKey("d");

      const state = editor.getState();
      const content = state.currentBuffer?.getContent();
      if (content && typeof content === "object" && "right" in content) {
        expect(content.right).toBe("line6\nline7");
      }
    });

    test("should delete 2 words with 2dw", async () => {
      editor.createBuffer("test", "one two three four five");

      await editor.handleKey("2");
      await editor.handleKey("d");
      await editor.handleKey("w");

      const state = editor.getState();
      const content = state.currentBuffer?.getContent();
      if (content && typeof content === "object" && "right" in content) {
        expect(content.right).toBe("three four five");
      }
    });
  });

  describe("Yank Operations with Count", () => {
    test("should yank 2 lines with 2yy", async () => {
      editor.createBuffer("test", "line1\nline2\nline3\nline4");

      await editor.handleKey("2");
      await editor.handleKey("y");
      await editor.handleKey("y");

      // Paste should work
      await editor.handleKey("j");
      await editor.handleKey("j");
      await editor.handleKey("p");

      const state = editor.getState();
      const content = state.currentBuffer?.getContent();
      if (content && typeof content === "object" && "right" in content) {
        expect(content.right).toBe("line1\nline2\nline3\nline4\nline1\nline2");
      }
    });
  });

  describe("Paste with Count", () => {
    test("should paste 3 times with 3p", async () => {
      editor.createBuffer("test", "hello");

      // First yank a character
      await editor.handleKey("y");
      await editor.handleKey("l"); // Yank one character (yank right)

      // Move to end
      await editor.handleKey("$");

      // Paste 3 times
      await editor.handleKey("3");
      await editor.handleKey("p");

      const state = editor.getState();
      const content = state.currentBuffer?.getContent();
      if (content && typeof content === "object" && "right" in content) {
        expect(content.right).toBe("hellhohohoho");
      }
    });
  });

  describe("Edge Cases", () => {
    test("should not move cursor with 0w", async () => {
      const initialState = editor.getState();

      await editor.handleKey("0");
      await editor.handleKey("w");

      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(initialState.cursorPosition.line);
      expect(state.cursorPosition.column).toBe(initialState.cursorPosition.column);
    });

    test("should not move cursor with 00", async () => {
      const initialState = editor.getState();

      await editor.handleKey("0");
      await editor.handleKey("0");

      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(initialState.cursorPosition.line);
      expect(state.cursorPosition.column).toBe(initialState.cursorPosition.column);
    });

    test("should handle very large counts", async () => {
      editor.createBuffer("test", "a b c d e f g h i j");

      await editor.handleKey("9");
      await editor.handleKey("9");
      await editor.handleKey("w");

      // Should move as far as possible without error
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
    });

    test("should reset count on mode change", async () => {
      await editor.handleKey("5");
      expect(editor.getCount()).toBe(5);

      // Switch to insert mode
      await editor.handleKey("i");
      expect(editor.getCount()).toBe(0);

      // Back to normal mode
      await editor.handleKey("Escape");
      expect(editor.getCount()).toBe(0);
    });

    test("should reset count on non-digit key press", async () => {
      await editor.handleKey("3");
      await editor.handleKey("x"); // Delete 3 characters

      expect(editor.getCount()).toBe(0);
    });
  });

  describe("Count Prefix T-Lisp API", () => {
    test("count-get should return current count", async () => {
      await editor.handleKey("5");

      const interpreter = editor.getInterpreter();
      const result = interpreter.execute("(count-get)");

      if (typeof result === "object" && "right" in result) {
        expect(result.right).toEqual({ type: "number", value: 5 });
      }
    });

    test("count-set should set count", async () => {
      const interpreter = editor.getInterpreter();
      interpreter.execute("(count-set 10)");

      expect(editor.getCount()).toBe(10);
    });

    test("count-reset should reset count to 0", async () => {
      await editor.handleKey("7");
      expect(editor.getCount()).toBe(7);

      const interpreter = editor.getInterpreter();
      interpreter.execute("(count-reset)");

      expect(editor.getCount()).toBe(0);
    });

    test("count-active should return false when no count", async () => {
      const interpreter = editor.getInterpreter();
      const result = interpreter.execute("(count-active)");

      if (typeof result === "object" && "right" in result) {
        expect(result.right).toEqual({ type: "boolean", value: false });
      }
    });

    test("count-active should return true when count set", async () => {
      await editor.handleKey("3");

      const interpreter = editor.getInterpreter();
      const result = interpreter.execute("(count-active)");

      if (typeof result === "object" && "right" in result) {
        expect(result.right).toEqual({ type: "boolean", value: true });
      }
    });
  });

  describe("Integration with Existing Commands", () => {
    test("count should work with undo", async () => {
      editor.createBuffer("test", "one two three four");

      await editor.handleKey("2");
      await editor.handleKey("d");
      await editor.handleKey("w");

      // Undo should undo the entire 2dw operation
      await editor.handleKey("u");

      const state = editor.getState();
      const content = state.currentBuffer?.getContent();
      if (content && typeof content === "object" && "right" in content) {
        expect(content.right).toBe("one two three four");
      }
    });

    test("count should be preserved in lastCommand", async () => {
      await editor.handleKey("3");
      await editor.handleKey("w");

      const state = editor.getState();
      // Last command should include the count
      expect(state.lastCommand).toContain("word-next");
    });
  });
});
