import { describe, test, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { resetFixtureState } from "../../src/tlisp/test-framework.ts";

describe("Debug Fixture Underscore", () => {
  let editor: Editor;
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;

  beforeEach(() => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();
    resetFixtureState();
  });

  afterEach(() => {
    editor.stop();
  });

  test("check deffixture with underscore", () => {
    const interpreter = editor.getInterpreter();

    // Define fixture with underscore
    const defResult = interpreter.execute('(deffixture setup_x () (defvar x 100))');
    console.log("Def fixture result:", JSON.stringify(defResult, null, 2));

    if (defResult._tag === "Left") {
      console.log("Error message:", defResult.left.message);
    } else {
      // Define test
      const testDefResult = interpreter.execute('(deftest test_with_x () (use-fixtures setup_x) (assert-equal x 100))');
      console.log("Test def result:", JSON.stringify(testDefResult, null, 2));

      // Run test
      const runResult = interpreter.execute('(test-run "test_with_x")');
      console.log("Run result:", JSON.stringify(runResult, null, 2));
    }
  });
});
