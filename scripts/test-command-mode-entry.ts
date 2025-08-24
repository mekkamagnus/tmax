#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Specific test for command mode entry
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Testing Command Mode Entry ===");

try {
  const terminal = new TerminalIOImpl();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  
  editor.createBuffer("test.txt", "test content");
  
  const state = editor.getState();
  const interpreter = editor.getInterpreter();
  
  console.log("1. Initial state:");
  console.log("   Mode:", state.mode);
  console.log("   Command line:", JSON.stringify(state.commandLine));
  
  console.log("\n2. Testing editor-enter-command-mode function directly:");
  try {
    const result = interpreter.execute('(editor-enter-command-mode)');
    console.log("   Function result:", result);
    console.log("   Mode after direct call:", state.mode);
    console.log("   Command line after direct call:", JSON.stringify(state.commandLine));
  } catch (error) {
    console.log("   Direct call error:", error instanceof Error ? error.message : String(error));
  }
  
  // Reset to normal mode
  state.mode = "normal";
  state.commandLine = "";
  
  console.log("\n3. Testing key mapping for ':':");
  const keyMappings = editor.getKeyMappings();
  const colonMappings = keyMappings.get(":");
  
  if (colonMappings && colonMappings.length > 0) {
    const mapping = colonMappings.find(m => !m.mode || m.mode === "normal");
    if (mapping) {
      console.log("   Found mapping:", mapping);
      console.log("   Command:", mapping.command);
      
      console.log("\n4. Testing key mapping execution:");
      try {
        const result = interpreter.execute(mapping.command);
        console.log("   Mapping execution result:", result);
        console.log("   Mode after mapping execution:", state.mode);
        console.log("   Command line after mapping execution:", JSON.stringify(state.commandLine));
      } catch (error) {
        console.log("   Mapping execution error:", error instanceof Error ? error.message : String(error));
      }
    } else {
      console.log("   No normal mode mapping found for ':'");
    }
  } else {
    console.log("   No mappings found for ':'");
  }
  
  // Reset to normal mode
  state.mode = "normal";
  state.commandLine = "";
  
  console.log("\n5. Testing handleKey method with ':':");
  try {
    console.log("   Mode before handleKey:", state.mode);
    await editor.handleKey(":");
    console.log("   Mode after handleKey:", state.mode);
    console.log("   Command line after handleKey:", JSON.stringify(state.commandLine));
    console.log("   Status message:", state.statusMessage);
  } catch (error) {
    console.log("   HandleKey error:", error instanceof Error ? error.message : String(error));
  }
  
  console.log("\n✅ Command mode entry test completed!");
  
} catch (error) {
  console.error("❌ Command mode entry test failed:", error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error("Stack trace:", error.stack);
  }
}