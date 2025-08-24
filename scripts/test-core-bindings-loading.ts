#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Test core bindings loading process
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Testing Core Bindings Loading ===");

try {
  const terminal = new TerminalIOImpl();
  const filesystem = new FileSystemImpl();
  
  // Test file system paths
  console.log("1. Testing core bindings file existence...");
  const possiblePaths = [
    "src/tlisp/core-bindings.tlisp",
    "./src/tlisp/core-bindings.tlisp",
  ];
  
  for (const path of possiblePaths) {
    try {
      const content = await filesystem.readFile(path);
      console.log(`   ✅ Found at ${path} (${content.length} characters)`);
      console.log(`   First 100 chars: ${content.substring(0, 100)}...`);
    } catch (error) {
      console.log(`   ❌ Not found at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  console.log("\n2. Creating editor instance...");
  const editor = new Editor(terminal, filesystem);
  
  console.log("   Status message after creation:", editor.getState().statusMessage);
  
  console.log("\n3. Creating buffer to trigger initialization...");
  editor.createBuffer("test.txt", "test content");
  
  console.log("   Status message after buffer creation:", editor.getState().statusMessage);
  
  console.log("\n4. Checking key mappings after initialization...");
  const keyMappings = editor.getKeyMappings();
  console.log(`   Key mappings count: ${keyMappings.size}`);
  
  if (keyMappings.size === 0) {
    console.log("   ❌ No key mappings loaded - core bindings failed to load");
  } else {
    console.log("   ✅ Key mappings loaded successfully");
    
    // Check for essential keys
    const essentialKeys = [":", "h", "j", "k", "l", "i"];
    for (const key of essentialKeys) {
      const mappings = keyMappings.get(key);
      if (mappings) {
        console.log(`     "${key}": ${mappings.length} mapping(s)`);
      } else {
        console.log(`     "${key}": missing`);
      }
    }
  }
  
  console.log("\n5. Testing manual core bindings load...");
  try {
    const coreBindingsPath = "src/tlisp/core-bindings.tlisp";
    const content = await filesystem.readFile(coreBindingsPath);
    console.log(`   Content loaded: ${content.length} characters`);
    
    const interpreter = editor.getInterpreter();
    interpreter.execute(content);
    console.log("   ✅ Manual execution successful");
    
    const newMappingsCount = editor.getKeyMappings().size;
    console.log(`   Key mappings after manual load: ${newMappingsCount}`);
    
  } catch (error) {
    console.log(`   ❌ Manual load failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  console.log("\n✅ Core bindings loading test completed!");
  
} catch (error) {
  console.error("❌ Core bindings loading test failed:", error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error("Stack trace:", error.stack);
  }
}