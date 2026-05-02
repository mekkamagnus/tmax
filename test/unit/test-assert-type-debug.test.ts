import { describe, test, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Debug assert-type", () => {
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

  test("assert-type with fixture", () => {
    const interpreter = editor.getInterpreter();

    // Without fixture
    interpreter.execute('(deftest test-without () (defvar my-num 42) (assert-type my-num number))');
    console.log("Without fixture:", interpreter.execute('(test-run "test-without")'));

    // With fixture
    interpreter.execute('(deffixture test-fixture () (defvar my-num 42))');
    interpreter.execute('(deftest test-with () (use-fixtures test-fixture) (assert-type my-num number))');
    console.log("With fixture:", interpreter.execute('(test-run "test-with")'));
  });
});
