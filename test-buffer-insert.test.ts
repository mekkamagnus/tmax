import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Editor } from "./src/editor/editor.ts";
import { TerminalIOImpl } from "./src/core/terminal.ts";
import { FileSystemImpl } from "./src/core/filesystem.ts";
import { Either } from "./src/utils/task-either.ts";

Deno.test("buffer insert and save", async () => {
  const terminal = new TerminalIOImpl(false); // development mode
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);

  // Create buffer with content
  editor.createBuffer("test.txt", "ABC");

  // Start editor (loads bindings, etc.)
  await editor.start();

  // Get initial content
  const state1 = editor.getState();
  const initialContent = state1.currentBuffer?.getContent();
  console.log("Initial content:", initialContent);

  // Insert character by simulating T-Lisp call
  const buffer = state1.currentBuffer;
  if (buffer) {
    // Insert "X" at position (0, 3)
    const insertResult = buffer.insert({ line: 0, column: 3 }, "X");
    console.log("Insert result:", insertResult);

    // Update editor state with new buffer
    if (Either.isRight(insertResult)) {
      editor.setEditorState({
        ...state1,
        currentBuffer: insertResult.right,
        cursorPosition: { line: 0, column: 4 },
      });

      // Get new content
      const state2 = editor.getState();
      const newContent = state2.currentBuffer?.getContent();
      console.log("New content:", newContent);

      // Check if content contains "ABCX"
      if (newContent && Either.isRight(newContent)) {
        assertEquals(newContent.right, "ABCX");
        console.log("✓ Buffer insert works!");
      } else {
        console.error("✗ Buffer insert failed - wrong content type");
      }
    } else {
      console.error("✗ Buffer insert failed:", insertResult.left);
    }
  }

  // Test save
  await editor.saveFile();
  const savedContent = await filesystem.readFile("test.txt");
  console.log("Saved content:", savedContent);
  assertEquals(savedContent, "ABCX");

  // Cleanup
  Deno.removeSync("test.txt");
});
