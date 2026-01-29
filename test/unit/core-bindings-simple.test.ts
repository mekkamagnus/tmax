/**
 * @file core-bindings-simple.test.ts
 * @description Simple tests for T-Lisp core bindings file
 */

import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

describe("Core Bindings File Structure", () => {
  test("should exist and be readable", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");
    expect(typeof content).toBe("string");
    if (content.length === 0) {
      throw new Error("Core bindings file should not be empty");
    }
  });

  test("should contain all expected key-bind calls", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Count key-bind function calls (exclude comments)
    const keyBindMatches = content.match(/^\(key-bind/gm);
    expect(keyBindMatches?.length).toBe(17, "Should contain exactly 17 key-bind calls");
  });

  test("should contain basic navigation bindings", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Check for hjkl navigation
    expect(content).toContain('(key-bind "h"');
    expect(content).toContain('(key-bind "j"');
    expect(content).toContain('(key-bind "k"');
    expect(content).toContain('(key-bind "l"');
    expect(content).toContain('"normal"');
    expect(content).toContain('cursor-move');
  });

  test("should contain mode switching bindings", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Check for mode switching
    expect(content).toContain('(key-bind "i"');
    expect(content).toContain('(key-bind "Escape"');
    expect(content).toContain('editor-set-mode');
    expect(content).toContain('"insert"');
  });

  test("should contain M-x system bindings", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Check for M-x functionality
    expect(content).toContain('(key-bind " "');  // Space key
    expect(content).toContain('(key-bind ";"');  // Semicolon key
    expect(content).toContain('editor-handle-space');
    expect(content).toContain('editor-handle-semicolon');
  });

  test("should contain proper T-Lisp structure", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Check for organizational comments
    expect(content).toContain(";; core-bindings.tlisp");
    expect(content).toContain(";; BASIC NAVIGATION");
    expect(content).toContain(";; MODE SWITCHING");

    // Check for proper parentheses balance (basic validation)
    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    expect(openParens).toBe(closeParens, "Parentheses should be balanced");
  });
});