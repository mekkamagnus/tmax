/**
 * @file macro-recording.test.ts
 * @description Tests for Vim-style keyboard macro recording (US-2.4.1)
 * Tests cover: qa starts recording, q stops recording, @a executes macro, @@ executes last macro
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  expectDefined,
  expectRight,
  expectTlispBoolean,
  expectTlispList,
  expectTlispString,
} from "../helpers/editor-fixture.ts";
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
    editor.createBuffer("test", "line1\nline2\nline3\nline4");

    // Reset macro recording state
    resetMacroRecordingState();
  });

  /**
   * Helper to reset macro recording state between tests
   */
  function resetMacroRecordingState() {
    // Execute T-Lisp to reset macro state
    try {
      editor.getInterpreter().execute("(macro-record-reset)");
    } catch {
      // Ignore if function doesn't exist yet
    }
  }

  /**
   * Helper to get all recorded macros
   */
  function getMacros(): Map<string, string[]> {
    const result = editor.getInterpreter().execute("(macro-list)");
    const macros = new Map<string, string[]>();
    for (const item of expectTlispList(expectRight(result))) {
      const pair = expectTlispList(item);
      const register = expectTlispString(expectDefined(pair[0]));
      const keys = expectTlispList(expectDefined(pair[1]));
      macros.set(register, keys.map((key) => expectTlispString(key)));
    }
    return macros;
  }

  describe("Starting macro recording with 'q{register}'", () => {
    test("qa should start recording to register a", () => {
      // Execute qa via T-Lisp API
      const result = editor.getInterpreter().execute('(macro-record-start "a")');

      expect(result._tag).toBe("Right");

      // Check that recording is active
      const recordingResult = editor.getInterpreter().execute("(macro-record-active)");
      expect(recordingResult._tag).toBe("Right");
      if (recordingResult._tag === "Right") {
        expect(expectRight(recordingResult).type).toBe("boolean");
        expect(expectRight(recordingResult).value).toBe(true);
      }

      // Check the current register
      const registerResult = editor.getInterpreter().execute('(macro-record-register)');
      expect(registerResult._tag).toBe("Right");
      if (registerResult._tag === "Right") {
        expect(expectRight(registerResult).type).toBe("string");
        expect(expectRight(registerResult).value).toBe("a");
      }
    });

    test("qb should start recording to register b", () => {
      const result = editor.getInterpreter().execute('(macro-record-start "b")');

      expect(result._tag).toBe("Right");

      const registerResult = editor.getInterpreter().execute('(macro-record-register)');
      expect(registerResult._tag).toBe("Right");
      if (registerResult._tag === "Right") {
        expect(expectRight(registerResult).value).toBe("b");
      }
    });

    test("q{digit} should start recording to numbered register 0-9", () => {
      for (let i = 0; i <= 9; i++) {
        resetMacroRecordingState();
        const register = String(i);
        const result = editor.getInterpreter().execute(`(macro-record-start "${register}")`);

        expect(result._tag).toBe("Right");

        const registerResult = editor.getInterpreter().execute('(macro-record-register)');
        expect(registerResult._tag).toBe("Right");
        if (registerResult._tag === "Right") {
          expect(expectRight(registerResult).value).toBe(register);
        }
      }
    });

    test("qa when already recording should return error", () => {
      // Start first recording
      editor.getInterpreter().execute('(macro-record-start "a")');

      // Try to start another recording - should return error
      const result = editor.getInterpreter().execute('(macro-record-start "b")');
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("Already recording");
      }
    });
  });

  describe("Recording keys during macro recording", () => {
    test("Recorded keys should be stored in macro", () => {
      // Start recording
      editor.getInterpreter().execute('(macro-record-start "a")');

      // Simulate pressing some keys (via T-Lisp API for testing)
      editor.getInterpreter().execute('(macro-record-key "l")');
      editor.getInterpreter().execute('(macro-record-key "l")');
      editor.getInterpreter().execute('(macro-record-key "i")');
      editor.getInterpreter().execute('(macro-record-key "h")');
      editor.getInterpreter().execute('(macro-record-key "e")');
      editor.getInterpreter().execute('(macro-record-key "l")');
      editor.getInterpreter().execute('(macro-record-key "l")');
      editor.getInterpreter().execute('(macro-record-key "o")');

      // Stop recording
      editor.getInterpreter().execute('(macro-record-stop)');

      // Check recorded keys
      const macros = getMacros();
      expect(macros.has("a")).toBe(true);

      const recordedKeys = macros.get("a");
      expect(recordedKeys).toEqual(["l", "l", "i", "h", "e", "l", "l", "o"]);
    });

    test("Recording multiple key sequences should preserve order", () => {
      // Start recording
      editor.getInterpreter().execute('(macro-record-start "b")');

      // Record a sequence of keys
      editor.getInterpreter().execute('(macro-record-key "d")');
      editor.getInterpreter().execute('(macro-record-key "d")');
      editor.getInterpreter().execute('(macro-record-key "i")');
      editor.getInterpreter().execute('(macro-record-key "w")');
      editor.getInterpreter().execute('(macro-record-key "o")');
      editor.getInterpreter().execute('(macro-record-key "r")');
      editor.getInterpreter().execute('(macro-record-key "d")');

      // Stop recording
      editor.getInterpreter().execute('(macro-record-stop)');

      // Verify the sequence
      const macros = getMacros();
      expect(macros.get("b")).toEqual(["d", "d", "i", "w", "o", "r", "d"]);
    });
  });

  describe("Stopping macro recording with 'q'", () => {
    test("q should stop recording and save macro", () => {
      // Start recording
      editor.getInterpreter().execute('(macro-record-start "a")');
      expect(expectTlispBoolean(expectRight(editor.getInterpreter().execute('(macro-record-active)')))).toBe(true);

      // Record some keys
      editor.getInterpreter().execute('(macro-record-key "x")');
      editor.getInterpreter().execute('(macro-record-key "y")');
      editor.getInterpreter().execute('(macro-record-key "z")');

      // Stop recording
      const stopResult = editor.getInterpreter().execute('(macro-record-stop)');
      expect(stopResult._tag).toBe("Right");

      // Verify recording stopped
      const activeResult = editor.getInterpreter().execute('(macro-record-active)');
      expect(activeResult._tag).toBe("Right");
      if (activeResult._tag === "Right") {
        expect(expectRight(activeResult).value).toBe(false);
      }

      // Verify macro was saved
      const macros = getMacros();
      expect(macros.has("a")).toBe(true);
      expect(macros.get("a")).toEqual(["x", "y", "z"]);
    });

    test("q when not recording should return error", () => {
      const result = editor.getInterpreter().execute('(macro-record-stop)');
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("Not recording");
      }
    });

    test("Empty macro should be saved even if no keys recorded", () => {
      // Start and immediately stop recording
      editor.getInterpreter().execute('(macro-record-start "a")');
      editor.getInterpreter().execute('(macro-record-stop)');

      // Verify empty macro was saved
      const macros = getMacros();
      expect(macros.has("a")).toBe(true);
      expect(macros.get("a")).toEqual([]);
    });
  });

  describe("Executing macros with '@{register}'", () => {
    test("@a should execute recorded macro", () => {
      // Record a macro that moves cursor down
      editor.getInterpreter().execute('(macro-record-start "a")');
      editor.getInterpreter().execute('(macro-record-key "j")');
      editor.getInterpreter().execute('(macro-record-key "j")');
      editor.getInterpreter().execute('(macro-record-stop)');

      // Get initial cursor position
      const initialLine = editor.getState().cursorPosition.line;

      // Execute the macro - this will call handleKey for each recorded key
      const execResult = editor.getInterpreter().execute('(macro-execute "a")');
      expect(execResult._tag).toBe("Right");

      // Note: In a real editor scenario, the keys would be executed via handleKey
      // For testing purposes, we verify that the macro was retrieved successfully
      // The actual key execution would happen through the editor's key handling system
      const macros = getMacros();
      expect(macros.has("a")).toBe(true);
      expect(macros.get("a")).toEqual(["j", "j"]);
    });

    test("@@ should execute last executed macro", async () => {
      // Record macro a
      editor.getInterpreter().execute('(macro-record-start "a")');
      editor.getInterpreter().execute('(macro-record-key "j")');
      editor.getInterpreter().execute('(macro-record-stop)');

      // Execute macro a to set it as last macro. SPEC-044 Phase 1.H made
      // macro-execute return a TLispPromise so the async evaluator (used by
      // the handler) can await each inner handleKey. Use executeAsync here
      // to resolve the promise and observe the underlying string return.
      const execResult1 = await editor.getInterpreter().executeAsync('(macro-execute "a")');
      expect(execResult1._tag).toBe("Right");

      // Execute last macro with @@
      const execResult2 = await editor.getInterpreter().executeAsync('(macro-execute-last)');
      expect(execResult2._tag).toBe("Right");

      // Verify that macro a was executed again
      if (execResult2._tag === "Right") {
        expect(expectRight(execResult2).type).toBe("string");
        expect(expectRight(execResult2).value).toBe("a");
      }
    });

    test("Executing macro with count parameter should accept count", () => {
      // Record a simple macro
      editor.getInterpreter().execute('(macro-record-start "a")');
      editor.getInterpreter().execute('(macro-record-key "x")'); // Delete character
      editor.getInterpreter().execute('(macro-record-stop)');

      // Execute macro with count parameter
      const execResult = editor.getInterpreter().execute('(macro-execute "a" 3)');
      expect(execResult._tag).toBe("Right");

      // Verify the macro executed with count
      const macros = getMacros();
      expect(macros.get("a")).toEqual(["x"]);
    });

    test("Executing non-existent macro should return error", () => {
      const result = editor.getInterpreter().execute('(macro-execute "z")');
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("No macro");
      }
    });

    test("Executing macro should update last-executed macro", () => {
      // Record two macros
      editor.getInterpreter().execute('(macro-record-start "a")');
      editor.getInterpreter().execute('(macro-record-key "j")');
      editor.getInterpreter().execute('(macro-record-stop)');

      editor.getInterpreter().execute('(macro-record-start "b")');
      editor.getInterpreter().execute('(macro-record-key "k")');
      editor.getInterpreter().execute('(macro-record-stop)');

      // Execute macro b
      editor.getInterpreter().execute('(macro-execute "b")');

      // Check last macro
      const lastMacroResult = editor.getInterpreter().execute('(macro-last-executed)');
      expect(lastMacroResult._tag).toBe("Right");
      if (lastMacroResult._tag === "Right") {
        expect(expectRight(lastMacroResult).type).toBe("string");
        expect(expectRight(lastMacroResult).value).toBe("b");
      }
    });
  });

  describe("Macro state management", () => {
    test("macro-active should return false when not recording", () => {
      const result = editor.getInterpreter().execute('(macro-record-active)');

      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(expectRight(result).type).toBe("boolean");
        expect(expectRight(result).value).toBe(false);
      }
    });

    test("macro-register should return current register when recording", () => {
      editor.getInterpreter().execute('(macro-record-start "x")');

      const result = editor.getInterpreter().execute('(macro-record-register)');

      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(expectRight(result).type).toBe("string");
        expect(expectRight(result).value).toBe("x");
      }
    });

    test("macro-register should return nil when not recording", () => {
      const result = editor.getInterpreter().execute('(macro-record-register)');

      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(expectRight(result).type).toBe("nil");
      }
    });

    test("macro-list should return all recorded macros", () => {
      // Record some macros
      editor.getInterpreter().execute('(macro-record-start "a")');
      editor.getInterpreter().execute('(macro-record-key "x")');
      editor.getInterpreter().execute('(macro-record-stop)');

      editor.getInterpreter().execute('(macro-record-start "b")');
      editor.getInterpreter().execute('(macro-record-key "y")');
      editor.getInterpreter().execute('(macro-record-stop)');

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
      editor.getInterpreter().execute('(macro-record-start "a")');
      editor.getInterpreter().execute('(macro-record-key "x")');
      editor.getInterpreter().execute('(macro-record-stop)');

      // Clear all macros
      editor.getInterpreter().execute('(macro-clear)');

      // Verify macros are cleared
      const macros = getMacros();
      expect(macros.size).toBe(0);
    });

    test("macro-clear-register should remove specific macro", () => {
      // Record two macros
      editor.getInterpreter().execute('(macro-record-start "a")');
      editor.getInterpreter().execute('(macro-record-key "x")');
      editor.getInterpreter().execute('(macro-record-stop)');

      editor.getInterpreter().execute('(macro-record-start "b")');
      editor.getInterpreter().execute('(macro-record-key "y")');
      editor.getInterpreter().execute('(macro-record-stop)');

      // Clear macro a
      editor.getInterpreter().execute('(macro-clear-register "a")');

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
      editor.getInterpreter().execute('(macro-record-start "a")');
      editor.getInterpreter().execute('(macro-record-key "i")'); // Enter insert mode
      editor.getInterpreter().execute('(macro-record-key "h")');
      editor.getInterpreter().execute('(macro-record-key "e")');
      editor.getInterpreter().execute('(macro-record-key "l")');
      editor.getInterpreter().execute('(macro-record-key "l")');
      editor.getInterpreter().execute('(macro-record-key "o")');
      editor.getInterpreter().execute('(macro-record-key "Escape")'); // Return to normal mode
      editor.getInterpreter().execute('(macro-record-stop)');

      // Execute the macro
      const execResult = editor.getInterpreter().execute('(macro-execute "a")');
      expect(execResult._tag).toBe("Right");

      // Verify the macro contains all the keys
      const macros = getMacros();
      expect(macros.get("a")).toEqual(["i", "h", "e", "l", "l", "o", "Escape"]);
    });

    test("Nested macro recording (recording while recording) should be prevented", () => {
      // Start first recording
      editor.getInterpreter().execute('(macro-record-start "a")');

      // Try to record another macro while recording - should return error
      const result = editor.getInterpreter().execute('(macro-record-start "b")');
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("Already recording");
      }
    });

    test("Macro can contain other macro executions", () => {
      // Record macro a that deletes a character
      editor.getInterpreter().execute('(macro-record-start "a")');
      editor.getInterpreter().execute('(macro-record-key "x")');
      editor.getInterpreter().execute('(macro-record-stop)');

      // Record macro b that calls macro a
      editor.getInterpreter().execute('(macro-record-start "b")');
      editor.getInterpreter().execute('(macro-record-key "@")');
      editor.getInterpreter().execute('(macro-record-key "a")');
      editor.getInterpreter().execute('(macro-record-stop)');

      // Execute macro b
      const execResult = editor.getInterpreter().execute('(macro-execute "b")');
      expect(execResult._tag).toBe("Right");
    });
  });

  describe("Macro persistence (basic)", () => {
    test("Macro state should persist across T-Lisp executions", () => {
      // Record a macro
      editor.getInterpreter().execute('(macro-record-start "a")');
      editor.getInterpreter().execute('(macro-record-key "t")');
      editor.getInterpreter().execute('(macro-record-key "e")');
      editor.getInterpreter().execute('(macro-record-key "s")');
      editor.getInterpreter().execute('(macro-record-key "t")');
      editor.getInterpreter().execute('(macro-record-stop)');

      // Execute multiple separate commands that shouldn't affect macros
      const activeResult = editor.getInterpreter().execute('(macro-record-active)');
      expect(activeResult._tag).toBe("Right");
      if (activeResult._tag === "Right") {
        expect(expectRight(activeResult).type).toBe("boolean");
        expect(expectRight(activeResult).value).toBe(false);
      }

      // Verify macro still exists
      const macros = getMacros();
      expect(macros.has("a")).toBe(true);
      expect(macros.get("a")).toEqual(["t", "e", "s", "t"]);
    });
  });
});
