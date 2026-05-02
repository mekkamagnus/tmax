/**
 * @file simple-test-debug.test.ts
 * @description Simple test to debug the test framework
 */

import { describe, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Simple Test Debug", () => {
  test("simple test definition and run", () => {
    const mockTerminal = new MockTerminal();
    const mockFileSystem = new MockFileSystem();
    const editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();

    const interpreter = editor.getInterpreter();

    // Define a test
    console.log("Defining test...");
    const defResult = interpreter.execute('(deftest simple-test () (assert-true t))');
    console.log("deftest result:", defResult);

    // Try to run the test
    console.log("Running test...");
    const runResult = interpreter.execute('(test-run "simple-test")');
    console.log("test-run result:", runResult);

    editor.stop();
  });
});