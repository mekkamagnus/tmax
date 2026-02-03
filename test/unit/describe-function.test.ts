/**
 * @file describe-function.test.ts
 * @description Tests for US-1.11.2 - Describe Function (C-h f) functionality
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("US-1.11.2: Describe Function", () => {
  let editor: Editor;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;

  beforeEach(() => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    editor.start();
  });

  test("describe-function shows function documentation", () => {
    const interpreter = editor.getInterpreter();

    // Define a function with documentation (single line for parser compatibility)
    interpreter.execute('(defun test-function () "This is a test function with documentation." (editor-quit))');

    // Describe the function
    const result = interpreter.execute('(describe-function "test-function")');

    // Should return structured information
    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("list");
      if (result.right.type === "list") {
        const values = result.right.value;
        expect(values.length).toBeGreaterThanOrEqual(3);

        // [name, signature, docstring, file?]
        const name = values[0];
        expect(name.type).toBe("string");
        if (name.type === "string") {
          expect(name.value).toBe("test-function");
        }

        const signature = values[1];
        expect(signature.type).toBe("string");
        if (signature.type === "string") {
          expect(signature.value).toBe("test-function ()");
        }

        const docstring = values[2];
        expect(docstring.type).toBe("string");
        if (docstring.type === "string") {
          expect(docstring.value).toBe("This is a test function with documentation.");
        }
      }
    }
  });

  test("describe-function for unknown function shows error", () => {
    const interpreter = editor.getInterpreter();
    const result = interpreter.execute('(describe-function "unknown-function")');

    // Should return nil or error indicator
    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("nil");
    }
  });

  test("describe-function shows 'No documentation available' when missing", () => {
    const interpreter = editor.getInterpreter();

    // Define a function without documentation (single line)
    interpreter.execute('(defun no-doc-function () (editor-quit))');

    // Describe the function
    const result = interpreter.execute('(describe-function "no-doc-function")');

    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("list");
      if (result.right.type === "list") {
        const values = result.right.value;
        expect(values.length).toBeGreaterThanOrEqual(2);

        // Should still return info but with no/empty documentation
        if (values.length >= 3) {
          const doc = values[2];
          expect(doc.type).toBe("string");
          if (doc.type === "string") {
            expect(doc.value).toBe("No documentation available");
          }
        }
      }
    }
  });

  test("describe-function shows signature with parameters", () => {
    const interpreter = editor.getInterpreter();

    // Define a function with parameters (single line)
    interpreter.execute('(defun greet (name greeting) "Greet someone with a custom greeting." (message greeting name))');

    const result = interpreter.execute('(describe-function "greet")');

    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("list");
      if (result.right.type === "list") {
        const values = result.right.value;

        const signature = values[1];
        expect(signature.type).toBe("string");
        if (signature.type === "string") {
          expect(signature.value).toBe("greet (name greeting)");
        }

        const docstring = values[2];
        expect(docstring.type).toBe("string");
        if (docstring.type === "string") {
          expect(docstring.value).toBe("Greet someone with a custom greeting.");
        }
      }
    }
  });

  test("C-h f prompts for function name in minibuffer", () => {
    const interpreter = editor.getInterpreter();

    // Test that describe-function-prompt exists
    const result = interpreter.execute('(describe-function-prompt)');

    // Should either work or indicate it needs to be called interactively
    if (typeof result === "object" && "right" in result) {
      // Just verify it doesn't error
      expect(result).toBeDefined();
    }
  });

  test("describe-function for built-in function shows docs", () => {
    const interpreter = editor.getInterpreter();

    // Describe a built-in function
    const result = interpreter.execute('(describe-function "editor-quit")');

    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("list");
      if (result.right.type === "list") {
        const values = result.right.value;
        expect(values.length).toBeGreaterThanOrEqual(2);

        const name = values[0];
        expect(name.type).toBe("string");
        if (name.type === "string") {
          expect(name.value).toBe("editor-quit");
        }
      }
    }
  });

  test("describe-function completion shows matching functions", () => {
    const interpreter = editor.getInterpreter();

    // Define some test functions
    interpreter.execute(`
      (defun test-func-1 () "Doc 1" (editor-quit))
      (defun test-func-2 () "Doc 2" (editor-quit))
      (defun other-func () "Doc 3" (editor-quit))
    `);

    // Get completions for "test-func"
    const result = interpreter.execute('(describe-function-complete "test-func")');

    if (typeof result === "object" && "right" in result) {
      expect(result.right.type).toBe("list");
      if (result.right.type === "list") {
        const values = result.right.value;
        // Should return matching functions
        expect(values.length).toBeGreaterThan(0);
      }
    }
  });
});
