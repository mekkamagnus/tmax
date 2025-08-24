#!/usr/bin/env deno run --allow-read --allow-write

/**
 * Comprehensive test of the command mode pipeline
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";

console.log("=== Testing Complete Command Pipeline ===");

try {
  const terminal = new TerminalIOImpl();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  
  // Create test buffer with content
  const testContent = "Line 1: Test content\nLine 2: More content\nLine 3: Final line";
  const testFilename = "command-pipeline-test.txt";
  
  console.log("1. Setting up test environment...");
  editor.createBuffer(testFilename, testContent);
  
  const state = editor.getState();
  const interpreter = editor.getInterpreter();
  
  console.log("   Initial mode:", state.mode);
  console.log("   Buffer content:", JSON.stringify(state.currentBuffer?.getCompleteContent()));
  
  // Test 1: Command mode entry
  console.log("\n2. Testing command mode entry...");
  console.log("   Simulating ':' key press...");
  
  // Simulate what happens when ':' is pressed in normal mode
  await editor.handleKey(":");
  
  console.log("   Mode after ':' press:", state.mode);
  console.log("   Command line:", JSON.stringify(state.commandLine));
  
  if (state.mode !== "command") {
    console.log("❌ Failed to enter command mode");
    throw new Error("Command mode entry failed");
  }
  
  // Test 2: Command input simulation
  console.log("\n3. Testing command input...");
  
  // Test 'w' command
  console.log("   Testing 'w' command input...");
  state.mode = "command";
  state.commandLine = "";
  
  // Simulate typing 'w'
  await editor.handleKey("w");
  console.log("   Command line after 'w':", JSON.stringify(state.commandLine));
  console.log("   Mode:", state.mode);
  
  // Test 3: Command execution
  console.log("\n4. Testing command execution...");
  console.log("   Simulating Enter key...");
  
  // Setup for save operation
  state.operations = {
    saveFile: async () => {
      console.log("   📁 Save operation called");
      const content = state.currentBuffer?.getCompleteContent() || "";
      await filesystem.writeFile(testFilename, content);
      console.log("   📁 File saved successfully");
    }
  };
  
  try {
    await editor.handleKey("Enter");
    console.log("   ✅ Enter key processed");
    console.log("   Mode after Enter:", state.mode);
    console.log("   Status message:", state.statusMessage);
  } catch (error) {
    console.log("   Command execution error:", error instanceof Error ? error.message : String(error));
  }
  
  // Test 4: File verification
  console.log("\n5. Testing file save verification...");
  try {
    const savedContent = await filesystem.readFile(testFilename);
    console.log("   ✅ File exists and contains:", JSON.stringify(savedContent));
    
    if (savedContent === testContent) {
      console.log("   ✅ File content matches expected");
    } else {
      console.log("   ❌ File content mismatch");
      console.log("   Expected:", JSON.stringify(testContent));
      console.log("   Actual:", JSON.stringify(savedContent));
    }
  } catch (error) {
    console.log("   ❌ File read error:", error instanceof Error ? error.message : String(error));
  }
  
  // Test 5: :wq command
  console.log("\n6. Testing :wq command...");
  state.mode = "command";
  state.commandLine = "wq";
  
  console.log("   Command line set to 'wq'");
  console.log("   Executing command...");
  
  try {
    const result = interpreter.execute('(editor-execute-command-line)');
    console.log("   :wq result:", result);
    console.log("   Status message:", state.statusMessage);
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
      console.log("   ✅ :wq correctly triggered quit signal");
    } else {
      console.log("   :wq error:", error instanceof Error ? error.message : String(error));
    }
  }
  
  // Test 6: :q command
  console.log("\n7. Testing :q command...");
  state.mode = "command";
  state.commandLine = "q";
  
  try {
    const result = interpreter.execute('(editor-execute-command-line)');
    console.log("   :q result:", result);
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
      console.log("   ✅ :q correctly triggered quit signal");
    } else {
      console.log("   :q error:", error instanceof Error ? error.message : String(error));
    }
  }
  
  // Test 7: Key mapping verification
  console.log("\n8. Testing key mapping for ':'...");
  const keyMappings = editor.getKeyMappings();
  const colonMappings = keyMappings.get(":");
  
  if (colonMappings && colonMappings.length > 0) {
    console.log("   ✅ ':' key mapping found:", colonMappings[0].command);
  } else {
    console.log("   ❌ No ':' key mapping found");
  }
  
  // Cleanup
  console.log("\n9. Cleaning up...");
  try {
    await Deno.remove(testFilename);
    console.log("   ✅ Test file cleaned up");
  } catch (error) {
    console.log("   Warning: Could not remove test file:", error instanceof Error ? error.message : String(error));
  }
  
  console.log("\n✅ Command pipeline test completed!");
  
} catch (error) {
  console.error("❌ Command pipeline test failed:", error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error("Stack trace:", error.stack);
  }
}