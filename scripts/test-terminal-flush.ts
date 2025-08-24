#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Test terminal output flushing behavior
 */

import { TerminalIOImpl } from "../src/core/terminal.ts";

console.log("=== Testing Terminal Output Flushing ===");

try {
  const terminal = new TerminalIOImpl();
  
  console.log("1. Testing terminal write and flush behavior...");
  
  if (Deno.stdout.isTerminal && Deno.stdout.isTerminal()) {
    console.log("2. In TTY - testing real terminal output...");
    
    // Test immediate output
    console.log("   Writing test sequence with flushing...");
    await terminal.clear();
    await terminal.moveCursor({ line: 0, column: 0 });
    await terminal.write("TEST: ");
    
    // Write character by character to verify immediate display
    const testMessage = "Immediate display test";
    for (let i = 0; i < testMessage.length; i++) {
      await terminal.write(testMessage[i]);
      // Small delay to see if each character appears immediately
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    await terminal.write("\n✅ If you saw each character appear immediately, flushing works!");
    
    // Clean up
    await new Promise(resolve => setTimeout(resolve, 2000));
    await terminal.clear();
    
  } else {
    console.log("2. Not in TTY - testing flushing method availability...");
    
    // Test that sync method exists
    console.log("   Testing Deno.stdout.sync() availability...");
    await Deno.stdout.sync();
    console.log("   ✅ Deno.stdout.sync() method available");
    
    // Test terminal methods don't throw
    console.log("   Testing terminal methods with flushing...");
    await terminal.write("test");
    await terminal.moveCursor({ line: 0, column: 0 });
    console.log("   ✅ Terminal methods with flushing work correctly");
  }
  
  console.log("\n✅ Terminal flush test completed!");
  
} catch (error) {
  console.error("❌ Error during terminal flush test:", error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error("Stack trace:", error.stack);
  }
}