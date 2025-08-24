#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Test command functionality including :w and :wq
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

// Handle unhandled promise rejections gracefully
globalThis.addEventListener("unhandledrejection", (event) => {
  if (event.reason instanceof Error && event.reason.message === "EDITOR_QUIT_SIGNAL") {
    console.log("   ✅ Async quit signal handled correctly");
    event.preventDefault(); // Prevent the error from crashing the script
  }
});

const terminal = new TerminalIOImpl();
const filesystem = new FileSystemImpl();
const editor = new Editor(terminal, filesystem);

console.log("=== Testing Command Functionality ===");

try {
  // Create a test file and buffer
  const testContent = "Hello, world!\nThis is a test file.";
  const testFilename = "test-file.txt";
  
  console.log("1. Creating test buffer with content...");
  editor.createBuffer(testFilename, testContent);
  
  console.log("2. Testing :w (save) command...");
  const interpreter = editor.getInterpreter();
  
  // Set command line to "w" and execute
  const state = editor.getState();
  state.commandLine = "w";
  state.mode = "command";
  
  try {
    const result = interpreter.execute('(editor-execute-command-line)');
    console.log("   Save command result:", result);
    console.log("   Status message:", state.statusMessage);
  } catch (error) {
    console.log("   Save command error:", error instanceof Error ? error.message : String(error));
  }
  
  console.log("3. Testing :wq (save and quit) command...");
  state.commandLine = "wq";
  state.mode = "command";
  
  try {
    const result = interpreter.execute('(editor-execute-command-line)');
    console.log("   Save and quit result:", result);
    console.log("   Status message:", state.statusMessage);
    
    // Wait a bit for async save operation
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log("   ✅ Save and quit command executed (quit signal may occur asynchronously)");
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
      console.log("   ✅ Save and quit correctly triggered quit signal");
    } else {
      console.log("   Save and quit error:", error instanceof Error ? error.message : String(error));
    }
  }
  
  console.log("4. Testing :q (quit) command...");
  state.commandLine = "q";
  state.mode = "command";
  
  try {
    const result = interpreter.execute('(editor-execute-command-line)');
    console.log("   Quit result:", result);
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
      console.log("   ✅ Quit correctly triggered quit signal");
    } else {
      console.log("   Quit error:", error instanceof Error ? error.message : String(error));
    }
  }
  
  console.log("5. Checking if test file was created...");
  try {
    const savedContent = await filesystem.readFile(testFilename);
    console.log("   ✅ File saved successfully!");
    console.log("   Content:", savedContent);
    
    // Clean up
    await Deno.remove(testFilename);
    console.log("   Cleaned up test file");
  } catch (error) {
    console.log("   ❌ File not found or not saved:", error instanceof Error ? error.message : String(error));
  }
  
} catch (error) {
  console.error("❌ Error during command test:", error instanceof Error ? error.message : String(error));
}