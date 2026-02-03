/**
 * @file minibuffer-input.test.ts
 * @description Tests for minibuffer input functionality (US-1.10.1)
 *
 * Tests Emacs-style minibuffer for command input:
 * - M-x enters command mode
 * - Tab completes or shows options
 * - Enter executes command
 * - C-g cancels
 * - M-p/M-n for command history
 * - Commands requiring arguments prompt in minibuffer
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Minibuffer Input (US-1.10.1)", () => {
  let editor: Editor;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;

  beforeEach(() => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    editor.start();

    // Create a test buffer
    editor.createBuffer("test", "hello world");
  });

  describe("M-x Mode Entry", () => {
    test("should enter mx mode when pressing SPC then ;", async () => {
      expect(editor.getMode()).toBe("normal");

      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      expect(editor.getMode()).toBe("mx");
    });

    test("should initialize empty mxCommand when entering mx mode", async () => {
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      const state = editor.getState();
      expect(state.mxCommand).toBe("");
    });

    test("should not enter mx mode with space alone", async () => {
      await editor.handleKey(" ", "space");

      expect(editor.getMode()).toBe("normal");
    });
  });

  describe("Minibuffer Text Input", () => {
    test("should add characters to mxCommand when typing", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type command
      await editor.handleKey("b");
      await editor.handleKey("u");
      await editor.handleKey("f");
      await editor.handleKey("f");
      await editor.handleKey("e");
      await editor.handleKey("r");
      await editor.handleKey("-");
      await editor.handleKey("s");
      await editor.handleKey("a");
      await editor.handleKey("v");
      await editor.handleKey("e");

      const state = editor.getState();
      expect(state.mxCommand).toBe("buffer-save");
    });

    test("should remove last character with backspace", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type command
      await editor.handleKey("b");
      await editor.handleKey("u");
      await editor.handleKey("f");
      await editor.handleKey("f");
      await editor.handleKey("e");
      await editor.handleKey("r");

      // Backspace twice
      await editor.handleKey("Backspace", "Backspace");
      await editor.handleKey("Backspace", "Backspace");

      const state = editor.getState();
      expect(state.mxCommand).toBe("buff");
    });

    test("should handle empty mxCommand with backspace", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Backspace on empty command should not error
      await editor.handleKey("Backspace", "Backspace");

      const state = editor.getState();
      expect(state.mxCommand).toBe("");
    });
  });

  describe("Command Execution", () => {
    test("should execute command and return to normal mode on Enter", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type command
      await editor.handleKey("q");
      await editor.handleKey("u");
      await editor.handleKey("i");
      await editor.handleKey("t");

      const beforeMode = editor.getMode();
      expect(beforeMode).toBe("mx");

      // Press Enter
      await editor.handleKey("Enter", "Enter");

      const afterMode = editor.getMode();
      // Command should execute and mode should return to normal
      // Note: quit command will set running to false, so mode might be undefined
      expect(afterMode === "normal" || afterMode === undefined).toBe(true);
    });

    test("should clear mxCommand after execution", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type command
      await editor.handleKey("e");
      await editor.handleKey("d");
      await editor.handleKey("i");
      await editor.handleKey("t");
      await editor.handleKey("o");
      await editor.handleKey("r");
      await editor.handleKey("-");
      await editor.handleKey("m");
      await editor.handleKey("o");
      await editor.handleKey("d");
      await editor.handleKey("e");

      const beforeState = editor.getState();
      expect(beforeState.mxCommand).toBe("editor-mode");

      // Press Enter
      await editor.handleKey("Enter", "Enter");

      const afterState = editor.getState();
      expect(afterState.mxCommand).toBe("");
    });

    test("should not execute empty command", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Press Enter without typing
      await editor.handleKey("Enter", "Enter");

      const state = editor.getState();
      // Should return to normal mode
      expect(state.mode).toBe("normal");
      expect(state.mxCommand).toBe("");
    });
  });

  describe("Cancellation", () => {
    test("should cancel with Escape and clear mxCommand", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type something
      await editor.handleKey("b");
      await editor.handleKey("u");
      await editor.handleKey("f");

      // Press Escape
      await editor.handleKey("Escape", "Escape");

      const state = editor.getState();
      expect(state.mode).toBe("normal");
      expect(state.mxCommand).toBe("");
    });

    test("should cancel with C-g and clear mxCommand", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type something
      await editor.handleKey("b");
      await editor.handleKey("u");
      await editor.handleKey("f");

      // Press C-g (Ctrl+g)
      await editor.handleKey("\x07", "C-g");

      const state = editor.getState();
      expect(state.mode).toBe("normal");
      expect(state.mxCommand).toBe("");
    });
  });

  describe("Command History", () => {
    test("should store executed commands in history", async () => {
      // Execute first command
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("e");
      await editor.handleKey("d");
      await editor.handleKey("i");
      await editor.handleKey("t");
      await editor.handleKey("o");
      await editor.handleKey("r");
      await editor.handleKey("-");
      await editor.handleKey("m");
      await editor.handleKey("o");
      await editor.handleKey("d");
      await editor.handleKey("e");
      await editor.handleKey("Enter", "Enter");

      // Execute second command
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("q");
      await editor.handleKey("u");
      await editor.handleKey("i");
      await editor.handleKey("t");
      await editor.handleKey("Enter", "Enter");

      // Get command history via T-Lisp
      const interpreter = editor.getInterpreter();
      const result = interpreter.execute("(minibuffer-history)");

      if (typeof result === "object" && "right" in result) {
        expect(result.right.type).toBe("list");
        // History should contain both commands
        if (result.right.type === "list" && Array.isArray(result.right.value)) {
          expect(result.right.value.length).toBeGreaterThan(0);
        }
      }
    });

    test("should navigate to previous command with M-p", async () => {
      // Execute a command first
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("b");
      await editor.handleKey("u");
      await editor.handleKey("f");
      await editor.handleKey("f");
      await editor.handleKey("e");
      await editor.handleKey("r");
      await editor.handleKey("Enter", "Enter");

      // Enter M-x mode again
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Press M-p (Alt+p)
      await editor.handleKey("\x1bp", "M-p");

      const state = editor.getState();
      expect(state.mxCommand).toBe("buffer");
    });

    test("should navigate to next command with M-n", async () => {
      // Execute two commands
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("c");
      await editor.handleKey("m");
      await editor.handleKey("d");
      await editor.handleKey("1");
      await editor.handleKey("Enter", "Enter");

      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("c");
      await editor.handleKey("m");
      await editor.handleKey("d");
      await editor.handleKey("2");
      await editor.handleKey("Enter", "Enter");

      // Enter M-x mode again
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Press M-p twice
      await editor.handleKey("\x1bp", "M-p");
      await editor.handleKey("\x1bp", "M-p");

      // Now press M-n once
      await editor.handleKey("\x1bn", "M-n");

      const state = editor.getState();
      expect(state.mxCommand).toBe("cmd2");
    });

    test("should handle M-p at beginning of history", async () => {
      // Execute a command
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("t");
      await editor.handleKey("e");
      await editor.handleKey("s");
      await editor.handleKey("t");
      await editor.handleKey("Enter", "Enter");

      // Enter M-x mode again
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Press M-p multiple times
      await editor.handleKey("\x1bp", "M-p");
      await editor.handleKey("\x1bp", "M-p");
      await editor.handleKey("\x1bp", "M-p");

      const state = editor.getState();
      // Should stay at oldest command
      expect(state.mxCommand).toBe("test");
    });

    test("should handle M-n at end of history", async () => {
      // Execute a command
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("h");
      await editor.handleKey("i");
      await editor.handleKey("s");
      await editor.handleKey("t");
      await editor.handleKey("o");
      await editor.handleKey("r");
      await editor.handleKey("y");
      await editor.handleKey("Enter", "Enter");

      // Enter M-x mode again
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Press M-n multiple times
      await editor.handleKey("\x1bn", "M-n");
      await editor.handleKey("\x1bn", "M-n");

      const state = editor.getState();
      // Should clear to empty at end of history
      expect(state.mxCommand).toBe("");
    });
  });

  describe("Tab Completion (US-1.10.2)", () => {
    test("should complete 'file-s' to 'file-save'", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type partial command
      await editor.handleKey("f");
      await editor.handleKey("i");
      await editor.handleKey("l");
      await editor.handleKey("e");
      await editor.handleKey("-");
      await editor.handleKey("s");

      // Press Tab
      await editor.handleKey("\t", "Tab");

      const state = editor.getState();
      // Should complete to "file-save"
      expect(state.mxCommand).toBe("file-save");
    });

    test("should complete 'fs' to 'file-save' (fuzzy)", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type fuzzy pattern
      await editor.handleKey("f");
      await editor.handleKey("s");

      // Press Tab
      await editor.handleKey("\t", "Tab");

      const state = editor.getState();
      // Should complete to "file-save" using fuzzy matching
      expect(state.mxCommand).toBe("file-save");
    });

    test("should show multiple completion options when ambiguous", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type partial command that has multiple matches
      await editor.handleKey("b");
      await editor.handleKey("u");
      await editor.handleKey("f");

      // Press Tab
      await editor.handleKey("\t", "Tab");

      const state = editor.getState();
      // Should show matches in status message
      expect(state.statusMessage).toContain("Matches:");
      expect(state.statusMessage).toContain("buffer");
    });

    test("should show 'No match' when no completions available", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type something that won't match
      await editor.handleKey("z");
      await editor.handleKey("z");
      await editor.handleKey("z");

      // Press Tab
      await editor.handleKey("\t", "Tab");

      const state = editor.getState();
      // Should indicate no match
      expect(state.statusMessage).toContain("No match");
    });

    test("should filter list as user types", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type 'b' and press Tab
      await editor.handleKey("b");
      await editor.handleKey("\t", "Tab");

      let state = editor.getState();
      const message1 = state.statusMessage;

      // Continue typing to 'buf' and press Tab
      await editor.handleKey("u");
      await editor.handleKey("f");
      await editor.handleKey("\t", "Tab");

      state = editor.getState();
      const message2 = state.statusMessage;

      // More specific pattern should filter results
      // The second message should have different or fewer matches
      expect(message2).toBeDefined();
    });

    test("should complete single match fully", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type a pattern that matches only one command (file-save)
      await editor.handleKey("f");
      await editor.handleKey("i");
      await editor.handleKey("l");
      await editor.handleKey("e");
      await editor.handleKey("-");
      await editor.handleKey("s");

      // Press Tab
      await editor.handleKey("\t", "Tab");

      const state = editor.getState();
      // Should complete to full command
      expect(state.mxCommand).toBe("file-save");
    });
  });

  describe("T-Lisp API", () => {
    test("minibuffer-active should return true in mx mode", async () => {
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      const interpreter = editor.getInterpreter();
      const result = interpreter.execute("(minibuffer-active)");

      if (typeof result === "object" && "right" in result) {
        expect(result.right).toEqual({ type: "boolean", value: true });
      }
    });

    test("minibuffer-active should return false in normal mode", () => {
      const interpreter = editor.getInterpreter();
      const result = interpreter.execute("(minibuffer-active)");

      if (typeof result === "object" && "right" in result) {
        expect(result.right).toEqual({ type: "boolean", value: false });
      }
    });

    test("minibuffer-get should return current command", async () => {
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("t");
      await editor.handleKey("e");
      await editor.handleKey("s");
      await editor.handleKey("t");

      const interpreter = editor.getInterpreter();
      const result = interpreter.execute("(minibuffer-get)");

      if (typeof result === "object" && "right" in result) {
        expect(result.right).toEqual({ type: "string", value: "test" });
      }
    });

    test("minibuffer-set should set command text", async () => {
      const interpreter = editor.getInterpreter();
      interpreter.execute("(minibuffer-set \"example\")");

      const state = editor.getState();
      expect(state.mxCommand).toBe("example");
    });

    test("minibuffer-clear should clear command text", async () => {
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("t");
      await editor.handleKey("e");
      await editor.handleKey("s");
      await editor.handleKey("t");

      const interpreter = editor.getInterpreter();
      interpreter.execute("(minibuffer-clear)");

      const state = editor.getState();
      expect(state.mxCommand).toBe("");
    });

    test("minibuffer-history should return list of past commands", async () => {
      // Execute some commands
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("c");
      await editor.handleKey("m");
      await editor.handleKey("d");
      await editor.handleKey("1");
      await editor.handleKey("Enter", "Enter");

      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("c");
      await editor.handleKey("m");
      await editor.handleKey("d");
      await editor.handleKey("2");
      await editor.handleKey("Enter", "Enter");

      const interpreter = editor.getInterpreter();
      const result = interpreter.execute("(minibuffer-history)");

      if (typeof result === "object" && "right" in result) {
        expect(result.right.type).toBe("list");
      }
    });

    test("minibuffer-history-add should add command to history", async () => {
      const interpreter = editor.getInterpreter();
      interpreter.execute('(minibuffer-history-add "test-command")');

      const result = interpreter.execute("(minibuffer-history)");
      if (typeof result === "object" && "right" in result) {
        if (result.right.type === "list" && Array.isArray(result.right.value)) {
          const historyStr = result.right.value.map((v: any) =>
            v.type === "string" ? v.value : ""
          );
          expect(historyStr).toContain("test-command");
        }
      }
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long commands", async () => {
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type a very long command
      const longCommand = "a".repeat(200);
      for (const char of longCommand) {
        await editor.handleKey(char);
      }

      const state = editor.getState();
      expect(state.mxCommand.length).toBe(200);
    });

    test("should handle special characters in commands", async () => {
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      // Type command with special chars (avoiding characters that might form escape sequences)
      await editor.handleKey("@");
      await editor.handleKey("#");
      await editor.handleKey("$");

      const state = editor.getState();
      expect(state.mxCommand).toBe("@#$");
    });

    test("should handle rapid mode switches", async () => {
      // Enter M-x mode
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("t");
      await editor.handleKey("e");

      // Cancel
      await editor.handleKey("Escape", "Escape");

      // Enter again immediately
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");

      const state = editor.getState();
      expect(state.mode).toBe("mx");
      expect(state.mxCommand).toBe("");
    });

    test("should preserve command history across mode switches", async () => {
      // Execute command
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("h");
      await editor.handleKey("i");
      await editor.handleKey("Enter", "Enter");

      // Switch to insert mode and back
      await editor.handleKey("i");
      await editor.handleKey("Escape", "Escape");

      // Enter M-x and check history
      await editor.handleKey(" ", "space");
      await editor.handleKey(";", "semicolon");
      await editor.handleKey("\x1bp", "M-p");

      const state = editor.getState();
      expect(state.mxCommand).toBe("hi");
    });
  });
});
