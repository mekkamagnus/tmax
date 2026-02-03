import { describe, test, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { resetFixtureState } from "../../src/tlisp/test-framework.ts";

describe("Debug Fixture Simple", () => {
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

  test("check deffixture error", () => {
    const interpreter = editor.getInterpreter();

    // Define fixture
    const defResult = interpreter.execute('(deffixture setup-x () (defvar x 100))');
    console.log("Def fixture result:", JSON.stringify(defResult, null, 2));

    if (defResult._tag === "Left") {
      console.log("Error message:", defResult.left.message);
      console.log("Error details:", defResult.left.details);
    }
  });
});
