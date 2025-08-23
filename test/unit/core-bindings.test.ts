/**
 * @file core-bindings.test.ts
 * @description Tests for T-Lisp core bindings file validation
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";

/**
 * Test T-Lisp core bindings file
 */
Deno.test("Core Bindings T-Lisp File", async (t) => {
  const interpreter = new TLispInterpreterImpl();

  await t.step("should exist and be readable", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    assertEquals(typeof content, "string");
    assert(content.length > 0, "Core bindings file should not be empty");
  });

  await t.step("should contain valid T-Lisp syntax", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Should not throw parsing errors
    try {
      interpreter.execute(content);
    } catch (error) {
      throw new Error(`Core bindings file contains syntax errors: ${error}`);
    }
  });

  await t.step("should contain all expected key-bind calls", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Count key-bind function calls
    const keyBindMatches = content.match(/\(key-bind/g);
    assertEquals(keyBindMatches?.length, 17, "Should contain exactly 17 key-bind calls");
  });

  await t.step("should contain basic navigation bindings", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Check for hjkl navigation
    assertStringIncludes(content, '(key-bind "h"');
    assertStringIncludes(content, '(key-bind "j"');
    assertStringIncludes(content, '(key-bind "k"');
    assertStringIncludes(content, '(key-bind "l"');
    assertStringIncludes(content, '"normal"');
  });

  await t.step("should contain mode switching bindings", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Check for mode switching
    assertStringIncludes(content, '(key-bind "i"');
    assertStringIncludes(content, '(key-bind "Escape"');
    assertStringIncludes(content, '(editor-set-mode');
    assertStringIncludes(content, '"insert"');
  });

  await t.step("should contain M-x system bindings", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Check for M-x functionality
    assertStringIncludes(content, '(key-bind " "');  // Space key
    assertStringIncludes(content, '(key-bind ";"');  // Semicolon key
    assertStringIncludes(content, '(editor-handle-space)');
    assertStringIncludes(content, '(editor-handle-semicolon)');
    assertStringIncludes(content, '"mx"');
  });

  await t.step("should contain command mode bindings", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Check for command mode
    assertStringIncludes(content, '(editor-enter-command-mode)');
    assertStringIncludes(content, '(editor-exit-command-mode)');
    assertStringIncludes(content, '(editor-execute-command-line)');
    assertStringIncludes(content, '"command"');
  });

  await t.step("should contain editing bindings", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Check for basic editing
    assertStringIncludes(content, '(key-bind "Backspace"');
    assertStringIncludes(content, '(key-bind "Enter"');
    assertStringIncludes(content, '(buffer-delete');
    assertStringIncludes(content, '(buffer-insert');
  });

  await t.step("should contain proper comments and organization", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Check for organizational comments
    assertStringIncludes(content, ";; core-bindings.tlisp");
    assertStringIncludes(content, ";; BASIC NAVIGATION");
    assertStringIncludes(content, ";; MODE SWITCHING");
    assertStringIncludes(content, ";; M-X SYSTEM");
    assertStringIncludes(content, ";; APPLICATION CONTROL");
  });

  await t.step("should not contain TypeScript string escaping", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Should not contain double-escaped strings like \\\"
    assert(!content.includes('\\\\"'), "Should not contain TypeScript string escaping");
    assert(!content.includes('\\\\n'), "Should not contain escaped newlines from TypeScript");
  });
});

// Helper function for assertions
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}