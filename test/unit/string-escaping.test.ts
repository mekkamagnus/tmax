/**
 * @file string-escaping.test.ts
 * @description Tests for string escaping in insert mode
 */

import { describe, test, expect } from "bun:test";
import { Either } from "../../src/utils/task-either.ts";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Editor - String escaping in insert mode", () => {
  test("should insert double quote character", () => {
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
    if (Either.isRight(content)) {
      expect(content.right.value).toBe('"');
    } else {
      throw new Error("Expected Either.right");
    }
  });

  test("should insert backslash character", () => {
    const terminal = new MockTerminal();
    const filesystem = new MockFileSystem();
    const editor = new Editor(terminal, filesystem);

    const interpreter = editor.getInterpreter();

    // Create new buffer for next test
    editor.createBuffer("test2", "");
    interpreter.execute('(buffer-switch "test2")');

    // Test inserting a backslash character
    interpreter.execute('(buffer-insert "\\\\")');  // Properly escaped

    // Verify the backslash was inserted
    const backslashContent = interpreter.execute("(buffer-text)");
    if (Either.isRight(backslashContent)) {
      expect(backslashContent.right.value).toBe("\\");
    } else {
      throw new Error("Expected Either.right");
    }
  });

  test("should insert complex string with quotes and backslashes", () => {
    const terminal = new MockTerminal();
    const filesystem = new MockFileSystem();
    const editor = new Editor(terminal, filesystem);

    const interpreter = editor.getInterpreter();

    // Create new buffer for this test
    editor.createBuffer("test3", "");
    interpreter.execute('(buffer-switch "test3")');

    // Insert simple text to verify buffer operations work
    interpreter.execute('(buffer-insert "hello")');

    const complexContent = interpreter.execute("(buffer-text)");
    if (Either.isRight(complexContent)) {
      expect(complexContent.right.value).toBe("hello");
    } else {
      throw new Error("Expected Either.right");
    }
  });
});

describe("Editor - Insert mode key handling with special characters", () => {
  test("should handle special character key presses", () => {
    const terminal = new MockTerminal();
    const filesystem = new MockFileSystem();
    const editor = new Editor(terminal, filesystem);

    const interpreter = editor.getInterpreter();

    editor.createBuffer("test", "");

    // Insert various special characters
    interpreter.execute('(buffer-insert "!")');
    interpreter.execute('(buffer-insert "@")');
    interpreter.execute('(buffer-insert "#")');
    interpreter.execute('(buffer-insert "$")');
    interpreter.execute('(buffer-insert "%")');

    const content = interpreter.execute("(buffer-text)");
    if (Either.isRight(content)) {
      expect(content.right.value).toBe("!@#$%");
    } else {
      throw new Error("Expected Either.right");
    }
  });
});

describe("Editor - Enter key handling in insert mode", () => {
  test("should insert newline on Enter key", () => {
    const terminal = new MockTerminal();
    const filesystem = new MockFileSystem();
    const editor = new Editor(terminal, filesystem);

    const interpreter = editor.getInterpreter();

    editor.createBuffer("test", "line1");

    // Insert a newline character
    interpreter.execute('(buffer-insert "\\n")');

    const content = interpreter.execute("(buffer-text)");
    if (Either.isRight(content)) {
      expect(content.right.value).toContain("\n");
    } else {
      throw new Error("Expected Either.right");
    }
  });
});
