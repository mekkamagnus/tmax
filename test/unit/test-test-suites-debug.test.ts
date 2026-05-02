import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Debug test suites", () => {
  let editor: Editor;
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;

  beforeEach(() => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();
  });

  test("debug deftest-suite", () => {
    const code = `
      (deftest-suite "My Test Suite"
        (deftest test-one () (assert-true t))
      )
    `;

    const interpreter = (editor as any).interpreter;
    const result = interpreter.execute(code);

    console.log("Result:", result);
    console.log("Result._tag:", result._tag);
    if (result._tag === "Left") {
      console.log("Error:", result.left);
    }
  });
});
