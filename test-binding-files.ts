/**
 * Simple test to verify that the editor can load the new binding files
 */
import { Editor } from "../src/editor/editor.ts";
import { MockTerminal } from "./mocks/terminal.ts";
import { MockFileSystem } from "./mocks/filesystem.ts";

async function testBindingFiles() {
  const terminal = new MockTerminal();
  const filesystem = new MockFileSystem();
  
  // Read the actual files and put them in the mock filesystem
  const fs = require("fs");
  const path = require("path");
  
  // Load the actual content of the binding files
  const normalContent = fs.readFileSync("src/tlisp/core/bindings/normal.tlisp", "utf8");
  const insertContent = fs.readFileSync("src/tlisp/core/bindings/insert.tlisp", "utf8");
  const visualContent = fs.readFileSync("src/tlisp/core/bindings/visual.tlisp", "utf8");
  const commandContent = fs.readFileSync("src/tlisp/core/bindings/command.tlisp", "utf8");
  
  filesystem.files.set("src/tlisp/core/bindings/normal.tlisp", normalContent);
  filesystem.files.set("src/tlisp/core/bindings/insert.tlisp", insertContent);
  filesystem.files.set("src/tlisp/core/bindings/visual.tlisp", visualContent);
  filesystem.files.set("src/tlisp/core/bindings/command.tlisp", commandContent);
  filesystem.files.set("~/.tmaxrc", "(key-bind \"C-c C-c\" \"(custom-command)\" \"normal\")");
  
  const editor = new Editor(terminal, filesystem);
  
  console.log("Starting editor...");
  await editor.start();
  
  console.log("Editor started successfully!");
  
  // Check key mappings
  const keyMappings = editor.getKeyMappings();
  console.log("Total key mappings:", keyMappings.size);
  
  // Check for specific mappings
  const hMappings = keyMappings.get("h");
  console.log("H key mappings:", hMappings?.length);
  
  const escapeMappings = keyMappings.get("Escape");
  console.log("Escape key mappings:", escapeMappings?.length);
  
  if (escapeMappings) {
    const insertEscape = escapeMappings.find(m => m.mode === "insert");
    const visualEscape = escapeMappings.find(m => m.mode === "visual");
    const commandEscape = escapeMappings.find(m => m.mode === "command");
    
    console.log("Insert escape mapping:", !!insertEscape);
    console.log("Visual escape mapping:", !!visualEscape);
    console.log("Command escape mapping:", !!commandEscape);
  }
  
  editor.stop();
  console.log("Test completed successfully!");
}

// Run the test
testBindingFiles().catch(console.error);