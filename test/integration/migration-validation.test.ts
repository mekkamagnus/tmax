/**
 * @file migration-validation.test.ts
 * @description Validate that the T-Lisp core bindings migration preserves identical behavior
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { Editor } from "../../src/editor/editor.ts";
import { TerminalIOImpl } from "../../src/core/terminal.ts";
import { FileSystemImpl } from "../../src/core/filesystem.ts";

Deno.test("Migration Validation", async (t) => {
  await t.step("should create editor successfully", () => {
    const terminal = new TerminalIOImpl();
    const filesystem = new FileSystemImpl();
    const editor = new Editor(terminal, filesystem);
    
    // Should create without throwing
    assertEquals(typeof editor.getState(), "object");
  });

  await t.step("should have key-bind function available", () => {
    const terminal = new TerminalIOImpl();
    const filesystem = new FileSystemImpl();
    const editor = new Editor(terminal, filesystem);
    
    const interpreter = editor.getInterpreter();
    
    // Should be able to execute a key-bind command without error
    const result = interpreter.execute('(key-bind "x" "(cursor-move 0 0)" "normal")');
    assertEquals(typeof result, "object");
  });

  await t.step("should be able to load core bindings file", async () => {
    const filesystem = new FileSystemImpl();
    
    // Should be able to read the core bindings file
    const content = await filesystem.readFile("src/tlisp/core-bindings.tlisp");
    assertEquals(typeof content, "string");
    assertEquals(content.length > 0, true);
    
    // Should contain expected key binding commands
    assertEquals(content.includes("key-bind"), true);
    assertEquals(content.includes("cursor-move"), true);
  });

  await t.step("should execute core binding commands", () => {
    const terminal = new TerminalIOImpl();
    const filesystem = new FileSystemImpl();
    const editor = new Editor(terminal, filesystem);
    
    editor.createBuffer("test.txt", "hello world");
    const interpreter = editor.getInterpreter();
    
    // Test basic editor API commands that are in core bindings
    let result;
    
    // Test cursor movement command
    result = interpreter.execute('(cursor-move 0 5)');
    assertEquals(typeof result, "object");
    
    // Test mode setting command  
    result = interpreter.execute('(editor-set-mode "insert")');
    assertEquals(typeof result, "object");
    
    // Test buffer operations
    result = interpreter.execute('(buffer-insert " test")');
    assertEquals(typeof result, "object");
    
    // Verify state changes
    const state = editor.getState();
    assertEquals(state.mode, "insert");
    assertEquals(state.cursorColumn, 5);
  });

  await t.step("should preserve original key mapping count", async () => {
    const filesystem = new FileSystemImpl();
    const content = await filesystem.readFile("src/tlisp/core-bindings.tlisp");
    
    // Count actual key-bind calls (not comments)
    const lines = content.split('\n');
    const keyBindLines = lines.filter(line => line.trim().startsWith('(key-bind'));
    const count = keyBindLines.length;
    
    // Should have exactly the same number as the original implementation
    // Based on our analysis: 4 nav + 2 mode + 1 cmd entry + 2 cmd mode + 2 app + 2 mx + 2 mx mode + 2 edit = 17
    assertEquals(count, 17, `Expected 17 key bindings, found ${count}`);
  });
});