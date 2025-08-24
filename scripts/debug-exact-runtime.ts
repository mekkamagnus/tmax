#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Debug the exact runtime conditions
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Debugging Exact Runtime Conditions ===");

// Create editor exactly like the main.ts does
const terminal = new TerminalIOImpl();
const filesystem = new FileSystemImpl();

console.log("1. Working directory:", Deno.cwd());

console.log("2. Testing filesystem implementation directly...");
try {
  const content = await filesystem.readFile("src/tlisp/core-bindings.tlisp");
  console.log(`   ✅ Filesystem reads file: ${content.length} characters`);
} catch (error) {
  console.log(`   ❌ Filesystem read error: ${error}`);
}

console.log("3. Creating editor and monitoring status messages...");
const editor = new Editor(terminal, filesystem);

console.log("4. Calling handleKey to trigger binding loading...");
const state = editor.getState();
console.log(`   Status before: "${state.statusMessage}"`);

// Spy on the interpreter to see what gets executed
const originalExecute = editor.getInterpreter().execute;
let executedCommands = [];

editor.getInterpreter().execute = function(command: string) {
  executedCommands.push(command.substring(0, 100) + (command.length > 100 ? "..." : ""));
  return originalExecute.call(this, command);
};

await editor.handleKey("h");

console.log(`   Status after: "${state.statusMessage}"`);
console.log(`   Key mappings loaded: ${editor.getKeyMappings().size}`);

console.log("5. Commands executed during binding load:");
for (const cmd of executedCommands) {
  console.log(`   - ${cmd}`);
}

// Test a specific problematic command
console.log("6. Testing command mode entry...");
state.mode = "normal";
await editor.handleKey(":");
console.log(`   Mode after ':': ${state.mode}`);
console.log(`   Status: ${state.statusMessage}`);

// Test command execution
console.log("7. Testing command execution...");
if (state.mode === "command") {
  await editor.handleKey("q");
  console.log(`   Command line after 'q': "${state.commandLine}"`);
  
  try {
    await editor.handleKey("Enter");
    console.log(`   Command executed successfully`);
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
      console.log(`   ✅ Got expected quit signal`);
    } else {
      console.log(`   ❌ Unexpected error: ${error}`);
    }
  }
} else {
  console.log("   ❌ Not in command mode, cannot test");
}