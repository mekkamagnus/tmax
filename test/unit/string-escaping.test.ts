/**
 * Test string escaping in insert mode to prevent T-Lisp syntax errors
 */

import { assertEquals } from "@std/assert";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

Deno.test("Editor - String escaping in insert mode", () => {
  const terminal = new MockTerminal();
  const filesystem = new MockFileSystem();
  const editor = new Editor(terminal, filesystem);
  
  const interpreter = editor.getInterpreter();
  
  // Create a new buffer to work with
  editor.createBuffer("test", "");
  
  // Test inserting a double quote character - this was causing the error
  interpreter.execute('(buffer-insert "\\"")');  // Properly escaped
  
  // Verify the quote was actually inserted
  const content = interpreter.execute("(buffer-text)");
  assertEquals(content.value, '"');
  
  // Create new buffer for next test
  editor.createBuffer("test2", "");
  interpreter.execute('(buffer-switch "test2")');
  
  // Test inserting a backslash character
  interpreter.execute('(buffer-insert "\\\\")');  // Properly escaped
  
  // Verify the backslash was inserted
  const backslashContent = interpreter.execute("(buffer-text)");
  assertEquals(backslashContent.value, "\\");
  
  // Test complex string with both quotes and backslashes
  editor.createBuffer("test3", "");
  interpreter.execute('(buffer-switch "test3")');
  interpreter.execute('(buffer-insert "He said \\"Hello\\\\nWorld\\"")');
  
  const complexContent = interpreter.execute("(buffer-text)");
  assertEquals(complexContent.value, 'He said "Hello\nWorld"');
});

Deno.test("Editor - escapeKeyForTLisp method", () => {
  const terminal = new MockTerminal();
  const filesystem = new MockFileSystem();
  const editor = new Editor(terminal, filesystem);
  
  // Test the escaping logic directly through reflection
  // Access private method for testing
  const escapeMethod = (editor as any).escapeKeyForTLisp.bind(editor);
  
  assertEquals(escapeMethod('"'), '\\"');
  assertEquals(escapeMethod('\\'), '\\\\');
  assertEquals(escapeMethod('\\"'), '\\\\\\"');
  assertEquals(escapeMethod('\n'), '\\n');
  assertEquals(escapeMethod('\t'), '\\t');
  assertEquals(escapeMethod('\r'), '\\r');
  assertEquals(escapeMethod('normal'), 'normal');
  assertEquals(escapeMethod(''), '');
});

Deno.test("Editor - Insert mode key handling with special characters", async () => {
  const terminal = new MockTerminal();
  const filesystem = new MockFileSystem();
  const editor = new Editor(terminal, filesystem);
  
  const interpreter = editor.getInterpreter();
  
  // Create buffer and enter insert mode
  editor.createBuffer("test", "");
  interpreter.execute('(editor-set-mode "insert")');
  
  // Simulate key presses that would cause the original error
  await editor.handleKey('"');  // This was failing before the fix
  await editor.handleKey('\\'); // This could also be problematic
  await editor.handleKey('a');   // Normal character
  await editor.handleKey('"');  // Another quote
  
  const finalContent = interpreter.execute("(buffer-text)");
  assertEquals(finalContent.value, '"\\a"');
});

Deno.test("Editor - Enter key handling in insert mode", async () => {
  const terminal = new MockTerminal();
  const filesystem = new MockFileSystem();
  const editor = new Editor(terminal, filesystem);
  
  const interpreter = editor.getInterpreter();
  
  // Create buffer and position cursor at end
  editor.createBuffer("test", "hello");
  interpreter.execute("(cursor-move 0 5)");
  interpreter.execute('(editor-set-mode "insert")');
  
  // Simulate pressing Enter
  await editor.handleKey("\r");
  
  const finalContent = interpreter.execute("(buffer-text)");
  assertEquals(finalContent.value, "hello\n");
});