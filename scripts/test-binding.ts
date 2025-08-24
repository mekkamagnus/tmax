#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Test key binding registration specifically
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

// Create a test editor
const terminal = new TerminalIOImpl();
const filesystem = new FileSystemImpl();
const editor = new Editor(terminal, filesystem);

console.log("=== Testing Key Binding Registration ===");

try {
  console.log("0. Loading core bindings first...");
  
  // Load core bindings like the editor does
  const coreBindingsContent = await filesystem.readFile("src/tlisp/core-bindings.tlisp");
  console.log("Core bindings file length:", coreBindingsContent.length, "characters");
  
  // Get the T-Lisp interpreter
  const interpreter = editor.getInterpreter();
  
  // Execute the core bindings
  try {
    interpreter.execute(coreBindingsContent);
    console.log("✅ Core bindings executed");
  } catch (error) {
    console.error("❌ Error executing core bindings:", error instanceof Error ? error.message : String(error));
    throw error;
  }
  
  console.log("1. Testing basic key-bind function...");
  
  // Try to execute a simple key-bind command
  const result = interpreter.execute('(key-bind "test" "(editor-quit)" "normal")');
  console.log("key-bind result:", result);
  
  console.log("2. Checking if key mappings were registered...");
  
  // Get the actual key mappings
  const keyMappings = editor.getKeyMappings();
  console.log("Total key mappings registered:", keyMappings.size);
  
  // List all registered keys
  for (const [key, mappings] of keyMappings) {
    console.log(`  Key "${key}": ${mappings.length} mapping(s)`);
    for (const mapping of mappings) {
      console.log(`    - Mode: ${mapping.mode || "any"}, Command: ${mapping.command}`);
    }
  }
  
  // Try to access keyMappings - this is private, so let's test through other means
  console.log("3. Testing key handling directly...");
  
  // We can't access private keyMappings directly, so let's test if the key works
  try {
    await editor.handleKey("q");
    console.log("✅ 'q' key handled successfully");
  } catch (error) {
    console.log("❌ 'q' key handling failed:", error instanceof Error ? error.message : String(error));
  }
  
  console.log("4. Testing individual key bindings from core file...");
  
  // Test some specific key bindings from the core file
  const testBindings = [
    '(key-bind "j" "(cursor-move (+ (cursor-line) 1) (cursor-column))" "normal")',
    '(key-bind "k" "(cursor-move (- (cursor-line) 1) (cursor-column))" "normal")',
    '(key-bind "l" "(cursor-move (cursor-line) (+ (cursor-column) 1))" "normal")',
    '(key-bind "q" "(editor-quit)" "normal")'
  ];
  
  for (const binding of testBindings) {
    try {
      const bindResult = interpreter.execute(binding);
      console.log(`✅ Executed: ${binding.substring(0, 40)}...`);
      console.log(`   Result:`, bindResult);
    } catch (error) {
      console.log(`❌ Failed: ${binding.substring(0, 40)}...`);
      console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  console.log("5. Final key mapping count:");
  const finalKeyMappings = editor.getKeyMappings();
  console.log("Total keys now registered:", finalKeyMappings.size);
  for (const [key, mappings] of finalKeyMappings) {
    console.log(`  "${key}": ${mappings.length} mapping(s)`);
  }
  
  console.log("✅ Key binding tests completed");
  
} catch (error) {
  console.error("❌ Error during key binding test:", error instanceof Error ? error.message : String(error));
}