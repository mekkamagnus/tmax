/**
 * @file debug-error-test.test.ts
 * @description Debug the error test
 */

import { describe, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Debug Error Test", () => {
  test("debug assert-error function", () => {
    const mockTerminal = new MockTerminal();
    const mockFileSystem = new MockFileSystem();
    const editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();

    const interpreter = editor.getInterpreter();

    // Test that assert-error works with a form that raises an error
    console.log("Testing assert-error with non-existent function...");
    try {
      const result = interpreter.execute('(assert-error (non-existent-function))');
      console.log("assert-error with non-existent function result:", result);
    } catch (error) {
      console.log("assert-error with non-existent function error:", error);
    }

    // Test that assert-error fails with a form that doesn't raise an error
    console.log("Testing assert-error with successful form...");
    try {
      const result = interpreter.execute('(assert-error (+ 1 2))');
      console.log("assert-error with successful form result:", result);
    } catch (error) {
      console.log("assert-error with successful form error:", error);
    }

    // Test the full test workflow
    console.log("Testing full workflow...");
    try {
      interpreter.execute('(deftest error-test-2 () (assert-error (+ 1 2)))'); // This should fail the test
      const result = interpreter.execute('(test-run "error-test-2")');
      console.log("test-run for error-test-2 (should be false):", result);
    } catch (error) {
      console.log("Error in full workflow:", error);
    }

    try {
      interpreter.execute('(deftest error-test-3 () (assert-error (undefined-symbol)))'); // This should pass the test
      const result = interpreter.execute('(test-run "error-test-3")');
      console.log("test-run for error-test-3 (should be true):", result);
    } catch (error) {
      console.log("Error in full workflow 2:", error);
    }

    editor.stop();
  });
});