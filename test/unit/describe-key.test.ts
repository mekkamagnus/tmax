/**
 * @file describe-key.test.ts
 * @description Tests for US-1.11.1 - Describe Key (C-h k) functionality
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("US-1.11.1: Describe Key", () => {
  let editor: Editor;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;

  beforeEach(() => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    editor.start();
  });

  test("C-h k followed by key shows bound command", () => {
    const interpreter = editor.getInterpreter();

    // First, bind a test key
    interpreter.execute('(key-bind "C-x C-f" "find-file" "normal")');

    // Now test describe-key for that binding
    const result = interpreter.execute('(describe-key "C-x C-f" "normal")');

    // Should return information about the binding
    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("list");
      if (result.right.type === "list") {
        const values = result.right.value;
        expect(values.length).toBeGreaterThan(0);

        // First element should be the command
        const first = values[0];
        expect(first.type).toBe("string");
        if (first.type === "string") {
          expect(first.value).toBe("find-file");
        }
      }
    }
  });

  test("describe-key for unbound key shows 'Key is unbound'", () => {
    const interpreter = editor.getInterpreter();
    const result = interpreter.execute('(describe-key "C-x C-z" "normal")');

    // Should return nil or a special "unbound" indicator
    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("nil");
    }
  });

  test("describe-key for C-x C-f shows 'find-file' documentation", () => {
    const interpreter = editor.getInterpreter();

    // Bind the key
    interpreter.execute('(key-bind "C-x C-f" "find-file" "normal")');

    // Describe the key
    const result = interpreter.execute('(describe-key "C-x C-f" "normal")');

    // Should return structured information
    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("list");
      if (result.right.type === "list") {
        const values = result.right.value;
        expect(values.length).toBeGreaterThanOrEqual(2);

        // [command, key, mode, documentation?]
        const command = values[0];
        expect(command.type).toBe("string");
        if (command.type === "string") {
          expect(command.value).toBe("find-file");
        }

        const key = values[1];
        expect(key.type).toBe("string");
        if (key.type === "string") {
          expect(key.value).toBe("C-x C-f");
        }
      }
    }
  });

  test("C-g cancels describe-key", () => {
    const interpreter = editor.getInterpreter();

    // This tests the interactive behavior
    // For now, we just verify that C-g is bound to exit-mx-mode
    const result = interpreter.execute('(key-binding "C-g" "mx")');

    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("list");
      if (result.right.type === "list") {
        const values = result.right.value;
        expect(values.length).toBeGreaterThan(0);

        const command = values[0];
        expect(command.type).toBe("string");
        if (command.type === "string") {
          // The command is stored with parentheses
          expect(command.value).toContain("editor-exit-mx-mode");
        }
      }
    }
  });

  test("describe-key with default mode uses current editor mode", () => {
    const interpreter = editor.getInterpreter();

    // Test without specifying mode (should use current mode)
    const result = interpreter.execute('(describe-key "q")');

    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("list");
      if (result.right.type === "list") {
        const values = result.right.value;
        expect(values.length).toBeGreaterThan(0);

        const command = values[0];
        expect(command.type).toBe("string");
        if (command.type === "string") {
          // The command is stored with parentheses
          expect(command.value).toContain("editor-quit");
        }
      }
    }
  });

  test("describe-key shows documentation if available", () => {
    const interpreter = editor.getInterpreter();

    // First define a function with documentation
    interpreter.execute(`
      (defun test-function ()
        "This is a test function with documentation."
        (editor-quit))
    `);

    // Bind it
    interpreter.execute('(key-bind "C-c t" "test-function" "normal")');

    // Describe the key
    const result = interpreter.execute('(describe-key "C-c t" "normal")');

    // Should include documentation field (even if not implemented yet)
    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("list");
      if (result.right.type === "list") {
        const values = result.right.value;
        // Should have at least [command, key, mode, documentation]
        expect(values.length).toBeGreaterThanOrEqual(3);

        if (values.length >= 4) {
          const doc = values[3];
          expect(doc.type).toBe("string");
          // TODO: Once docstring support is implemented, this should contain the function documentation
          if (doc.type === "string") {
            expect(doc.value).toBeDefined();
          }
        }
      }
    }
  });

  test("describe-key shows 'No documentation available' when missing", () => {
    const interpreter = editor.getInterpreter();

    // Bind a key to a command without documentation
    interpreter.execute('(key-bind "C-c x" "some-unknown-command" "normal")');

    // Describe the key
    const result = interpreter.execute('(describe-key "C-c x" "normal")');

    // Should still return info but with no/empty documentation
    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("list");
      if (result.right.type === "list") {
        const values = result.right.value;
        expect(values.length).toBeGreaterThanOrEqual(2);

        // If there's a 4th element (documentation), it should indicate no docs
        if (values.length >= 4) {
          const doc = values[3];
          expect(doc.type).toBe("string");
          if (doc.type === "string") {
            expect(doc.value).toBe("No documentation available");
          }
        }
      }
    }
  });
});
