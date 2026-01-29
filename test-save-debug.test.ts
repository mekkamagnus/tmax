import { test, expect } from 'bun:test';
import { Editor } from "../src/editor/editor.ts";
import { TerminalIOMock } from "./mocks/terminal-mock.ts";
import { FileSystemMock } from "./mocks/filesystem-mock.ts";

test("buffer insert and save should persist changes", async () => {
  const terminal = new TerminalIOMock();
  const filesystem = new FileSystemMock();
  const editor = new Editor(terminal, filesystem);

  // Create a file with initial content
  await filesystem.writeFile("/tmp/test.txt", "ABC");

  // Open the file
  await editor.openFile("/tmp/test.txt");

  // Get initial buffer content
  const initialState = editor.getState();
  const initialContent = initialState.currentBuffer?.getContent();
  console.log("Initial content:", initialContent);
  expect(initialContent?.right).toBe("ABC");

  // Enter insert mode
  editor.setEditorState({ ...initialState, mode: "insert" });

  // Simulate typing 'X'
  const insertState = editor.getState();
  await editor.handleKey('X');

  // Wait a bit for async operations
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check buffer content after insert
  const afterInsertState = editor.getState();
  const afterInsertContent = afterInsertState.currentBuffer?.getContent();
  console.log("After insert content:", afterInsertContent);

  // Save the file
  await editor.saveFile();

  // Read the file back
  const savedContent = await filesystem.readFile("/tmp/test.txt");
  console.log("Saved content:", savedContent);

  // The file should contain "ABCX"
  expect(savedContent).toBe("ABCX");
});
