#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Test the rendering pipeline
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Testing Rendering Pipeline ===");

try {
  const terminal = new TerminalIOImpl();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  
  // Check TTY status
  console.log("1. TTY Status Check...");
  console.log("   stdin.isTerminal:", Deno.stdin.isTerminal);
  console.log("   stdout.isTerminal:", Deno.stdout.isTerminal);
  
  // Create a test buffer
  console.log("2. Creating test buffer...");
  editor.createBuffer("test-render.txt", "Line 1: Hello\nLine 2: World\nLine 3: Test");
  
  const state = editor.getState();
  console.log("   Buffer created with", state.currentBuffer?.getLineCount(), "lines");
  
  console.log("3. Testing terminal operations...");
  console.log("   Terminal size:", terminal.getSize());
  
  // Test if we can write to terminal
  if (Deno.stdout.isTerminal) {
    console.log("4. Testing terminal write capabilities...");
    console.log("   Writing test output to terminal...");
    
    // Test basic terminal operations
    await terminal.clear();
    await terminal.moveCursor({ line: 0, column: 0 });
    await terminal.write("TEST OUTPUT: Buffer rendering test");
    
    // Wait briefly to see output
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log("   ✅ Terminal write test completed");
  } else {
    console.log("4. ⚠️ Not in terminal - cannot test rendering display");
  }
  
  console.log("5. Testing render method logic...");
  
  // Test what the render method would do
  const terminalSize = terminal.getSize();
  const maxViewportLines = terminalSize.height - 1;
  const totalLines = state.currentBuffer?.getLineCount() || 0;
  
  console.log(`   Terminal size: ${terminalSize.width}x${terminalSize.height}`);
  console.log(`   Max viewport lines: ${maxViewportLines}`);
  console.log(`   Total buffer lines: ${totalLines}`);
  console.log(`   Viewport top: ${state.viewportTop}`);
  console.log(`   Cursor: line ${state.cursorLine}, column ${state.cursorColumn}`);
  
  // Simulate what render would display
  console.log("6. Simulating render output...");
  for (let viewportRow = 0; viewportRow < Math.min(maxViewportLines, totalLines, 5); viewportRow++) {
    const bufferLine = state.viewportTop + viewportRow;
    if (bufferLine < totalLines) {
      const line = state.currentBuffer?.getLine(bufferLine) || "";
      console.log(`   Viewport row ${viewportRow} -> Buffer line ${bufferLine}: "${line}"`);
    }
  }
  
  console.log("\n✅ Render pipeline diagnostic completed!");
  
} catch (error) {
  console.error("❌ Error during render test:", error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error("Stack trace:", error.stack);
  }
}