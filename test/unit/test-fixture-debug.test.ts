import { describe, test, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Debug Fixture", () => {
  let editor: Editor;
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;

  beforeEach(() => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();
  });

  afterEach(() => {
    editor.stop();
  });

  test("debug fixture execution", () => {
    const interpreter = editor.getInterpreter();

    // Define fixture
    console.log("1. Defining fixture...");
    const defResult = interpreter.execute('(deffixture setup-x () (defvar x 100))');
    console.log("Def result:", defResult);

    // Define test
    console.log("2. Defining test...");
    const testDefResult = interpreter.execute('(deftest test-with-x () (use-fixtures setup-x) (assert-equal x 100))');
    console.log("Test def result:", testDefResult);

    // Run test
    console.log("3. Running test...");
    const runResult = interpreter.execute('(test-run "test-with-x")');
    console.log("Run result:", JSON.stringify(runResult, null, 2));

    expect(runResult._tag).toBe("Right");
  });
});
