#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Debug difference between full file execution vs line-by-line
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

const terminal = new TerminalIOImpl();
const filesystem = new FileSystemImpl();
const editor1 = new Editor(terminal, filesystem);
const editor2 = new Editor(terminal, filesystem);

console.log("=== Debugging Full File vs Line-by-Line Execution ===");

try {
  const coreBindingsContent = await filesystem.readFile("src/tlisp/core-bindings.tlisp");
  
  console.log("1. Testing FULL FILE execution:");
  try {
    const interpreter1 = editor1.getInterpreter();
    interpreter1.execute(coreBindingsContent);
    const mappings1 = editor1.getKeyMappings();
    console.log(`   Result: ${mappings1.size} key mappings registered`);
  } catch (error) {
    console.log(`   ❌ Error in full file execution: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  console.log("\n2. Testing LINE-BY-LINE execution:");
  const lines = coreBindingsContent.split('\n');
  const interpreter2 = editor2.getInterpreter();
  
  let successCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith(';')) continue;
    
    try {
      interpreter2.execute(trimmed);
      if (trimmed.includes('key-bind')) {
        successCount++;
      }
    } catch (error) {
      console.log(`   ❌ Error on line: ${trimmed}`);
      console.log(`      Error: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
  }
  
  const mappings2 = editor2.getKeyMappings();
  console.log(`   Result: ${mappings2.size} key mappings registered, ${successCount} key-bind statements executed`);
  
  console.log("\n3. Comparison:");
  console.log(`   Full file: ${editor1.getKeyMappings().size} mappings`);
  console.log(`   Line-by-line: ${editor2.getKeyMappings().size} mappings`);
  
  if (editor1.getKeyMappings().size !== editor2.getKeyMappings().size) {
    console.log("   ❌ MISMATCH DETECTED! Full file execution is failing.");
    console.log("\n4. Testing chunks of the file:");
    
    // Try executing in smaller chunks
    const chunks = [];
    let currentChunk = "";
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith(';')) continue;
      
      currentChunk += line + '\n';
      
      // If we hit a key-bind, try executing this chunk
      if (trimmed.includes('key-bind')) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
    }
    
    console.log(`   Testing ${chunks.length} chunks...`);
    const editor3 = new Editor(terminal, filesystem);
    const interpreter3 = editor3.getInterpreter();
    
    for (let i = 0; i < chunks.length; i++) {
      try {
        interpreter3.execute(chunks[i]);
        console.log(`   Chunk ${i + 1}: ✅`);
      } catch (error) {
        console.log(`   Chunk ${i + 1}: ❌ ${error instanceof Error ? error.message : String(error)}`);
        console.log(`   Chunk content: ${chunks[i].trim().substring(0, 100)}...`);
        break;
      }
    }
    
    const mappings3 = editor3.getKeyMappings();
    console.log(`   Chunk execution result: ${mappings3.size} key mappings`);
  } else {
    console.log("   ✅ Both methods work identically");
  }
  
} catch (error) {
  console.error("❌ Error during debug test:", error instanceof Error ? error.message : String(error));
}