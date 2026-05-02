/**
 * @file apropos-command.test.ts
 * @description Tests for US-1.11.3 - Apropos Command (C-h a) functionality
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("US-1.11.3: Apropos Command", () => {
  let editor: Editor;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;

  beforeEach(() => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    editor.start();
  });

  test("apropos-command finds commands by pattern", () => {
    const interpreter = editor.getInterpreter();

    // Define some test functions with 'save' in the name
    interpreter.execute(`
      (defun buffer-save () "Save current buffer." (editor-quit))
      (defun file-save () "Save file to disk." (editor-quit))
      (defun save-all () "Save all buffers." (editor-quit))
      (defun other-command () "Does not match." (editor-quit))
    `);

    // Search for commands with 'save' in the name
    const result = interpreter.execute('(apropos-command "save")');

    // Should return Right with list of matching commands
    expect(result).toBeDefined();
    if (typeof result === "object" && "_tag" in result) {
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.type).toBe("list");
        if (result.right.type === "list") {
          const values = result.right.value;
          // Should find all three commands with 'save' in the name
          expect(values.length).toBeGreaterThanOrEqual(3);

          // Each result should be a list: [name, binding, docstring]
          for (const item of values) {
            expect(item.type).toBe("list");
            if (item.type === "list") {
              const cmdInfo = item.value;
              expect(cmdInfo.length).toBeGreaterThanOrEqual(2);
            }
          }
        }
      }
    }
  });

  test("apropos-command with regex pattern matches multiple words", () => {
    const interpreter = editor.getInterpreter();

    // Define test functions
    interpreter.execute(`
      (defun save-buffer () "Save buffer." (editor-quit))
      (defun buffer-save () "Buffer save." (editor-quit))
      (defun file-save-buffer () "File save buffer." (editor-quit))
      (defun unrelated-command () "Unrelated." (editor-quit))
    `);

    // Search for pattern matching 'save.*buffer'
    const result = interpreter.execute('(apropos-command "save.*buffer")');

    if (typeof result === "object" && "_tag" in result) {
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.type).toBe("list");
        if (result.right.type === "list") {
          const values = result.right.value;
          // Should find commands that match the pattern
          expect(values.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("apropos-command returns command name and binding", () => {
    const interpreter = editor.getInterpreter();

    // Define a test function and bind it
    interpreter.execute('(defun my-save-command () "Save something." (editor-quit))');
    interpreter.execute('(key-bind "C-c s" "my-save-command" "normal")');

    const result = interpreter.execute('(apropos-command "save")');

    if (typeof result === "object" && "_tag" in result) {
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.type).toBe("list");
        if (result.right.type === "list") {
          const values = result.right.value;

          // Find our command in the results
          const mySaveCmd = values.find((item: any) => {
            if (item.type === "list") {
              const name = item.value[0];
              return name.type === "string" && name.value === "my-save-command";
            }
            return false;
          });

          expect(mySaveCmd).toBeDefined();
          if (mySaveCmd && mySaveCmd.type === "list") {
            const cmdInfo = mySaveCmd.value;
            // Should have [name, binding?, docstring]
            expect(cmdInfo.length).toBeGreaterThanOrEqual(2);

            const name = cmdInfo[0];
            expect(name.type).toBe("string");
            if (name.type === "string") {
              expect(name.value).toBe("my-save-command");
            }

            // Binding should be present (includes mode information)
            if (cmdInfo.length >= 2 && cmdInfo[1].type === "string") {
              expect(cmdInfo[1].value).toContain("C-c s");
            }
          }
        }
      }
    }
  });

  test("apropos-command shows 'No commands found' for no matches", () => {
    const interpreter = editor.getInterpreter();

    // Search for non-existent pattern
    const result = interpreter.execute('(apropos-command "xyz-nonexistent-command")');

    if (typeof result === "object" && "_tag" in result) {
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.type).toBe("list");
        if (result.right.type === "list") {
          const values = result.right.value;
          // Should return empty list
          expect(values.length).toBe(0);
        }
      }
    }
  });

  test("apropos-command is case-insensitive", () => {
    const interpreter = editor.getInterpreter();

    interpreter.execute('(defun Save-Buffer () "Save buffer." (editor-quit))');

    // Search with lowercase
    const result1 = interpreter.execute('(apropos-command "save")');

    if (typeof result1 === "object" && "_tag" in result1) {
      expect(result1._tag).toBe("Right");
      if (result1._tag === "Right") {
        expect(result1.right.type).toBe("list");
        if (result1.right.type === "list") {
          expect(result1.right.value.length).toBeGreaterThan(0);
        }
      }
    }

    // Search with uppercase
    const result2 = interpreter.execute('(apropos-command "SAVE")');

    if (typeof result2 === "object" && "_tag" in result2) {
      expect(result2._tag).toBe("Right");
      if (result2._tag === "Right") {
        expect(result2.right.type).toBe("list");
        if (result2.right.type === "list") {
          expect(result2.right.value.length).toBeGreaterThan(0);
        }
      }
    }

    // Search with mixed case
    const result3 = interpreter.execute('(apropos-command "SaVe")');

    if (typeof result3 === "object" && "_tag" in result3) {
      expect(result3._tag).toBe("Right");
      if (result3._tag === "Right") {
        expect(result3.right.type).toBe("list");
        if (result3.right.type === "list") {
          expect(result3.right.value.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("apropos-command includes documentation in results", () => {
    const interpreter = editor.getInterpreter();

    interpreter.execute('(defun documented-command () "This is a documented command." (editor-quit))');

    const result = interpreter.execute('(apropos-command "documented")');

    if (typeof result === "object" && "_tag" in result) {
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.type).toBe("list");
        if (result.right.type === "list") {
          const values = result.right.value;
          expect(values.length).toBeGreaterThan(0);

          const cmd = values[0];
          if (cmd.type === "list") {
            const cmdInfo = cmd.value;
            expect(cmdInfo.length).toBeGreaterThanOrEqual(3);

            const docstring = cmdInfo[2];
            expect(docstring.type).toBe("string");
            if (docstring.type === "string") {
              expect(docstring.value).toBe("This is a documented command.");
            }
          }
        }
      }
    }
  });

  test("C-h a prompts for search pattern", () => {
    const interpreter = editor.getInterpreter();

    // Test that apropos-command-prompt exists
    const result = interpreter.execute('(apropos-command-prompt)');

    // Should return Right without error
    if (typeof result === "object" && "_tag" in result) {
      expect(result._tag).toBe("Right");
    }
  });

  test("apropos-command works with built-in functions", () => {
    const interpreter = editor.getInterpreter();

    // Search for built-in functions with 'buffer' in the name
    const result = interpreter.execute('(apropos-command "buffer")');

    if (typeof result === "object" && "_tag" in result) {
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.type).toBe("list");
        if (result.right.type === "list") {
          const values = result.right.value;
          // Should find some built-in buffer functions
          expect(values.length).toBeGreaterThan(0);

          // Check that results have proper structure
          const firstResult = values[0];
          if (firstResult.type === "list") {
            expect(firstResult.value.length).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });
});
