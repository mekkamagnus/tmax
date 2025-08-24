#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Debug key mapping system
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Debugging Key Mapping System ===");

try {
  const terminal = new TerminalIOImpl();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  
  editor.createBuffer("test.txt", "test content");
  
  console.log("1. Getting all key mappings...");
  const keyMappings = editor.getKeyMappings();
  
  console.log("   Total keys in mapping:", keyMappings.size);
  console.log("   Available keys:");
  
  for (const [key, mappings] of keyMappings) {
    console.log(`     "${key}": ${mappings.length} mapping(s)`);
    for (const mapping of mappings) {
      console.log(`       - Mode: ${mapping.mode || "any"}, Command: ${mapping.command.substring(0, 50)}...`);
    }
  }
  
  console.log("\n2. Checking specific problematic keys...");
  const testKeys = [":", "h", "j", "k", "l", "i", "Escape", "Enter"];
  
  for (const testKey of testKeys) {
    const mappings = keyMappings.get(testKey);
    if (mappings) {
      console.log(`   ✅ Key "${testKey}": ${mappings.length} mapping(s)`);
    } else {
      console.log(`   ❌ Key "${testKey}": NO MAPPINGS`);
    }
  }
  
  console.log("\n3. Testing key normalization...");
  const normalizeKey = (key: string): string => {
    // This is the same logic from the Editor class
    const keyMappings: { [key: string]: string } = {
      "\x1b": "Escape",
      "\r": "Enter",
      "\n": "Enter", 
      "\x7f": "Backspace",
      "\b": "Backspace"
    };
    return keyMappings[key] || key;
  };
  
  const testKeysRaw = [":", "h", "\x1b", "\r"];
  for (const rawKey of testKeysRaw) {
    const normalized = normalizeKey(rawKey);
    console.log(`   Raw key: ${JSON.stringify(rawKey)} -> Normalized: "${normalized}"`);
  }
  
  console.log("\n4. Testing core bindings loading...");
  const interpreter = editor.getInterpreter();
  
  // Check if key-bind function exists
  try {
    const result = interpreter.execute('(key-bind "test-key" "(editor-quit)" "normal")');
    console.log("   ✅ key-bind function works:", result);
    
    // Check if the test key was added
    const testMappings = keyMappings.get("test-key");
    if (testMappings) {
      console.log("   ✅ Test key mapping added successfully");
    } else {
      console.log("   ❌ Test key mapping not found after key-bind");
    }
  } catch (error) {
    console.log("   ❌ key-bind function error:", error instanceof Error ? error.message : String(error));
  }
  
  console.log("\n✅ Key mapping debug completed!");
  
} catch (error) {
  console.error("❌ Key mapping debug failed:", error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error("Stack trace:", error.stack);
  }
}