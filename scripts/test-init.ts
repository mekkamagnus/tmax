#!/usr/bin/env deno run --allow-read --allow-write --allow-run

/**
 * Test initialization without requiring a TTY
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

// Create a mock terminal for testing
class MockTerminal extends TerminalIOImpl {
  async enterRawMode(): Promise<void> {
    console.log("MockTerminal: Skipping raw mode for testing");
  }
  
  async exitRawMode(): Promise<void> {
    console.log("MockTerminal: Skipping exit raw mode for testing");
  }
  
  async readKey(): Promise<string> {
    // Return 'q' to quit immediately
    return "q";
  }
}

async function testInitialization() {
  console.log("=== Testing tmax initialization ===");
  
  const terminal = new MockTerminal();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  
  try {
    console.log("Creating editor...");
    
    // This will trigger loadCoreBindings
    console.log("Starting editor (will quit immediately)...");
    await editor.start();
    
    console.log("✅ Editor started and quit successfully");
    
  } catch (error) {
    console.error("❌ Error during initialization:", error instanceof Error ? error.message : String(error));
  }
}

if (import.meta.main) {
  await testInitialization();
}