/**
 * @file core-bindings-simple.test.ts
 * @description Simple tests for T-Lisp core bindings file
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";

Deno.test("Core Bindings File Structure", async (t) => {
  await t.step("should exist and be readable", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    assertEquals(typeof content, "string");
    if (content.length === 0) {
      throw new Error("Core bindings file should not be empty");
    }
  });

  await t.step("should contain all expected key-bind calls", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Count key-bind function calls (exclude comments)
    const keyBindMatches = content.match(/^\(key-bind/gm);
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
    assertStringIncludes(content, 'cursor-move');
  });

  await t.step("should contain mode switching bindings", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Check for mode switching
    assertStringIncludes(content, '(key-bind "i"');
    assertStringIncludes(content, '(key-bind "Escape"');
    assertStringIncludes(content, 'editor-set-mode');
    assertStringIncludes(content, '"insert"');
  });

  await t.step("should contain M-x system bindings", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Check for M-x functionality
    assertStringIncludes(content, '(key-bind " "');  // Space key
    assertStringIncludes(content, '(key-bind ";"');  // Semicolon key
    assertStringIncludes(content, 'editor-handle-space');
    assertStringIncludes(content, 'editor-handle-semicolon');
  });

  await t.step("should contain proper T-Lisp structure", async () => {
    const content = await Deno.readTextFile("src/tlisp/core-bindings.tlisp");
    
    // Check for organizational comments
    assertStringIncludes(content, ";; core-bindings.tlisp");
    assertStringIncludes(content, ";; BASIC NAVIGATION");
    assertStringIncludes(content, ";; MODE SWITCHING");
    
    // Check for proper parentheses balance (basic validation)
    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    assertEquals(openParens, closeParens, "Parentheses should be balanced");
  });
});