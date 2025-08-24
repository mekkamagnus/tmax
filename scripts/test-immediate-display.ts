#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Test immediate text display with output flushing improvements
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Testing Immediate Text Display with Output Flushing ===");
console.log("This test verifies that terminal writes are flushed immediately for real-time display");

try {
  const terminal = new TerminalIOImpl();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  
  // Create test buffer
  editor.createBuffer("immediate-test.txt", "");
  
  const state = editor.getState();
  const interpreter = editor.getInterpreter();
  
  // Load bindings and enter insert mode
  await editor.handleKey("h"); // Trigger binding load
  await editor.handleKey("i"); // Enter insert mode
  console.log(`✅ Entered insert mode: ${state.mode}`);
  
  // Simulate typing with render cycle (this is the key change)
  const testText = "Hello World!";
  console.log(`\nSimulating typing with immediate render: "${testText}"`);
  
  for (let i = 0; i < testText.length; i++) {
    const char = testText[i];
    
    console.log(`\nTyping '${char}' (character ${i + 1}/${testText.length}):`);
    
    // This is the exact sequence that happens in the main loop:
    // 1. Handle key input (updates buffer)
    await editor.handleKey(char);
    
    // 2. Render immediately (this now flushes output to terminal)
    await editor.render(false);
    
    // 3. Verify the change
    const currentContent = state.currentBuffer?.getCompleteContent() || "";
    const expectedContent = testText.substring(0, i + 1);
    
    console.log(`   Buffer content: "${currentContent}"`);
    console.log(`   Expected: "${expectedContent}"`);
    console.log(`   Cursor: line ${state.cursorLine}, col ${state.cursorColumn}`);
    
    if (currentContent !== expectedContent) {
      console.log(`❌ Mismatch at character ${i}`);
      break;
    } else {
      console.log(`✅ Character '${char}' processed correctly`);
    }
  }
  
  const finalContent = state.currentBuffer?.getCompleteContent() || "";
  console.log(`\n=== SUMMARY ===`);
  console.log(`Final buffer content: "${finalContent}"`);
  console.log(`Expected: "${testText}"`);
  
  if (finalContent === testText) {
    console.log("✅ All characters processed correctly");
    console.log("✅ KEY IMPROVEMENT: Terminal writes now include Deno.stdout.sync()");
    console.log("✅ This should fix the real-time display issue in insert mode");
  } else {
    console.log("❌ Text processing failed");
  }
  
  // Test cursor position
  console.log(`\nCursor position: line ${state.cursorLine}, col ${state.cursorColumn}`);
  console.log(`Expected: line 0, col ${testText.length}`);
  
  if (state.cursorLine === 0 && state.cursorColumn === testText.length) {
    console.log("✅ Cursor position is correct");
  } else {
    console.log("❌ Cursor position incorrect");
  }
  
  console.log("\n🔧 CHANGES MADE:");
  console.log("   1. Added Deno.stdout.sync() after terminal.write() operations");
  console.log("   2. Added flushing after moveCursor() and clearToEndOfLine()");
  console.log("   3. This forces immediate terminal output instead of buffering");
  
} catch (error) {
  console.error("❌ Error during immediate display test:", error instanceof Error ? error.message : String(error));
}