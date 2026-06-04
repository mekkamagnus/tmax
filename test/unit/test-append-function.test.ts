import { test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

test("append function exists", async () => {
  const mockTerminal = new MockTerminal();
  const mockFileSystem = new MockFileSystem();
  const editor = new Editor(mockTerminal, mockFileSystem);
  await editor.start();

  const interpreter = (editor as any).interpreter;
  const result = interpreter.execute('(append (list 1) (list 2))');
  
  console.log("Result:", result);
  
  editor.stop();
});
