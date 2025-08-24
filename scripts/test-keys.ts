#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Simple key testing script to verify terminal key input works
 */

import { TerminalIOImpl } from "../src/core/terminal.ts";

async function testKeys() {
  const terminal = new TerminalIOImpl();
  
  console.log("Testing terminal key input...");
  console.log("This test verifies that keys can be read properly.");
  console.log("Run this script in a real terminal to test key functionality.");
  console.log();
  
  // Check if we're in a TTY
  if (!Deno.stdin.isTerminal || !Deno.stdin.isTerminal()) {
    console.error("❌ Error: Not running in a TTY. Please run in a real terminal.");
    Deno.exit(1);
  }
  
  console.log("✅ TTY detected. Starting key test...");
  console.log("Press any key (ESC, 'q', or Ctrl+C to exit):");
  
  try {
    await terminal.enterRawMode();
    
    while (true) {
      const key = await terminal.readKey();
      const keyCode = key.charCodeAt(0);
      
      if (key === "\x1b") { // ESC key
        console.log("ESC pressed. Exiting...");
        break;
      } else if (key === "q") { // 'q' key
        console.log("'q' pressed. Exiting...");
        break;
      } else if (key === "\x03") { // Ctrl+C
        console.log("Ctrl+C pressed. Exiting...");
        break;
      }
      
      console.log(`Key: "${key}" (char code: ${keyCode})`);
    }
    
    await terminal.exitRawMode();
    console.log("✅ Key test completed successfully!");
    
  } catch (error) {
    await terminal.exitRawMode();
    console.error("❌ Error during key test:", error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await testKeys();
}