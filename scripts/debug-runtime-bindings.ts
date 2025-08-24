#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Debug why bindings aren't loading in runtime
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Debugging Runtime Key Bindings ===");

async function testRuntimeBindings() {
  const terminal = new TerminalIOImpl();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  
  console.log("1. Testing key bindings after editor creation...");
  let mappings = editor.getKeyMappings();
  console.log(`   Key mappings count: ${mappings.size}`);
  
  console.log("2. Creating buffer (simulating normal usage)...");
  editor.createBuffer("test.txt", "test content");
  mappings = editor.getKeyMappings();
  console.log(`   Key mappings after buffer creation: ${mappings.size}`);
  
  console.log("3. Simulating key press to trigger lazy loading...");
  const state = editor.getState();
  console.log(`   Status before key: ${state.statusMessage}`);
  
  // This should trigger ensureCoreBindingsLoaded
  await editor.handleKey("h");
  
  mappings = editor.getKeyMappings();
  console.log(`   Key mappings after key press: ${mappings.size}`);
  console.log(`   Status after key: ${state.statusMessage}`);
  
  console.log("4. Checking specific key bindings...");
  const testKeys = ["h", "j", "k", "l", "i", ":", "Escape", "q"];
  for (const key of testKeys) {
    const keyMappings = mappings.get(key);
    if (keyMappings && keyMappings.length > 0) {
      console.log(`   ✅ ${key}: ${keyMappings[0].command.substring(0, 40)}...`);
    } else {
      console.log(`   ❌ ${key}: NOT BOUND`);
    }
  }
  
  console.log("5. Testing start() method loading...");
  const editor2 = new Editor(terminal, filesystem);
  
  // Call start method to see if bindings load there
  console.log("   Calling editor.start() (will timeout after 2 seconds)...");
  
  const startPromise = editor2.start();
  
  // Give it 2 seconds to load bindings then force stop
  setTimeout(() => {
    editor2.stop();
  }, 2000);
  
  try {
    await startPromise;
  } catch (error) {
    console.log("   Start method completed (stopped)");
  }
  
  const startMappings = editor2.getKeyMappings();
  console.log(`   Key mappings after start(): ${startMappings.size}`);
  console.log(`   Status: ${editor2.getState().statusMessage}`);
}

await testRuntimeBindings();