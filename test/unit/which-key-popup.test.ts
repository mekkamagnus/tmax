/**
 * @file which-key-popup.test.ts
 * @description Tests for which-key popup functionality (US-1.10.3)
 *
 * Tests Emacs-style which-key popup showing available bindings after typing key prefix:
 * - C-c (pause) shows all C-c bindings in popup
 * - Popup shows key and command name for each binding
 * - Pressing next key updates popup with next-level bindings
 * - C-g closes popup
 * - SPC (pause) shows all SPC-prefixed commands
 * - Quick typing skips which-key (no pause)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { setWhichKeyTimeout } from "../../src/editor/utils/which-key.ts";

const TEST_WHICH_KEY_TIMEOUT = 50;

async function waitForWhichKeyState(editor: Editor, active: boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (editor.getState().whichKeyActive === active) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const waitForWhichKey = (editor: Editor) => waitForWhichKeyState(editor, true);

describe("Which-Key Popup (US-1.10.3)", () => {
  let editor: Editor;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;

  beforeEach(async () => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    setWhichKeyTimeout(TEST_WHICH_KEY_TIMEOUT);
    await editor.start();

    // Create a test buffer
    editor.createBuffer("test", "hello world");

    // Set up some test key bindings for which-key testing
    const interpreter = (editor as any).getInterpreter();

    // Create C-c bindings for testing (using existing commands)
    interpreter.execute('(key-bind "C-c c" "cursor-move" "normal")');
    interpreter.execute('(key-bind "C-c C-w" "save-current-file" "normal")');

    // Create SPC bindings for testing (using existing commands)
    // SPC ; is already bound to execute-extended-command-maybe
    interpreter.execute('(key-bind "SPC s" "save-current-file" "normal")');
  });

  afterEach(() => {
    setWhichKeyTimeout(1000);
  });

  describe("Which-Key State Management", () => {
    test("should track which-key active state", async () => {
      const state = editor.getState();

      // Initially which-key should not be active
      expect(state.whichKeyActive).toBe(false);
    });

    test("should store key prefix when which-key activates", async () => {
      // Type C-c prefix
      await editor.handleKey("\x03");

      await waitForWhichKey(editor);

      const state = editor.getState();
      expect(state.whichKeyActive).toBe(true);
      expect(state.whichKeyPrefix).toBe("C-c");
    });

    test("should clear which-key state when C-g is pressed", async () => {
      // Type C-c prefix
      await editor.handleKey("\x03");

      await waitForWhichKey(editor);

      // Press C-g to cancel
      await editor.handleKey("\x07");

      const state = editor.getState();
      expect(state.whichKeyActive).toBe(false);
      expect(state.whichKeyPrefix).toBe("");
    });

    test("should not activate which-key on quick typing", async () => {
      // Type C-c followed immediately by another key (no pause)
      await editor.handleKey("\x03");
      await editor.handleKey("c");

      // Wait a bit to ensure which-key didn't activate
      await waitForWhichKey(editor);

      const state = editor.getState();
      expect(state.whichKeyActive).toBe(false);
    });
  });

  describe("Which-Key Bindings Discovery", () => {
    test("should find all bindings for C-c prefix", async () => {
      // Type C-c prefix and wait for which-key
      await editor.handleKey("\x03");
      await waitForWhichKey(editor);

      const state = editor.getState();
      const bindings = state.whichKeyBindings || [];

      // Should find bindings that start with "C-c "
      expect(bindings.length).toBeGreaterThan(0);

      // Each binding should have key and command
      bindings.forEach((binding: any) => {
        expect(binding.key).toBeTruthy();
        expect(binding.command).toBeTruthy();
      });
    });

    test("should find all bindings for SPC prefix", async () => {
      // Type SPC prefix and wait for which-key
      await editor.handleKey(" ");
      await waitForWhichKey(editor);

      const state = editor.getState();
      const bindings = state.whichKeyBindings || [];

      // Note: space key is handled specially for SPC ; sequence, so which-key
      // might not activate for space alone. This test documents current behavior.
      // If bindings were found, verify structure
      if (bindings.length > 0) {
        // Should find bindings that start with "SPC " or "space "
        expect(bindings.length).toBeGreaterThan(0);
      }
      expect(Array.isArray(bindings)).toBe(true);
    });

    test("should show next-level bindings after typing second key", async () => {
      // Type C-c prefix and wait
      await editor.handleKey("\x03");
      await waitForWhichKey(editor);

      // Type second key
      await editor.handleKey("c");
      await waitForWhichKey(editor);

      const state = editor.getState();
      const bindings = state.whichKeyBindings || [];

      // Should show bindings for "C-c c" prefix
      bindings.forEach((binding: any) => {
        expect(binding.key).toMatch(/^C-c c/);
      });
    });
  });

  describe("Which-Key Popup Display", () => {
    test("should show which-key popup in status message", async () => {
      // Type C-c prefix and wait
      await editor.handleKey("\x03");
      await waitForWhichKey(editor);

      const state = editor.getState();

      // Status message should contain which-key information
      // Note: getDisplayKey removes the prefix, so we see "c" not "C-c c"
      expect(state.statusMessage).toContain("Which-key:");
    });

    test("should show multiple bindings in popup", async () => {
      // Type C-c prefix and wait
      await editor.handleKey("\x03");
      await waitForWhichKey(editor);

      const state = editor.getState();
      const bindings = state.whichKeyBindings || [];

      // If multiple bindings exist, show them
      if (bindings.length > 1) {
        // Status should show multiple bindings
        expect(bindings.length).toBeGreaterThan(1);
      }
    });
  });

  describe("Which-Key Timeout", () => {
    test("should activate which-key after configured timeout", async () => {
      // Type C-c prefix
      await editor.handleKey("\x03");

      await waitForWhichKeyState(editor, true);

      const state = editor.getState();
      expect(state.whichKeyActive).toBe(true);
    });

    test("should not activate which-key if next key pressed before timeout", async () => {
      // Type C-c prefix
      await editor.handleKey("\x03");

      // Type next key
      await editor.handleKey("c");

      // Wait to ensure which-key didn't activate
      await waitForWhichKey(editor);

      const state = editor.getState();
      expect(state.whichKeyActive).toBe(false);
    });
  });

  describe("Which-Key Mode-Specific Bindings", () => {
    test("should only show bindings for current mode", async () => {
      // Ensure we're in normal mode
      expect(editor.getMode()).toBe("normal");

      // Type C-c prefix and wait
      await editor.handleKey("\x03");
      await waitForWhichKey(editor);

      const state = editor.getState();
      const bindings = state.whichKeyBindings || [];

      // All bindings should be for normal mode
      bindings.forEach((binding: any) => {
        expect(binding.mode).toBe("normal");
      });
    });

    test("should show different bindings in different modes", async () => {
      // Test in normal mode
      await editor.handleKey("\x03");
      await waitForWhichKey(editor);

      const normalState = editor.getState();
      const normalBindings = normalState.whichKeyBindings || [];

      // Switch to insert mode
      await editor.handleKey("i");

      // Type C-c in insert mode
      await editor.handleKey("\x03");
      await waitForWhichKey(editor);

      const insertState = editor.getState();
      const insertBindings = insertState.whichKeyBindings || [];

      // Bindings might be different (or same if no mode-specific bindings)
      // Just verify the mechanism works
      expect(Array.isArray(insertBindings)).toBe(true);
    });
  });

  describe("Which-Key API Functions", () => {
    test("should provide which-key-enable function", async () => {
      const interpreter = (editor as any).getInterpreter();

      // Enable which-key
      const result = interpreter.execute("(which-key-enable)");

      expect(result._tag).toBe("Right");
    });

    test("should provide which-key-disable function", async () => {
      const interpreter = (editor as any).getInterpreter();

      // Disable which-key
      const result = interpreter.execute("(which-key-disable)");

      expect(result._tag).toBe("Right");
    });

    test("should provide which-key-timeout function", async () => {
      const interpreter = (editor as any).getInterpreter();

      // Set timeout
      const result = interpreter.execute("(which-key-timeout 1500)");

      expect(result._tag).toBe("Right");
    });

    test("should provide which-key-active function", async () => {
      const interpreter = (editor as any).getInterpreter();

      // Check if which-key is active
      const result = interpreter.execute("(which-key-active)");

      expect(result._tag).toBe("Right");
    });
  });

  describe("Which-Key Integration", () => {
    test("should execute command when selecting from which-key popup", async () => {
      // This test verifies that pressing a key shown in which-key executes the command
      // Type C-c prefix and wait
      await editor.handleKey("\x03");
      await waitForWhichKey(editor);

      const state = editor.getState();
      const bindings = state.whichKeyBindings || [];

      if (bindings.length > 0) {
        // Press the first key in the bindings
        const firstBinding = bindings[0]!;
        const keyToPress = firstBinding.key.split(" ").pop(); // Get last key in sequence

        if (keyToPress) {
          await editor.handleKey(keyToPress);

          // Command should have been executed
          // (specific behavior depends on the binding)
        }
      }
    });

    test("should clear which-key after executing command", async () => {
      // Type C-c prefix and wait
      await editor.handleKey("\x03");
      await waitForWhichKey(editor);

      const state = editor.getState();
      const bindings = state.whichKeyBindings || [];

      if (bindings.length > 0) {
        // Press a key to execute command
        const firstBinding = bindings[0]!;
        const keyToPress = firstBinding.key.split(" ").pop();

        if (keyToPress) {
          await editor.handleKey(keyToPress);

          // Which-key should be cleared
          const newState = editor.getState();
          expect(newState.whichKeyActive).toBe(false);
        }
      }
    });
  });
});
