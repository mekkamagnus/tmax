#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Simple debug of bindings loading
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Simple Binding Debug ===");

const terminal = new TerminalIOImpl();
const filesystem = new FileSystemImpl();
const editor = new Editor(terminal, filesystem);

// Read core bindings and count expected
const coreContent = await filesystem.readFile("src/tlisp/core-bindings.tlisp");
const expectedBindings = (coreContent.match(/\(key-bind /g) || []).length;
console.log(`Expected bindings: ${expectedBindings}`);

// Load bindings
await editor.handleKey("h"); // Triggers lazy loading
console.log(`Actual bindings loaded: ${editor.getKeyMappings().size}`);

console.log("\nMissing bindings analysis:");
// Extract expected keys from file
const keyBindLines = coreContent.split('\n').filter(line => line.includes('(key-bind'));
const expectedKeys = new Set();

for (const line of keyBindLines) {
  const match = line.match(/\(key-bind\s+"([^"]+)"/);
  if (match) {
    expectedKeys.add(match[1]);
  }
}

console.log(`Unique keys expected: ${expectedKeys.size}`);
console.log(`Expected keys: ${Array.from(expectedKeys).join(', ')}`);

const actualKeys = Array.from(editor.getKeyMappings().keys());
console.log(`Actual keys: ${actualKeys.join(', ')}`);

// Find missing
const missing = Array.from(expectedKeys).filter(key => !actualKeys.includes(key));
const extra = actualKeys.filter(key => !expectedKeys.has(key));

if (missing.length > 0) {
  console.log(`❌ Missing keys: ${missing.join(', ')}`);
}
if (extra.length > 0) {
  console.log(`⚠️ Extra keys: ${extra.join(', ')}`);
}

// Check specific problematic keys from user's output
const problematicKeys = ['a', 's', 'd', 'f', 'w']; // Keys showing "Unbound" in user output
console.log("\nProblematic keys from user output:");
for (const key of problematicKeys) {
  const mappings = editor.getKeyMappings().get(key);
  if (mappings && mappings.length > 0) {
    console.log(`   ${key}: BOUND (unexpected)`);
  } else {
    console.log(`   ${key}: unbound (expected - not in vim basic set)`);
  }
}