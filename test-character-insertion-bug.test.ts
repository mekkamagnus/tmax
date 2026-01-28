import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Editor } from "./src/editor/editor.ts";
import { TerminalIOImpl } from "./src/core/terminal.ts";
import { FileSystemImpl } from "./src/core/filesystem.ts";

Deno.test("character insertion and save bug reproduction", async () => {
  const terminal = new TerminalIOImpl(false); // development mode
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);

  // Create a test file to edit
  const testFileName = "test-char-insert.txt";
  await filesystem.writeFile(testFileName, "");

  // Open the file
  await editor.openFile(testFileName);

  // Start editor (loads bindings, etc.)
  await editor.start();

  // Switch to insert mode
  await editor.handleKey("i");

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

  // Enter command mode
  await editor.handleKey(":");
  
  // Type 'w' to save
  await editor.handleKey("w");
  
  // Press Enter to execute the save command
  await editor.handleKey("\n"); // Enter key

  // Check if the file was saved with the content
  const savedContent = await filesystem.readFile(testFileName);
  console.log("Saved content:", savedContent);
  
  // The content should be "Hello World"
  assertEquals(savedContent, "Hello World");

  // Clean up - use Deno.remove directly since FileSystemImpl doesn't have unlink
  await Deno.remove(testFileName).catch(() => {}); // Ignore error if file doesn't exist
});