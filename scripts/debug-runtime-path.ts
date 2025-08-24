#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Debug the exact path resolution used by running tmax
 */

import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Debugging Core Bindings Path Resolution ===");

const filesystem = new FileSystemImpl();

// These are the exact paths from the editor code
const possiblePaths = [
  "src/tlisp/core-bindings.tlisp", 
  "./src/tlisp/core-bindings.tlisp",
];

console.log("1. Current working directory:", Deno.cwd());

console.log("2. Testing each possible path...");
for (const path of possiblePaths) {
  try {
    const content = await filesystem.readFile(path);
    console.log(`   ✅ SUCCESS: ${path}`);
    console.log(`      Content length: ${content.length} characters`);
    console.log(`      First 100 chars: ${content.substring(0, 100)}...`);
    
    // Check if this contains the expected bindings
    if (content.includes('editor-execute-command-line')) {
      console.log(`      ✅ Contains command execution binding`);
    } else {
      console.log(`      ❌ Missing command execution binding`);
    }
    
    if (content.includes('key-bind ":') || content.includes("key-bind ':")) {
      console.log(`      ✅ Contains colon key binding`);
    } else {
      console.log(`      ❌ Missing colon key binding`);
    }
    
  } catch (error) {
    console.log(`   ❌ FAILED: ${path}`);
    console.log(`      Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\n3. Testing filesystem readFile method directly...");
try {
  const testContent = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
  console.log(`   ✅ Deno.readTextFile works, length: ${testContent.length}`);
} catch (error) {
  console.log(`   ❌ Deno.readTextFile failed: ${error}`);
}

console.log("\n4. Checking file existence with different approaches...");
try {
  const stat = await Deno.stat("src/tlisp/core-bindings.tlisp");
  console.log(`   ✅ File exists, size: ${stat.size} bytes`);
} catch (error) {
  console.log(`   ❌ File not found: ${error}`);
}

console.log("\n5. Listing directory contents...");
try {
  const entries = [];
  for await (const entry of Deno.readDir("src/tlisp")) {
    entries.push(`${entry.name} (${entry.isFile ? 'file' : 'dir'})`);
  }
  console.log(`   Contents of src/tlisp/: ${entries.join(', ')}`);
} catch (error) {
  console.log(`   ❌ Cannot read directory: ${error}`);
}