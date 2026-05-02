/**
 * Debug script to test the new key binding functions
 */
import { Editor } from "./src/editor/editor.ts";
import { MockTerminal } from "./test/mocks/terminal.ts";
import { MockFileSystem } from "./test/mocks/filesystem.ts";

async function debugKeyBindFunctions() {
  const terminal = new MockTerminal();
  const filesystem = new MockFileSystem();
  
  // Add the binding files to the mock filesystem so the editor starts properly
  filesystem.files.set("src/tlisp/core/bindings/normal.tlisp", 
`(key-bind "h" "(cursor-move (cursor-line) (- (cursor-column) 1))" "normal")
(key-bind "j" "(cursor-move (+ (cursor-line) 1) (cursor-column))" "normal")
(key-bind "k" "(cursor-move (- (cursor-line) 1) (cursor-column))" "normal")
(key-bind "l" "(cursor-move (cursor-line) (+ (cursor-column) 1))" "normal")`);
  filesystem.files.set("src/tlisp/core/bindings/insert.tlisp", 
`(key-bind "Escape" "(editor-set-mode \"normal\")" "insert")`);
  filesystem.files.set("src/tlisp/core/bindings/visual.tlisp", 
`(key-bind "Escape" "(editor-set-mode \"normal\")" "visual")`);
  filesystem.files.set("src/tlisp/core/bindings/command.tlisp", 
`(key-bind "Escape" "(editor-exit-command-mode)" "command")`);

  const editor = new Editor(terminal, filesystem);
  
  console.log("Starting editor...");
  await editor.start();
  
  const interpreter = editor.getInterpreter();
  
  try {
    console.log("Testing key-bind function...");
    const result = interpreter.execute('(key-bind "C-c C-c" "(some-command)")');
    console.log("key-bind result:", result);
    console.log("Type:", result?.type);
    console.log("Value:", (result as any)?.value);
  } catch (error) {
    console.error("Error calling key-bind:", error);
  }
  
  try {
    console.log("\nTesting key-unbind function...");
    const result = interpreter.execute('(key-unbind "C-c C-c")');
    console.log("key-unbind result:", result);
    console.log("Type:", result?.type);
    console.log("Value:", (result as any)?.value);
  } catch (error) {
    console.error("Error calling key-unbind:", error);
  }
  
  try {
    console.log("\nTesting key-bindings function...");
    const result = interpreter.execute('(key-bindings)');
    console.log("key-bindings result:", result);
    console.log("Type:", result?.type);
    console.log("Value length:", (result as any)?.value?.length);
  } catch (error) {
    console.error("Error calling key-bindings:", error);
  }
  
  try {
    console.log("\nTesting key-binding function...");
    const result = interpreter.execute('(key-binding "h")');
    console.log("key-binding result:", result);
    console.log("Type:", result?.type);
  } catch (error) {
    console.error("Error calling key-binding:", error);
  }
  
  editor.stop();
  console.log("Debug completed!");
}

debugKeyBindFunctions().catch(console.error);