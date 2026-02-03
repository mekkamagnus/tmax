/**
 * @file word-navigation.test.ts
 * @description Test suite for Vim-style word navigation (US-1.1.1)
 * 
 * Tests for:
 * - w: move to start of next word
 * - b: move to start of previous word  
 * - e: move to end of current word
 * - Count prefix support (e.g., 3w)
 * - Line continuation for word navigation
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Word Navigation (US-1.1.1)", () => {
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

  describe("w - move to start of next word", () => {
    test("should move cursor to start of next word", () => {
      setup("hello world");
      
      // Start at position (0, 0)
      interpreter.execute("(cursor-move 0 0)");
      
      // Execute w command
      const result = interpreter.execute("(word-next)");
      expect(Either.isRight(result)).toBe(true);
      
      // Cursor should be at start of "world" (column 6)
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(6);
    });

    test("should move through multiple words", () => {
      setup("one two three");
      
      interpreter.execute("(cursor-move 0 0)");
      
      // First w moves to "two"
      interpreter.execute("(word-next)");
      let state = editor.getState();
      expect(state.cursorPosition.column).toBe(4);
      
      // Second w moves to "three"
      interpreter.execute("(word-next)");
      state = editor.getState();
      expect(state.cursorPosition.column).toBe(8);
    });

    test("should handle punctuation as word boundaries", () => {
      setup("hello,world");
      
      interpreter.execute("(cursor-move 0 0)");
      interpreter.execute("(word-next)");
      
      // Should treat comma as word boundary
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(6); // After comma
    });

    test("should continue to next line when at end of line", () => {
      setup("hello\nworld");
      
      // Start at end of first line
      interpreter.execute("(cursor-move 0 5)");
      interpreter.execute("(word-next)");
      
      // Should move to start of "world" on next line
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(1);
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should handle tabs as word boundaries", () => {
      setup("hello\tworld");
      
      interpreter.execute("(cursor-move 0 0)");
      interpreter.execute("(word-next)");
      
      const state = editor.getState();
      // Tab is treated as whitespace boundary
      expect(state.cursorPosition.column).toBeGreaterThan(0);
    });
  });

  describe("b - move to start of previous word", () => {
    test("should move cursor to start of previous word", () => {
      setup("hello world");
      
      // Start at "world"
      interpreter.execute("(cursor-move 0 6)");
      
      // Execute b command
      const result = interpreter.execute("(word-previous)");
      expect(Either.isRight(result)).toBe(true);
      
      // Cursor should be at start of "hello" (column 0)
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should move through multiple words backwards", () => {
      setup("one two three");
      
      // Start at "three"
      interpreter.execute("(cursor-move 0 8)");
      
      // First b moves to "two"
      interpreter.execute("(word-previous)");
      let state = editor.getState();
      expect(state.cursorPosition.column).toBe(4);
      
      // Second b moves to "one"
      interpreter.execute("(word-previous)");
      state = editor.getState();
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should continue to previous line when at start of line", () => {
      setup("hello\nworld");
      
      // Start at beginning of second line
      interpreter.execute("(cursor-move 1 0)");
      interpreter.execute("(word-previous)");
      
      // Should move to "hello" on previous line
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should not move beyond start of buffer", () => {
      setup("hello world");
      
      // Start at beginning
      interpreter.execute("(cursor-move 0 0)");
      
      // Try to move back - should stay at 0,0
      interpreter.execute("(word-previous)");
      
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(0);
    });
  });

  describe("e - move to end of current word", () => {
    test("should move cursor to end of current word", () => {
      setup("hello world");
      
      // Start at beginning of "hello"
      interpreter.execute("(cursor-move 0 0)");
      
      // Execute e command
      const result = interpreter.execute("(word-end)");
      expect(Either.isRight(result)).toBe(true);
      
      // Cursor should be at last character of "hello" (column 4)
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(4);
    });

    test("should move to end of next word from whitespace", () => {
      setup("hello world");
      
      // Start at space between words
      interpreter.execute("(cursor-move 0 5)");
      interpreter.execute("(word-end)");
      
      // Should move to end of "world"
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(10);
    });

    test("should move through multiple words", () => {
      setup("one two three");
      
      interpreter.execute("(cursor-move 0 0)");
      
      // First e moves to end of "one"
      interpreter.execute("(word-end)");
      let state = editor.getState();
      expect(state.cursorPosition.column).toBe(2);
      
      // Second e moves to end of "two"
      interpreter.execute("(word-end)");
      state = editor.getState();
      expect(state.cursorPosition.column).toBe(6);
    });

    test("should continue to next line when at end of word at line end", () => {
      setup("hello\nworld");
      
      // Start at "hello"
      interpreter.execute("(cursor-move 0 0)");
      interpreter.execute("(word-end)");
      
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(4);
      
      // Next e should move to next line
      interpreter.execute("(word-end)");
      const state2 = editor.getState();
      expect(state2.cursorPosition.line).toBe(1);
      expect(state2.cursorPosition.column).toBe(4);
    });
  });

  describe("Count prefix support", () => {
    test("3w should move forward 3 words", () => {
      setup("one two three four");
      
      interpreter.execute("(cursor-move 0 0)");
      
      // Execute 3w
      interpreter.execute("(word-next 3)");
      
      // Should be at start of "four"
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(14);
    });

    test("5b should move backward 5 words", () => {
      setup("one two three four five six");
      
      // Start at "six"
      interpreter.execute("(cursor-move 0 20)");
      
      // Execute 5b
      interpreter.execute("(word-previous 5)");
      
      // Should be at start of "one"
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(0);
    });

    test("2e should move to end of second word", () => {
      setup("one two three");
      
      interpreter.execute("(cursor-move 0 0)");
      
      // Execute 2e
      interpreter.execute("(word-end 2)");
      
      // Should be at end of "two"
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(6);
    });

    test("0w should not move cursor", () => {
      setup("one two three");
      
      interpreter.execute("(cursor-move 0 0)");
      
      // Execute 0w
      interpreter.execute("(word-next 0)");
      
      // Should stay at start
      const state = editor.getState();
      expect(state.cursorPosition.column).toBe(0);
    });
  });

  describe("Edge cases", () => {
    test("should handle empty buffer", () => {
      setup("");
      
      interpreter.execute("(cursor-move 0 0)");
      
      // Should not crash
      const result = interpreter.execute("(word-next)");
      expect(Either.isRight(result)).toBe(true);
    });

    test("should handle single word", () => {
      setup("hello");
      
      interpreter.execute("(cursor-move 0 0)");
      
      // w should stay at end of word
      interpreter.execute("(word-next)");
      let state = editor.getState();
      // Either stays at position or moves to end
      
      // b should stay at beginning
      interpreter.execute("(word-previous)");
      state = editor.getState();
      expect(state.cursorPosition.column).toBe(0);
    });

    test("should handle multiple spaces", () => {
      setup("hello    world");
      
      interpreter.execute("(cursor-move 0 0)");
      interpreter.execute("(word-next)");
      
      // Should skip multiple spaces
      const state = editor.getState();
      expect(state.cursorPosition.column).toBeGreaterThan(5);
    });

    test("should handle mixed whitespace", () => {
      setup("hello \t\nworld");
      
      interpreter.execute("(cursor-move 0 0)");
      interpreter.execute("(word-next)");
      
      // Should handle tabs and newlines as word boundaries
      const state = editor.getState();
      expect(state.cursorPosition.line).toBe(1);
    });

    test("should handle single character words", () => {
      setup("a b c d");
      
      interpreter.execute("(cursor-move 0 0)");
      
      // Move through single char words
      interpreter.execute("(word-next)");
      let state = editor.getState();
      expect(state.cursorPosition.column).toBe(2);
      
      interpreter.execute("(word-next)");
      state = editor.getState();
      expect(state.cursorPosition.column).toBe(4);
    });

    test("should handle words with numbers", () => {
      setup("test123 hello456");
      
      interpreter.execute("(cursor-move 0 0)");
      interpreter.execute("(word-next)");
      
      // Should treat alphanumeric as word characters
      const state = editor.getState();
      expect(state.cursorPosition.column).toBeGreaterThan(0);
    });

    test("should handle underscore in words", () => {
      setup("test_var hello_world");
      
      interpreter.execute("(cursor-move 0 0)");
      interpreter.execute("(word-next)");
      
      // Underscore typically part of word in programming
      const state = editor.getState();
      expect(state.cursorPosition.column).toBeGreaterThan(0);
    });
  });
});
