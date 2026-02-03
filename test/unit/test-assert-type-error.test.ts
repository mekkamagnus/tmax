import { describe, test, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Debug assert-type error", () => {
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

  test("what error does assert-type give", () => {
    const interpreter = editor.getInterpreter();

    // Try the assertion directly
    const result = interpreter.execute('(assert-type 42 number)');
    console.log("Direct assert-type result:", JSON.stringify(result, null, 2));

    // Check test registry
    console.log("Test names:", interpreter.getAllTestNames?.());
  });
});
