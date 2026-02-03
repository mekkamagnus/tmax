/**
 * @file debug-tlisp-testing.test.ts
 * @description Debug the T-Lisp testing framework functionality
 */

import { describe, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Debug T-Lisp Testing Framework", () => {
  test("debug deftest function", () => {
    const mockTerminal = new MockTerminal();
    const mockFileSystem = new MockFileSystem();
    const editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();

    const interpreter = editor.getInterpreter();

    try {
      const result = interpreter.execute('(deftest my-test () (assert-true t))');
      console.log("deftest result:", result);
    } catch (error) {
      console.log("deftest error:", error);
    }

    editor.stop();
  });

  test("debug assert-true function", () => {
    const mockTerminal = new MockTerminal();
    const mockFileSystem = new MockFileSystem();
    const editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();

    const interpreter = editor.getInterpreter();

    try {
      const result = interpreter.execute('(assert-true t)');
      console.log("assert-true result:", result);
    } catch (error) {
      console.log("assert-true error:", error);
    }

    editor.stop();
  });
});