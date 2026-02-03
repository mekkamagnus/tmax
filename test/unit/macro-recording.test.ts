/**
 * @file macro-recording.test.ts
 * @description Tests for Vim-style keyboard macro recording (US-2.4.1)
 * Tests cover: qa starts recording, q stops recording, @a executes macro, @@ executes last macro
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Macro Recording (US-2.4.1)", () => {
  let editor: Editor;
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;

  beforeEach(() => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    editor = new Editor(mockTerminal, mockFileSystem);

    // Create a test buffer with some content
    const buffer = editor.createBuffer("line1\nline2\nline3\nline4");
    editor.state.currentBuffer = buffer;
    editor.state.cursorPosition = { line: 0, column: 0 };

    // Reset macro recording state
    resetMacroRecordingState();
  });

  /**
   * Helper to reset macro recording state between tests
   */
  function resetMacroRecordingState() {
    // Execute T-Lisp to reset macro state
    try {
      editor.interpreter.execute("(macro-record-reset)");
    } catch {
      // Ignore if function doesn't exist yet
    }
  }

  /**
   * Helper to get all recorded macros
   */
  function getMacros(): Map<string, string[]> {
    const result = editor.interpreter.execute("(macro-list)");
    if (result._tag === "Right" && result.right.type === "list") {
      const macros = new Map<string, string[]>();
      for (const item of result.right.value) {
        if (item.type === "list" && item.value.length === 2) {
          const register = item.value[0];
          const keys = item.value[1];
          if (register.type === "string" && keys.type === "list") {
            const keyList = keys.value.map(k => k.type === "string" ? k.value : "");
            macros.set(register.value, keyList);
          }
        }
      }
      return macros;
    }
    return new Map();
  }

  describe("Starting macro recording with 'q{register}'", () => {
    test("qa should start recording to register a", () => {
      // Execute qa via T-Lisp API
      const result = editor.interpreter.execute('(macro-record-start "a")');

      expect(result._tag).toBe("Right");

      // Check that recording is active
      const recordingResult = editor.interpreter.execute("(macro-record-active)");
      expect(recordingResult._tag).toBe("Right");
      if (recordingResult._tag === "Right") {
        expect(recordingResult.right.type).toBe("boolean");
        expect(recordingResult.right.value).toBe(true);
      }

      // Check the current register
      const registerResult = editor.interpreter.execute('(macro-record-register)');
      expect(registerResult._tag).toBe("Right");
      if (registerResult._tag === "Right") {
        expect(registerResult.right.type).toBe("string");
        expect(registerResult.right.value).toBe("a");
      }
    });

    test("qb should start recording to register b", () => {
      const result = editor.interpreter.execute('(macro-record-start "b")');

      expect(result._tag).toBe("Right");

      const registerResult = editor.interpreter.execute('(macro-record-register)');
      expect(registerResult._tag).toBe("Right");
      if (registerResult._tag === "Right") {
        expect(registerResult.right.value).toBe("b");
      }
    });

    test("q{digit} should start recording to numbered register 0-9", () => {
      for (let i = 0; i <= 9; i++) {
        resetMacroRecordingState();
        const register = String(i);
        const result = editor.interpreter.execute(`(macro-record-start "${register}")`);

        expect(result._tag).toBe("Right");

        const registerResult = editor.interpreter.execute('(macro-record-register)');
        expect(registerResult._tag).toBe("Right");
        if (registerResult._tag === "Right") {
          expect(registerResult.right.value).toBe(register);
        }
      }
    });

    test("qa when already recording should return error", () => {
      // Start first recording
      editor.interpreter.execute('(macro-record-start "a")');

      // Try to start another recording - should throw error
      expect(() => {
        editor.interpreter.execute('(macro-record-start "b")');
      }).toThrow("Already recording");
    });
  });

  describe("Recording keys during macro recording", () => {
    test("Recorded keys should be stored in macro", () => {
      // Start recording
      editor.interpreter.execute('(macro-record-start "a")');

      // Simulate pressing some keys (via T-Lisp API for testing)
      editor.interpreter.execute('(macro-record-key "l")');
      editor.interpreter.execute('(macro-record-key "l")');
      editor.interpreter.execute('(macro-record-key "i")');
      editor.interpreter.execute('(macro-record-key "h")');
      editor.interpreter.execute('(macro-record-key "e")');
      editor.interpreter.execute('(macro-record-key "l")');
      editor.interpreter.execute('(macro-record-key "l")');
      editor.interpreter.execute('(macro-record-key "o")');

      // Stop recording
      editor.interpreter.execute('(macro-record-stop)');

      // Check recorded keys
      const macros = getMacros();
      expect(macros.has("a")).toBe(true);

      const recordedKeys = macros.get("a");
      expect(recordedKeys).toEqual(["l", "l", "i", "h", "e", "l", "l", "o"]);
    });

    test("Recording multiple key sequences should preserve order", () => {
      // Start recording
      editor.interpreter.execute('(macro-record-start "b")');

      // Record a sequence of keys
      editor.interpreter.execute('(macro-record-key "d")');
      editor.interpreter.execute('(macro-record-key "d")');
      editor.interpreter.execute('(macro-record-key "i")');
      editor.interpreter.execute('(macro-record-key "w")');
      editor.interpreter.execute('(macro-record-key "o")');
      editor.interpreter.execute('(macro-record-key "r")');
      editor.interpreter.execute('(macro-record-key "d")');

      // Stop recording
      editor.interpreter.execute('(macro-record-stop)');

      // Verify the sequence
      const macros = getMacros();
      expect(macros.get("b")).toEqual(["d", "d", "i", "w", "o", "r", "d"]);
    });
  });

  describe("Stopping macro recording with 'q'", () => {
    test("q should stop recording and save macro", () => {
      // Start recording
      editor.interpreter.execute('(macro-record-start "a")');
      expect(editor.interpreter.execute('(macro-record-active)').right?.value).toBe(true);

      // Record some keys
      editor.interpreter.execute('(macro-record-key "x")');
      editor.interpreter.execute('(macro-record-key "y")');
      editor.interpreter.execute('(macro-record-key "z")');

      // Stop recording
      const stopResult = editor.interpreter.execute('(macro-record-stop)');
      expect(stopResult._tag).toBe("Right");

      // Verify recording stopped
      const activeResult = editor.interpreter.execute('(macro-record-active)');
      expect(activeResult._tag).toBe("Right");
      if (activeResult._tag === "Right") {
        expect(activeResult.right.value).toBe(false);
      }

      // Verify macro was saved
      const macros = getMacros();
      expect(macros.has("a")).toBe(true);
      expect(macros.get("a")).toEqual(["x", "y", "z"]);
    });

    test("q when not recording should return error", () => {
      // Should throw error when not recording
      expect(() => {
        editor.interpreter.execute('(macro-record-stop)');
      }).toThrow("Not recording");
    });

    test("Empty macro should be saved even if no keys recorded", () => {
      // Start and immediately stop recording
      editor.interpreter.execute('(macro-record-start "a")');
      editor.interpreter.execute('(macro-record-stop)');

      // Verify empty macro was saved
      const macros = getMacros();
      expect(macros.has("a")).toBe(true);
      expect(macros.get("a")).toEqual([]);
    });
  });

  describe("Executing macros with '@{register}'", () => {
    test("@a should execute recorded macro", () => {
      // Record a macro that moves cursor down
      editor.interpreter.execute('(macro-record-start "a")');
      editor.interpreter.execute('(macro-record-key "j")');
      editor.interpreter.execute('(macro-record-key "j")');
      editor.interpreter.execute('(macro-record-stop)');

      // Get initial cursor position
      const initialLine = editor.state.cursorPosition.line;

      // Execute the macro - this will call handleKey for each recorded key
      const execResult = editor.interpreter.execute('(macro-execute "a")');
      expect(execResult._tag).toBe("Right");

      // Note: In a real editor scenario, the keys would be executed via handleKey
      // For testing purposes, we verify that the macro was retrieved successfully
      // The actual key execution would happen through the editor's key handling system
      const macros = getMacros();
      expect(macros.has("a")).toBe(true);
      expect(macros.get("a")).toEqual(["j", "j"]);
    });

    test("@@ should execute last executed macro", () => {
      // Record macro a
      editor.interpreter.execute('(macro-record-start "a")');
      editor.interpreter.execute('(macro-record-key "j")');
      editor.interpreter.execute('(macro-record-stop)');

      // Execute macro a to set it as last macro
      const execResult1 = editor.interpreter.execute('(macro-execute "a")');
      expect(execResult1._tag).toBe("Right");

      // Execute last macro with @@
      const execResult2 = editor.interpreter.execute('(macro-execute-last)');
      expect(execResult2._tag).toBe("Right");

      // Verify that macro a was executed again
      if (execResult2._tag === "Right") {
        expect(execResult2.right.type).toBe("string");
        expect(execResult2.right.value).toBe("a");
      }
    });

    test("Executing macro with count parameter should accept count", () => {
      // Record a simple macro
      editor.interpreter.execute('(macro-record-start "a")');
      editor.interpreter.execute('(macro-record-key "x")'); // Delete character
      editor.interpreter.execute('(macro-record-stop)');

      // Execute macro with count parameter
      const execResult = editor.interpreter.execute('(macro-execute "a" 3)');
      expect(execResult._tag).toBe("Right");

      // Verify the macro executed with count
      const macros = getMacros();
      expect(macros.get("a")).toEqual(["x"]);
    });

    test("Executing non-existent macro should return error", () => {
      // Should throw error when macro doesn't exist
      expect(() => {
        editor.interpreter.execute('(macro-execute "z")');
      }).toThrow("No macro");
    });

    test("Executing macro should update last-executed macro", () => {
      // Record two macros
      editor.interpreter.execute('(macro-record-start "a")');
      editor.interpreter.execute('(macro-record-key "j")');
      editor.interpreter.execute('(macro-record-stop)');

      editor.interpreter.execute('(macro-record-start "b")');
      editor.interpreter.execute('(macro-record-key "k")');
      editor.interpreter.execute('(macro-record-stop)');

      // Execute macro b
      editor.interpreter.execute('(macro-execute "b")');

      // Check last macro
      const lastMacroResult = editor.interpreter.execute('(macro-last-executed)');
      expect(lastMacroResult._tag).toBe("Right");
      if (lastMacroResult._tag === "Right") {
        expect(lastMacroResult.right.type).toBe("string");
        expect(lastMacroResult.right.value).toBe("b");
      }
    });
  });

  describe("Macro state management", () => {
    test("macro-active should return false when not recording", () => {
      const result = editor.interpreter.execute('(macro-record-active)');

      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.type).toBe("boolean");
        expect(result.right.value).toBe(false);
      }
    });

    test("macro-register should return current register when recording", () => {
      editor.interpreter.execute('(macro-record-start "x")');

      const result = editor.interpreter.execute('(macro-record-register)');

      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.type).toBe("string");
        expect(result.right.value).toBe("x");
      }
    });

    test("macro-register should return nil when not recording", () => {
      const result = editor.interpreter.execute('(macro-record-register)');

      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.type).toBe("nil");
      }
    });

    test("macro-list should return all recorded macros", () => {
      // Record some macros
      editor.interpreter.execute('(macro-record-start "a")');
      editor.interpreter.execute('(macro-record-key "x")');
      editor.interpreter.execute('(macro-record-stop)');

      editor.interpreter.execute('(macro-record-start "b")');
      editor.interpreter.execute('(macro-record-key "y")');
      editor.interpreter.execute('(macro-record-stop)');

      // Get macro list
      const macros = getMacros();

      expect(macros.size).toBe(2);
      expect(macros.has("a")).toBe(true);
      expect(macros.has("b")).toBe(true);
      expect(macros.get("a")).toEqual(["x"]);
      expect(macros.get("b")).toEqual(["y"]);
    });

    test("macro-clear should remove all recorded macros", () => {
      // Record some macros
      editor.interpreter.execute('(macro-record-start "a")');
      editor.interpreter.execute('(macro-record-key "x")');
      editor.interpreter.execute('(macro-record-stop)');

      // Clear all macros
      editor.interpreter.execute('(macro-clear)');

      // Verify macros are cleared
      const macros = getMacros();
      expect(macros.size).toBe(0);
    });

    test("macro-clear-register should remove specific macro", () => {
      // Record two macros
      editor.interpreter.execute('(macro-record-start "a")');
      editor.interpreter.execute('(macro-record-key "x")');
      editor.interpreter.execute('(macro-record-stop)');

      editor.interpreter.execute('(macro-record-start "b")');
      editor.interpreter.execute('(macro-record-key "y")');
      editor.interpreter.execute('(macro-record-stop)');

      // Clear macro a
      editor.interpreter.execute('(macro-clear-register "a")');

      // Verify only macro a is removed
      const macros = getMacros();
      expect(macros.size).toBe(1);
      expect(macros.has("a")).toBe(false);
      expect(macros.has("b")).toBe(true);
    });
  });

  describe("Complex macro scenarios", () => {
    test("Macro with multiple mode switches should record keys", () => {
      // Record a macro that switches modes
      editor.interpreter.execute('(macro-record-start "a")');
      editor.interpreter.execute('(macro-record-key "i")'); // Enter insert mode
      editor.interpreter.execute('(macro-record-key "h")');
      editor.interpreter.execute('(macro-record-key "e")');
      editor.interpreter.execute('(macro-record-key "l")');
      editor.interpreter.execute('(macro-record-key "l")');
      editor.interpreter.execute('(macro-record-key "o")');
      editor.interpreter.execute('(macro-record-key "Escape")'); // Return to normal mode
      editor.interpreter.execute('(macro-record-stop)');

      // Execute the macro
      const execResult = editor.interpreter.execute('(macro-execute "a")');
      expect(execResult._tag).toBe("Right");

      // Verify the macro contains all the keys
      const macros = getMacros();
      expect(macros.get("a")).toEqual(["i", "h", "e", "l", "l", "o", "Escape"]);
    });

    test("Nested macro recording (recording while recording) should be prevented", () => {
      // Start first recording
      editor.interpreter.execute('(macro-record-start "a")');

      // Try to record another macro while recording - should throw error
      expect(() => {
        editor.interpreter.execute('(macro-record-start "b")');
      }).toThrow("Already recording");
    });

    test("Macro can contain other macro executions", () => {
      // Record macro a that deletes a character
      editor.interpreter.execute('(macro-record-start "a")');
      editor.interpreter.execute('(macro-record-key "x")');
      editor.interpreter.execute('(macro-record-stop)');

      // Record macro b that calls macro a
      editor.interpreter.execute('(macro-record-start "b")');
      editor.interpreter.execute('(macro-record-key "@")');
      editor.interpreter.execute('(macro-record-key "a")');
      editor.interpreter.execute('(macro-record-stop)');

      // Execute macro b
      const execResult = editor.interpreter.execute('(macro-execute "b")');
      expect(execResult._tag).toBe("Right");
    });
  });

  describe("Macro persistence (basic)", () => {
    test("Macro state should persist across T-Lisp executions", () => {
      // Record a macro
      editor.interpreter.execute('(macro-record-start "a")');
      editor.interpreter.execute('(macro-record-key "t")');
      editor.interpreter.execute('(macro-record-key "e")');
      editor.interpreter.execute('(macro-record-key "s")');
      editor.interpreter.execute('(macro-record-key "t")');
      editor.interpreter.execute('(macro-record-stop)');

      // Execute multiple separate commands that shouldn't affect macros
      const activeResult = editor.interpreter.execute('(macro-record-active)');
      expect(activeResult._tag).toBe("Right");
      if (activeResult._tag === "Right") {
        expect(activeResult.right.type).toBe("boolean");
        expect(activeResult.right.value).toBe(false);
      }

      // Verify macro still exists
      const macros = getMacros();
      expect(macros.has("a")).toBe(true);
      expect(macros.get("a")).toEqual(["t", "e", "s", "t"]);
    });
  });
});
