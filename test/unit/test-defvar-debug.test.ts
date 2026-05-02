import { describe, test, beforeEach, afterEach } from "bun:test";
import { expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Debug defvar", () => {
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

  test("defvar in test", () => {
    const interpreter = editor.getInterpreter();

    // Define test with defvar
    interpreter.execute('(deftest test-defvar () (defvar x 100) (assert-equal x 100))');

    // Run test
    const result = interpreter.execute('(test-run "test-defvar")');
    console.log("Result:", JSON.stringify(result, null, 2));

    expect(result._tag).toBe("Right");
    expect(result.right.value).toBe(true);
  });
});
