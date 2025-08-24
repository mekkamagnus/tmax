#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Test insert mode character insertion
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Testing Insert Mode Character Insertion ===");

try {
  const terminal = new TerminalIOImpl();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  
  // Create a test buffer
  console.log("1. Creating test buffer...");
  editor.createBuffer("test-insert.txt", "Initial content\nSecond line");
  
  const state = editor.getState();
  const interpreter = editor.getInterpreter();
  
  console.log("2. Testing mode switching to insert...");
  console.log("   Initial mode:", state.mode);
  
  // Switch to insert mode
  interpreter.execute('(editor-set-mode "insert")');
  console.log("   Mode after setting to insert:", state.mode);
  
  console.log("3. Testing buffer-insert function directly...");
  console.log("   Buffer content before insert:", state.currentBuffer?.getCompleteContent());
  console.log("   Cursor position before:", { line: state.cursorLine, column: state.cursorColumn });
  
  // Test buffer-insert
  const insertResult = interpreter.execute('(buffer-insert "X")');
  console.log("   Insert result:", insertResult);
  console.log("   Buffer content after insert:", state.currentBuffer?.getCompleteContent());
  console.log("   Cursor position after:", { line: state.cursorLine, column: state.cursorColumn });
  
  console.log("4. Testing handleKey method for character input...");
  // Simulate what happens in insert mode when a key is pressed
  state.mode = "insert";
  const testChar = "Y";
  
  console.log(`   Simulating key press: "${testChar}"`);
  console.log("   Buffer before handleKey:", state.currentBuffer?.getCompleteContent());
  
  // This should call buffer-insert internally
  await editor.handleKey(testChar);
  
  console.log("   Buffer after handleKey:", state.currentBuffer?.getCompleteContent());
  console.log("   Final cursor position:", { line: state.cursorLine, column: state.cursorColumn });
  
  console.log("5. Testing buffer line extraction...");
  const lineCount = state.currentBuffer?.getLineCount() || 0;
  console.log(`   Total lines: ${lineCount}`);
  for (let i = 0; i < lineCount; i++) {
    const line = state.currentBuffer?.getLine(i);
    console.log(`   Line ${i}: "${line}"`);
  }
  
  console.log("\n✅ Insert mode diagnostic test completed!");
  
} catch (error) {
  console.error("❌ Error during insert mode test:", error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error("Stack trace:", error.stack);
  }
}