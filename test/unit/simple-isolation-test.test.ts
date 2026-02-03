/**
 * @file simple-isolation-test.test.ts
 * @description Simple test to verify isolation
 */

import { describe, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Simple Isolation Test", () => {
  test("debug defvar in test environment", () => {
    const mockTerminal = new MockTerminal();
    const mockFileSystem = new MockFileSystem();
    const editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();

    const interpreter = editor.getInterpreter();

    console.log("Testing defvar...");
    try {
      const result = interpreter.execute('(defvar test-var 42)');
      console.log("defvar result:", result);
    } catch (error) {
      console.log("defvar error:", error);
    }

    // Try to access the variable
    try {
      const result = interpreter.execute('test-var');
      console.log("accessing test-var result:", result);
    } catch (error) {
      console.log("accessing test-var error:", error);
    }

    editor.stop();
  });
});