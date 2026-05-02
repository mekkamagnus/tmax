import { describe, test, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Debug defvar simple", () => {
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

  test("check if variable is defined", () => {
    const interpreter = editor.getInterpreter();

    // Define variable
    const defResult = interpreter.execute('(defvar x 100)');
    console.log("defvar result:", defResult);

    // Check if variable exists
    const checkResult = interpreter.execute('(symbol-value x)');
    console.log("symbol-value result:", checkResult);
  });
});
