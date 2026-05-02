import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Parser multiline test", () => {
  let editor: Editor;

  beforeEach(() => {
    const mockTerminal = new MockTerminal();
    const mockFileSystem = new MockFileSystem();
    editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();
  });

  test("multiline deftest", () => {
    const code = `
(deftest my-test () (assert-true t))
`;
    const interpreter = (editor as any).interpreter;
    const result = interpreter.execute(code);
    console.log("Result:", result);
    expect(result._tag).toBe("Right");
  });
});
