/**
 * @file core-bindings.test.ts
 * @description Tests for T-Lisp core bindings file validation
 */

import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";

/**
 * Test T-Lisp core bindings file
 */
describe("Core Bindings T-Lisp File", () => {
  const interpreter = new TLispInterpreterImpl();

  test("should exist and be readable", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");
    expect(typeof content).toBe("string");
    expect(content.length > 0).toBe(true, "Core bindings file should not be empty");
  });

  test("should contain valid T-Lisp syntax", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Should not throw parsing errors
    try {
      interpreter.execute(content);
    } catch (error) {
      throw new Error(`Core bindings file contains syntax errors: ${error}`);
    }
  });

  test("should contain all expected key-bind calls", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Count key-bind function calls
    const keyBindMatches = content.match(/\(key-bind/g);
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
  });

  test("should contain mode switching bindings", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Check for mode switching
    expect(content).toContain('(key-bind "i"');
    expect(content).toContain('(key-bind "Escape"');
    expect(content).toContain('(editor-set-mode');
    expect(content).toContain('"insert"');
  });

  test("should contain M-x system bindings", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Check for M-x functionality
    expect(content).toContain('(key-bind " "');  // Space key
    expect(content).toContain('(key-bind ";"');  // Semicolon key
    expect(content).toContain('(editor-handle-space)');
    expect(content).toContain('(editor-handle-semicolon)');
    expect(content).toContain('"mx"');
  });

  test("should contain command mode bindings", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Check for command mode
    expect(content).toContain('(editor-enter-command-mode)');
    expect(content).toContain('(editor-exit-command-mode)');
    expect(content).toContain('(editor-execute-command-line)');
    expect(content).toContain('"command"');
  });

  test("should contain editing bindings", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Check for basic editing
    expect(content).toContain('(key-bind "Backspace"');
    expect(content).toContain('(key-bind "Enter"');
    expect(content).toContain('(buffer-delete');
    expect(content).toContain('(buffer-insert');
  });

  test("should contain proper comments and organization", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Check for organizational comments
    expect(content).toContain(";; core-bindings.tlisp");
    expect(content).toContain(";; BASIC NAVIGATION");
    expect(content).toContain(";; MODE SWITCHING");
    expect(content).toContain(";; M-X SYSTEM");
    expect(content).toContain(";; APPLICATION CONTROL");
  });

  test("should not contain TypeScript string escaping", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    // Should not contain double-escaped strings like \\\"
    expect(content.includes('\\\\"')).toBe(false, "Should not contain TypeScript string escaping");
    expect(content.includes('\\\\n')).toBe(false, "Should not contain escaped newlines from TypeScript");
  });
});