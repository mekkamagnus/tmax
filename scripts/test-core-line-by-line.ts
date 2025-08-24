#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Test core bindings line by line to find the problematic line
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

const terminal = new TerminalIOImpl();
const filesystem = new FileSystemImpl();
const editor = new Editor(terminal, filesystem);

console.log("=== Testing Core Bindings Line by Line ===");

try {
  // Read the core bindings file
  const coreBindingsContent = await filesystem.readFile("src/tlisp/core-bindings.tlisp");
  const lines = coreBindingsContent.split('\n');
  
  console.log(`Total lines in core bindings: ${lines.length}`);
  
  const interpreter = editor.getInterpreter();
  
  let executedLines = 0;
  let keyBindingCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines and comments
    if (line === '' || line.startsWith(';')) {
      continue;
    }
    
    try {
      console.log(`Executing line ${i + 1}: ${line.substring(0, 60)}${line.length > 60 ? '...' : ''}`);
      
      const result = interpreter.execute(line);
      executedLines++;
      
      // Count key bindings
      if (line.includes('key-bind')) {
        keyBindingCount++;
        console.log(`  ✅ Key binding registered (${keyBindingCount} total)`);
      }
      
    } catch (error) {
      console.error(`❌ Error on line ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`   Line content: ${line}`);
      
      // Show current key mapping count
      const currentMappings = editor.getKeyMappings();
      console.log(`   Current key mappings: ${currentMappings.size}`);
      
      break; // Stop execution on first error
    }
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Lines executed: ${executedLines}`);
  console.log(`Key bindings processed: ${keyBindingCount}`);
  
  const finalMappings = editor.getKeyMappings();
  console.log(`Final key mappings registered: ${finalMappings.size}`);
  
  console.log(`\nRegistered keys:`);
  for (const [key, mappings] of finalMappings) {
    console.log(`  "${key}": ${mappings[0]?.mode || "any"} mode`);
  }
  
} catch (error) {
  console.error("❌ Error during line-by-line test:", error instanceof Error ? error.message : String(error));
}