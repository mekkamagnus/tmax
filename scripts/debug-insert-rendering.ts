#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Debug insert mode rendering step by step
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Debugging Insert Mode Rendering ===");

try {
  const terminal = new TerminalIOImpl();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  
  // Create buffer and load bindings
  editor.createBuffer("debug.txt", "initial");
  await editor.handleKey("h"); // Trigger binding load
  
  const state = editor.getState();
  console.log("1. Setup complete");
  console.log(`   Mode: ${state.mode}`);
  console.log(`   Buffer content: "${state.currentBuffer?.getCompleteContent()}"`);
  console.log(`   Cursor: line ${state.cursorLine}, column ${state.cursorColumn}`);
  
  // Test TTY status
  console.log("\n2. TTY Status:");
  console.log(`   stdin.isTerminal: ${Deno.stdin.isTerminal}`);
  console.log(`   stdout.isTerminal: ${Deno.stdout.isTerminal}`);
  
  // Enter insert mode
  console.log("\n3. Entering insert mode...");
  await editor.handleKey("i");
  console.log(`   Mode after 'i': ${state.mode}`);
  
  // Create a spy on terminal write operations
  const originalWrite = terminal.write;
  let writeOperations = [];
  
  terminal.write = async function(text: string): Promise<void> {
    writeOperations.push(`WRITE: "${text}"`);
    return await originalWrite.call(this, text);
  };
  
  // Test character insertion with full render cycle
  console.log("\n4. Testing character insertion with render tracing...");
  const testChar = "X";
  
  console.log(`   Before inserting "${testChar}":`);
  console.log(`     Buffer: "${state.currentBuffer?.getCompleteContent()}"`);
  console.log(`     Cursor: line ${state.cursorLine}, column ${state.cursorColumn}`);
  console.log(`     Mode: ${state.mode}`);
  
  // Clear write operations log
  writeOperations = [];
  
  // Simulate the exact sequence that happens in the main loop
  console.log(`   Simulating handleKey("${testChar}")...`);
  await editor.handleKey(testChar);
  
  console.log(`   After handleKey, before render:`);
  console.log(`     Buffer: "${state.currentBuffer?.getCompleteContent()}"`);
  console.log(`     Cursor: line ${state.cursorLine}, column ${state.cursorColumn}`);
  console.log(`     Mode: ${state.mode}`);
  
  // Now simulate render
  console.log(`   Simulating render(false)...`);
  await editor.render(false);
  
  console.log(`   After render:`);
  console.log(`     Buffer: "${state.currentBuffer?.getCompleteContent()}"`);
  console.log(`     Write operations during render: ${writeOperations.length}`);
  
  for (const op of writeOperations) {
    console.log(`       ${op}`);
  }
  
  // Test what the render method would show
  console.log("\n5. Testing render output manually...");
  const terminalSize = terminal.getSize();
  const totalLines = state.currentBuffer?.getLineCount() || 0;
  
  console.log(`   Terminal size: ${terminalSize.width}x${terminalSize.height}`);
  console.log(`   Buffer lines: ${totalLines}`);
  console.log(`   Viewport top: ${state.viewportTop}`);
  
  for (let i = 0; i < Math.min(totalLines, 3); i++) {
    const line = state.currentBuffer?.getLine(i) || "";
    console.log(`   Buffer line ${i}: "${line}"`);
  }
  
  // Test multiple rapid insertions
  console.log("\n6. Testing rapid character insertion...");
  const rapidText = "HELLO";
  
  for (let i = 0; i < rapidText.length; i++) {
    const char = rapidText[i];
    writeOperations = [];
    
    await editor.handleKey(char);
    await editor.render(false);
    
    console.log(`   After "${char}": buffer="${state.currentBuffer?.getCompleteContent()}", writes=${writeOperations.length}`);
  }
  
  console.log("\n✅ Insert mode rendering debug completed!");
  
} catch (error) {
  console.error("❌ Insert mode rendering debug failed:", error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error("Stack trace:", error.stack);
  }
}