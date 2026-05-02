import { describe, test, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Simple assert-type", () => {
  let editor: Editor;

  beforeEach(() => {
    const mockTerminal = new MockTerminal();
    const mockFileSystem = new MockFileSystem();
    editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();
  });

  afterEach(() => {
    editor.stop();
  });

  test("assert-type with literal number", () => {
    const interpreter = editor.getInterpreter();

    interpreter.execute('(deftest test-literal () (assert-type 42 number))');
    const result = interpreter.execute('(test-run "test-literal")');
    console.log("Literal result:", result);
  });

  test("assert-type with variable", () => {
    const interpreter = editor.getInterpreter();

    interpreter.execute('(deftest test-var () (defvar x 42) (assert-type x number))');
    const result = interpreter.execute('(test-run "test-var")');
    console.log("Variable result:", result);
  });
});
