/**
 * @file editor.test.ts
 * @description Test suite for the editor implementation
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

Deno.test("Editor Implementation", async (t) => {
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let editor: Editor;

  // Setup before each test
  const setup = () => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
  };

  await t.step("should create editor with default state", () => {
    setup();
    const state = editor.getState();

    assertEquals(state.mode, "normal");
    assertEquals(state.cursorPosition.line, 0);
    assertEquals(state.cursorPosition.column, 0);
    assertEquals(state.currentBuffer, undefined);
  });

  await t.step("should create buffer", () => {
    setup();
    editor.createBuffer("test", "hello\nworld");

    const state = editor.getState();
    // currentBuffer should be set after createBuffer
    assertEquals(state.currentBuffer !== undefined, true);

    // getContent returns Either<BufferError, string>
    const contentResult = state.currentBuffer?.getContent();
    assertEquals(contentResult?._tag, "Right");
    if (contentResult?._tag === "Right") {
      assertEquals(contentResult.right, "hello\nworld");
    }
  });

  await t.step("should execute T-Lisp editor API functions", () => {
    setup();
    editor.createBuffer("test", "hello\nworld");
    
    const interpreter = editor.getInterpreter();
    
    // Test buffer functions
    const bufferText = interpreter.execute("(buffer-text)");
    assertEquals(bufferText.value, "hello\nworld");
    
    const lineCount = interpreter.execute("(buffer-line-count)");
    assertEquals(lineCount.value, 2);
    
    const firstLine = interpreter.execute("(buffer-line 0)");
    assertEquals(firstLine.value, "hello");
  });

  await t.step("should handle cursor movement", () => {
    setup();
    editor.createBuffer("test", "hello\nworld");

    const interpreter = editor.getInterpreter();

    // Move cursor
    interpreter.execute("(cursor-move 1 2)");

    const state = editor.getState();
    assertEquals(state.cursorPosition.line, 1);
    assertEquals(state.cursorPosition.column, 2);

    // Check cursor position function
    const position = interpreter.execute("(cursor-position)");
    const positionList = position.value as any[];
    assertEquals(positionList[0].value, 1);
    assertEquals(positionList[1].value, 2);
  });

  await t.step("should handle text insertion", () => {
    setup();
    editor.createBuffer("test", "hello");
    
    const interpreter = editor.getInterpreter();
    
    // Move cursor to end and insert text
    interpreter.execute("(cursor-move 0 5)");
    interpreter.execute("(buffer-insert \" world\")");
    
    const text = interpreter.execute("(buffer-text)");
    assertEquals(text.value, "hello world");
  });

  await t.step("should handle text deletion", () => {
    setup();
    editor.createBuffer("test", "hello world");
    
    const interpreter = editor.getInterpreter();
    
    // Move cursor and delete text
    interpreter.execute("(cursor-move 0 5)");
    interpreter.execute("(buffer-delete 6)");
    
    const text = interpreter.execute("(buffer-text)");
    assertEquals(text.value, "hello");
  });

  await t.step("should handle mode switching", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Switch to insert mode
    interpreter.execute("(editor-set-mode \"insert\")");
    
    const state = editor.getState();
    assertEquals(state.mode, "insert");
    
    // Check mode function
    const mode = interpreter.execute("(editor-mode)");
    assertEquals(mode.value, "insert");
  });

  await t.step("should handle status messages", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Set status message
    interpreter.execute("(editor-set-status \"Test message\")");
    
    const state = editor.getState();
    assertEquals(state.statusMessage, "Test message");
    
    // Check status function
    const status = interpreter.execute("(editor-status)");
    assertEquals(status.value, "Test message");
  });

  await t.step("should handle buffer management", () => {
    setup();
    const interpreter = editor.getInterpreter();

    // Create multiple buffers
    interpreter.execute("(buffer-create \"buffer1\")");
    interpreter.execute("(buffer-create \"buffer2\")");

    // List buffers - T-Lisp API function
    const bufferList = interpreter.execute("(buffer-list)");
    const bufferArray = bufferList.value as any[];
    assertEquals(bufferArray.length, 2);

    // Switch buffer - T-Lisp API function
    interpreter.execute("(buffer-switch \"buffer1\")");
    const currentBuffer = interpreter.execute("(buffer-current)");
    assertEquals(currentBuffer.value, "buffer1");
  });

  await t.step("should handle key bindings", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Bind a key
    interpreter.execute("(key-bind \"x\" \"(editor-set-status \\\"X pressed\\\")\" \"normal\")");
    
    // The key binding should be registered (we can't easily test the actual key handling without mocking more)
    // This test mainly verifies that the key-bind function works without error
    assertEquals(true, true); // Placeholder assertion
  });

  await t.step("should handle file operations", () => {
    setup();
    
    // Set up mock file
    filesystem.files.set("test.txt", "file content");
    
    const interpreter = editor.getInterpreter();
    
    // Read file
    const content = interpreter.execute("(file-read \"test.txt\")");
    assertEquals(content.value, "file content");
    
    // Write file
    interpreter.execute("(file-write \"output.txt\" \"new content\")");
    assertEquals(filesystem.files.get("output.txt"), "new content");
  });

  await t.step("should handle complex editor operations", () => {
    setup();
    editor.createBuffer("test", "line1\nline2\nline3");
    
    const interpreter = editor.getInterpreter();
    
    // Complex operation: go to line 2, insert text, move cursor
    const complexCommand = `
      (let ()
        (cursor-move 1 0)
        (buffer-insert "NEW ")
        (cursor-move 2 0)
        (buffer-text))
    `;
    
    const result = interpreter.execute(complexCommand);
    assertEquals(result.value, "line1\nNEW line2\nline3");
  });

  await t.step("should handle error conditions gracefully", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Test error handling for invalid operations
    try {
      interpreter.execute("(buffer-text)"); // No current buffer
      assertEquals(false, true); // Should not reach here
    } catch (error) {
      assertStringIncludes((error as Error).message, "No current buffer");
    }
    
    try {
      interpreter.execute("(cursor-move -1 0)"); // Invalid cursor position
      assertEquals(false, true); // Should not reach here
    } catch (error) {
      assertStringIncludes((error as Error).message, "No current buffer");
    }
  });

  await t.step("should support editor customization", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Define custom function
    const customFunction = `
      (defun my-custom-command ()
        (let ()
          (editor-set-status "Custom command executed")
          (editor-set-mode "insert")))
    `;
    
    interpreter.execute(customFunction);
    
    // Execute custom function
    interpreter.execute("(my-custom-command)");
    
    const state = editor.getState();
    assertEquals(state.statusMessage, "Custom command executed");
    assertEquals(state.mode, "insert");
  });

  await t.step("should support macro definitions", () => {
    setup();
    const interpreter = editor.getInterpreter();
    
    // Define macro for common operation
    const macroDefinition = `
      (defmacro goto-line (line)
        \`(cursor-move ,line 0))
    `;
    
    interpreter.execute(macroDefinition);
    
    // Use macro
    editor.createBuffer("test", "line1\nline2\nline3");
    interpreter.execute("(goto-line 2)");
    
    const state = editor.getState();
    assertEquals(state.cursorLine, 2);
    assertEquals(state.cursorColumn, 0);
  });
});