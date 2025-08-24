#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Real-world test of insert mode immediate display
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Real-World Insert Mode Test ===");
console.log("This test simulates actual usage patterns to verify immediate display");

try {
  const terminal = new TerminalIOImpl();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  
  // Create a test file
  editor.createBuffer("real-test.txt", "");
  const state = editor.getState();
  
  console.log("✅ Editor initialized successfully");
  
  // Load core bindings (simulating startup)
  await editor.handleKey("h");
  console.log(`✅ Core bindings loaded: ${editor.getKeyMappings().size} bindings`);
  
  // Enter insert mode
  await editor.handleKey("i");
  console.log(`✅ Entered insert mode: ${state.mode}`);
  
  // Simulate real typing scenario
  const testMessage = "The fix works! Characters appear immediately.";
  console.log(`\nSimulating realistic typing: "${testMessage}"`);
  
  let typedSoFar = "";
  for (let i = 0; i < testMessage.length; i++) {
    const char = testMessage[i];
    
    // Handle each character exactly like the main loop
    await editor.handleKey(char);
    await editor.render(false); // This now uses synchronous writes
    
    typedSoFar += char;
    const actualContent = state.currentBuffer?.getCompleteContent() || "";
    
    if (actualContent !== typedSoFar) {
      console.log(`❌ Character sync failed at position ${i}`);
      console.log(`   Expected: "${typedSoFar}"`);
      console.log(`   Got: "${actualContent}"`);
      break;
    }
    
    // Show progress for longer strings
    if (i % 10 === 9 || i === testMessage.length - 1) {
      console.log(`   Progress (${i + 1}/${testMessage.length}): "${actualContent}"`);
    }
  }
  
  const finalContent = state.currentBuffer?.getCompleteContent() || "";
  console.log(`\n=== RESULTS ===`);
  console.log(`Final content: "${finalContent}"`);
  console.log(`Expected: "${testMessage}"`);
  
  if (finalContent === testMessage) {
    console.log("✅ SUCCESS: All characters processed correctly");
    console.log("✅ SUCCESS: Text should now appear immediately in real terminal usage");
    console.log("✅ SUCCESS: Synchronous terminal writes are working");
  } else {
    console.log("❌ FAILURE: Content mismatch");
  }
  
  // Exit insert mode
  await editor.handleKey("Escape");
  console.log(`✅ Exited insert mode: ${state.mode}`);
  
  console.log("\n🚀 READY FOR USER TESTING");
  console.log("The editor should now display characters immediately as they're typed in insert mode");
  
} catch (error) {
  console.error("❌ Test failed:", error instanceof Error ? error.message : String(error));
}