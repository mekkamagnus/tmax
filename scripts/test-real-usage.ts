#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Test the exact user workflow
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Testing Real User Workflow ===");

const terminal = new TerminalIOImpl();
const filesystem = new FileSystemImpl();
const editor = new Editor(terminal, filesystem);

// Start like the real app does (but don't call run())
console.log("1. Creating buffer (simulating file opening)...");
editor.createBuffer("*scratch*", "");

const state = editor.getState();

// Ensure bindings are loaded
await editor.handleKey("h");
console.log(`   Bindings loaded: ${editor.getKeyMappings().size}`);
console.log(`   Status: ${state.statusMessage}`);

// Test the exact sequence from user output
console.log("\n2. Testing insert mode and typing...");
await editor.handleKey("i"); // Enter insert mode
console.log(`   Mode after 'i': ${state.mode}`);

await editor.handleKey("a");
await editor.handleKey("s");
await editor.handleKey("d");
const content = state.currentBuffer?.getCompleteContent() || "";
console.log(`   Buffer content after typing 'asd': "${content}"`);

console.log("\n3. Testing escape to normal mode...");
await editor.handleKey("Escape");
console.log(`   Mode after Escape: ${state.mode}`);

console.log("\n4. Testing command mode entry...");
await editor.handleKey(":");
console.log(`   Mode after ':': ${state.mode}`);

console.log("\n5. Testing :wq command...");
await editor.handleKey("w");
await editor.handleKey("q");
console.log(`   Command line: "${state.commandLine}"`);

console.log("\n6. Testing command execution...");
console.log(`   Operations available: ${!!state.operations}`);
console.log(`   saveFile available: ${!!state.operations?.saveFile}`);

try {
  await editor.handleKey("Enter");
  console.log(`   ✅ Command executed successfully`);
  console.log(`   Status: ${state.statusMessage}`);
  console.log(`   Mode: ${state.mode}`);
} catch (error) {
  if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
    console.log(`   ✅ Got expected quit signal from :wq`);
  } else {
    console.log(`   ❌ Unexpected error: ${error}`);
  }
}

console.log("\n7. Testing :q command...");
state.mode = "command";
state.commandLine = "q";

try {
  const result = editor.getInterpreter().execute('(editor-execute-command-line)');
  console.log(`   :q result: ${result}`);
} catch (error) {
  if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
    console.log(`   ✅ :q correctly triggered quit signal`);
  } else {
    console.log(`   ❌ :q error: ${error}`);
  }
}