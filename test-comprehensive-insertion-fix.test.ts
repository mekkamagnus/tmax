import { test, expect } from 'bun:test';
import { Editor } from "./src/editor/editor.ts";
import { TerminalIOImpl } from "./src/core/terminal.ts";
import { FileSystemImpl } from "./src/core/filesystem.ts";

test("comprehensive character insertion and save test", async () => {
  const terminal = new TerminalIOImpl(false); // development mode
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);

  // Create a test file to edit
  const testFileName = "comprehensive-test.txt";
  await filesystem.writeFile(testFileName, "");

  // Open the file
  await editor.openFile(testFileName);

  // Start editor (loads bindings, etc.)
  await editor.start();

  // Verify we're in normal mode initially
  expect(editor.getMode()).toBe("normal");

  // Switch to insert mode
  await editor.handleKey("i");
  expect(editor.getMode()).toBe("insert");

  // Insert some text
  await editor.handleKey("H");
  await editor.handleKey("e");
  await editor.handleKey("l");
  await editor.handleKey("l");
  await editor.handleKey("o");
  await editor.handleKey(" ");
  await editor.handleKey("W");
  await editor.handleKey("o");
  await editor.handleKey("r");
  await editor.handleKey("l");
  await editor.handleKey("d");

  // Exit insert mode
  await editor.handleKey("\x1b"); // Escape key
  expect(editor.getMode()).toBe("normal");

  // Verify the buffer contains the inserted text
  const stateAfterInsert = editor.getState();
  const contentAfterInsert = stateAfterInsert.currentBuffer?.getContent();
  if (contentAfterInsert && "right" in contentAfterInsert) {
    expect(contentAfterInsert.right).toBe("Hello World");
  } else {
    throw new Error("Could not get buffer content after insert");
  }

  // Enter command mode
  await editor.handleKey(":");
  expect(editor.getMode()).toBe("command");

  // Type 'w' to save
  await editor.handleKey("w");

  // Press Enter to execute the save command
  await editor.handleKey("\n"); // Enter key
  expect(editor.getMode()).toBe("normal");

  // Wait a bit for async save to complete
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check if the file was saved with the content
  const savedContent = await filesystem.readFile(testFileName);
  console.log("Saved content:", savedContent);

  // The content should be "Hello World"
  expect(savedContent).toBe("Hello World");

  // Clean up
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(testFileName);
  } catch {
    // Ignore error if file doesn't exist
  }
});