#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Debug binding parsing and loading
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Debugging Binding Parsing ===");

const terminal = new TerminalIOImpl();
const filesystem = new FileSystemImpl();

// Read the core bindings file directly
const coreContent = await filesystem.readFile("src/tlisp/core-bindings.tlisp");
console.log(`Core bindings file: ${coreContent.length} characters`);

// Count expected bindings
const expectedBindings = (coreContent.match(/\(key-bind /g) || []).length;
console.log(`Expected bindings from file: ${expectedBindings}`);

// Create editor and spy on key-bind function calls
const editor = new Editor(terminal, filesystem);
const interpreter = editor.getInterpreter();

// Spy on key-bind calls
let keyBindCalls = 0;
let keyBindErrors = [];

const originalKeyBind = interpreter.getEnvironment().get("key-bind");
if (originalKeyBind) {
  interpreter.getEnvironment().set("key-bind", (...args) => {
    keyBindCalls++;
    try {
      return originalKeyBind(...args);
    } catch (error) {
      keyBindErrors.push(`Key-bind #${keyBindCalls}: ${error}`);
      throw error;
    }
  });
}

console.log("\n1. Executing core bindings manually...");
try {
  interpreter.execute(coreContent);
  console.log(`   ✅ Execution completed`);
  console.log(`   Key-bind calls made: ${keyBindCalls}`);
  console.log(`   Key-bind errors: ${keyBindErrors.length}`);
  
  if (keyBindErrors.length > 0) {
    console.log("   Errors:");
    for (const error of keyBindErrors) {
      console.log(`     ${error}`);
    }
  }
  
} catch (error) {
  console.log(`   ❌ Execution failed: ${error}`);
}

console.log(`   Final key mappings: ${editor.getKeyMappings().size}`);

console.log("\n2. Checking individual bindings...");
const keyMappings = editor.getKeyMappings();
const expectedKeys = ["h", "j", "k", "l", "i", ":", "Escape", "Enter", "q", " ", ";", "Backspace"];

for (const key of expectedKeys) {
  const mappings = keyMappings.get(key);
  if (mappings && mappings.length > 0) {
    console.log(`   ✅ ${key}: ${mappings.length} mapping(s)`);
    for (const mapping of mappings) {
      const mode = mapping.mode || "any";
      const cmd = mapping.command.substring(0, 30) + (mapping.command.length > 30 ? "..." : "");
      console.log(`      - ${mode}: ${cmd}`);
    }
  } else {
    console.log(`   ❌ ${key}: NOT FOUND`);
  }
}