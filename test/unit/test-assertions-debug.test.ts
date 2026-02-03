import { describe, test, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Debug assertions", () => {
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

  test("test each assertion", () => {
    const interpreter = editor.getInterpreter();

    interpreter.execute('(deffixture test-data () (defvar my-list (list 1 2 3)) (defvar my-string "hello") (defvar my-num 42))');
    interpreter.execute('(deftest test-fixture-assertions () (use-fixtures test-data) (assert-contains my-list 2) (assert-contains-string my-string "ell") (assert-type my-num number))');

    const result = interpreter.execute('(test-run "test-fixture-assertions")');
    console.log("Result:", JSON.stringify(result, null, 2));

    // Test each assertion individually
    console.log("\nTesting assert-contains...");
    interpreter.execute('(deftest test1 () (use-fixtures test-data) (assert-contains my-list 2))');
    console.log("assert-contains result:", interpreter.execute('(test-run "test1")'));

    console.log("\nTesting assert-contains-string...");
    interpreter.execute('(deftest test2 () (use-fixtures test-data) (assert-contains-string my-string "ell")');
    console.log("assert-contains-string result:", interpreter.execute('(test-run "test2")'));

    console.log("\nTesting assert-type...");
    interpreter.execute('(deftest test3 () (use-fixtures test-data) (assert-type my-num number))');
    console.log("assert-type result:", interpreter.execute('(test-run "test3")'));
  });
});
