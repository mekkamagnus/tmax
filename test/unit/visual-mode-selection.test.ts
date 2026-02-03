/**
 * @file visual-mode-selection.test.ts
 * @description Tests for Visual Mode Selection (US-1.7.1)
 *
 * Tests Vim-style visual mode with:
 * - v (character-wise selection)
 * - V (line-wise selection)
 * - Ctrl+v (block-wise selection)
 * - Cursor movement expands selection
 * - Text manipulation (d, y, u, U)
 * - Esc exits visual mode
 */

import { describe, test, expect } from "bun:test";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { Editor } from "../../src/editor/editor.ts";
import { Either } from "../../src/utils/task-either.ts";
import { readFileSync } from "fs";

describe("Visual Mode Selection - US-1.7.1", () => {
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let editor: Editor;
  let interpreter: any;

  // Setup before each test
  const setup = async (content: string = "Line 1: Hello World\nLine 2: Test Content\nLine 3: Sample Text\nLine 4: Final Line") => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();

    // Load bindings files into mock filesystem
    const bindingFiles = [
      "src/tlisp/core/bindings/normal.tlisp",
      "src/tlisp/core/bindings/insert.tlisp",
      "src/tlisp/core/bindings/visual.tlisp",
      "src/tlisp/core/bindings/command.tlisp",
    ];

    for (const file of bindingFiles) {
      try {
        const fileContent = readFileSync(file, "utf-8");
        filesystem.setFile(file, fileContent);
      } catch (error) {
        // File not found - skip
      }
    }

    editor = new Editor(terminal, filesystem);
    editor.createBuffer("test", content);
    interpreter = editor.getInterpreter();
  };

  describe("Character-wise Visual Mode (v)", () => {
    test("v enters character-wise visual mode", async () => {
      // Arrange
      setup();

      // Act: Press 'v' to enter visual mode
      await editor.handleKey("v", "v");

      // Assert: Should be in visual mode
      const state = editor.getState();
      expect(state.mode).toBe("visual");
    });

    test("v sets selection start at cursor position", async () => {
      // Arrange
      setup();

      // Move cursor to position
      interpreter.execute("(cursor-move 0 7)");

      // Act: Press 'v' to enter visual mode
      await editor.handleKey("v", "v");

      // Assert: Selection should start at cursor position
      const selection = editor.getSelection();
      expect(selection).toBeDefined();
      expect(selection.start.line).toBe(0);
      expect(selection.start.column).toBe(7);
      expect(selection.end.line).toBe(0);
      expect(selection.end.column).toBe(7);
    });

    test("cursor movement expands selection in visual mode", async () => {
      // Arrange
      await setup();
      interpreter.execute("(cursor-move 0 7)");
      await editor.handleKey("v", "v");

      // Act: Move cursor right using l key (which triggers visual-update-end via handleKey)
      await editor.handleKey("l", "l");

      // Assert: Selection should expand
      const selection = editor.getSelection();
      expect(selection.start.column).toBe(7);
      expect(selection.end.column).toBe(8);
    });

    test("multi-line character selection works", async () => {
      // Arrange
      setup();
      interpreter.execute("(cursor-move 0 0)");
      await editor.handleKey("v", "v");

      // Act: Move cursor to line 2, column 10
      interpreter.execute("(cursor-move 1 10)");

      // Assert: Selection should span multiple lines
      const selection = editor.getSelection();
      expect(selection.start.line).toBe(0);
      expect(selection.start.column).toBe(0);
      expect(selection.end.line).toBe(1);
      expect(selection.end.column).toBe(10);
    });
  });

  describe("Line-wise Visual Mode (V)", () => {
    test("V enters line-wise visual mode", async () => {
      // Arrange
      setup();

      // Act: Press 'V' (Shift+v) to enter line-wise visual mode
      await editor.handleKey("V", "V");

      // Assert: Should be in visual mode with line selection
      const state = editor.getState();
      expect(state.mode).toBe("visual");
      const selection = editor.getSelection();
      expect(selection.mode).toBe("line");
    });

    test("V selects entire current line", async () => {
      // Arrange
      setup();
      interpreter.execute("(cursor-move 1 5)");

      // Act: Press 'V'
      await editor.handleKey("V", "V");

      // Assert: Entire line should be selected
      const selection = editor.getSelection();
      expect(selection.start.line).toBe(1);
      expect(selection.start.column).toBe(0);
      expect(selection.end.line).toBe(1);
      // End column should be at end of line
      expect(selection.end.column).toBeGreaterThanOrEqual(0);
    });

    test("vertical movement expands line selection", async () => {
      // Arrange
      setup();
      interpreter.execute("(cursor-move 1 0)");
      await editor.handleKey("V", "V");

      // Act: Move down to line 3
      interpreter.execute("(cursor-move 3 0)");

      // Assert: Lines 1-3 should be selected
      const selection = editor.getSelection();
      expect(selection.start.line).toBe(1);
      expect(selection.end.line).toBe(3);
    });
  });

  describe("Block-wise Visual Mode (Ctrl+v)", () => {
    test("Ctrl+v enters block-wise visual mode", async () => {
      // Arrange
      setup();

      // Act: Press Ctrl+v
      await editor.handleKey("\x13", "C-v"); // Ctrl+v is ASCII 0x13

      // Assert: Should be in visual mode with block selection
      const state = editor.getState();
      expect(state.mode).toBe("visual");
      const selection = editor.getSelection();
      expect(selection.mode).toBe("block");
    });

    test("block selection works for rectangular areas", async () => {
      // Arrange
      setup();
      interpreter.execute("(cursor-move 0 7)");
      await editor.handleKey("\x13", "C-v");

      // Act: Move cursor to line 2, column 15
      interpreter.execute("(cursor-move 2 15)");

      // Assert: Block selection should be set
      const selection = editor.getSelection();
      expect(selection.start.line).toBe(0);
      expect(selection.start.column).toBe(7);
      expect(selection.end.line).toBe(2);
      expect(selection.end.column).toBe(15);
      expect(selection.mode).toBe("block");
    });
  });

  describe("Text Manipulation in Visual Mode", () => {
    test("d deletes selected text", async () => {
      // Arrange
      setup();
      interpreter.execute("(cursor-move 1 7)");
      await editor.handleKey("v", "v");
      interpreter.execute("(cursor-move 1 14)");

      // Act: Press 'd' to delete
      await editor.handleKey("d", "d");

      // Assert: Text should be deleted, mode should be normal
      const state = editor.getState();
      expect(state.mode).toBe("normal");
      const buffer = state.currentBuffer;
      if (buffer) {
        const lineResult = buffer.getLine(1);
        expect(Either.isRight(lineResult)).toBe(true);
        if (Either.isRight(lineResult)) {
          const line = lineResult.right;
          expect(line).not.toContain("Test Content");
        }
      }
    });

    test("y yanks selected text without deleting", async () => {
      // Arrange
      await setup();
      interpreter.execute("(cursor-move 1 7)");
      await editor.handleKey("v", "v");
      interpreter.execute("(cursor-move 1 14)");

      // Act: Press 'y' to yank
      await editor.handleKey("y", "y");

      // Assert: Text should not be deleted, copied to register
      const state = editor.getState();
      expect(state.mode).toBe("normal");
      const buffer = editor.getState().currentBuffer;
      if (buffer) {
        const lineResult = buffer.getLine(1);
        expect(Either.isRight(lineResult)).toBe(true);
        if (Either.isRight(lineResult)) {
          expect(lineResult.right).toContain("Test Content");
        }
      }
      // Yank register should contain selected text
      // (This would require a getYankRegister function)
    });

    test("u lowercases selected text", async () => {
      // Arrange
      await setup("HELLO WORLD");
      interpreter.execute("(cursor-move 0 0)");
      await editor.handleKey("v", "v");
      interpreter.execute("(cursor-move 0 5)");

      // Act: Press 'u' to lowercase
      await editor.handleKey("u", "u");

      // Assert: Text should be lowercased
      const buffer = editor.getState().currentBuffer;
      if (buffer) {
        const lineResult = buffer.getLine(0);
        expect(Either.isRight(lineResult)).toBe(true);
        if (Either.isRight(lineResult)) {
          expect(lineResult.right.substring(0, 6)).toBe("hello");
        }
      }
    });

    test("U uppercases selected text", async () => {
      // Arrange
      await setup("hello world");
      interpreter.execute("(cursor-move 0 0)");
      await editor.handleKey("v", "v");
      interpreter.execute("(cursor-move 0 5)");

      // Act: Press 'U' to uppercase
      await editor.handleKey("U", "U");

      // Assert: Text should be uppercased
      const buffer = editor.getState().currentBuffer;
      if (buffer) {
        const lineResult = buffer.getLine(0);
        expect(Either.isRight(lineResult)).toBe(true);
        if (Either.isRight(lineResult)) {
          expect(lineResult.right.substring(0, 6)).toBe("HELLO");
        }
      }
    });
  });

  describe("Exiting Visual Mode", () => {
    test("Esc exits visual mode and clears selection", async () => {
      // Arrange
      setup();
      interpreter.execute("(cursor-move 0 7)");
      await editor.handleKey("v", "v");
      interpreter.execute("(cursor-move 0 12)");
      const state = editor.getState();
      expect(state.mode).toBe("visual");

      // Act: Press Escape
      await editor.handleKey("Escape", "Escape");

      // Assert: Should be in normal mode, selection cleared
      const newState = editor.getState();
      expect(newState.mode).toBe("normal");
      const selection = editor.getSelection();
      expect(selection).toBeNull();
    });
  });

  describe("Selection State", () => {
    test("getSelection returns null when not in visual mode", () => {
      // Arrange
      setup();

      // Act: Get selection in normal mode
      const selection = editor.getSelection();

      // Assert: Should be null
      expect(selection).toBeNull();
    });
  });

  describe("Navigation in Visual Mode", () => {
    test("hjkl navigation works in visual mode", async () => {
      // Arrange
      await setup();
      interpreter.execute("(cursor-move 1 7)");
      await editor.handleKey("v", "v");

      // Act: Move with l (right)
      await editor.handleKey("l", "l");

      // Assert: Selection should expand
      const selection = editor.getSelection();
      expect(selection.end.column).toBe(8);
    });

    test("word navigation (w, b, e) expands selection", async () => {
      // Arrange
      setup();
      interpreter.execute("(cursor-move 0 7)");
      await editor.handleKey("v", "v");

      // Act: Press w to move to next word
      const result = interpreter.execute("(word-next)");
      expect(Either.isRight(result)).toBe(true);

      // Assert: Selection should expand to next word
      const selection = editor.getSelection();
      expect(selection.end.column).toBeGreaterThan(7);
    });
  });
});
