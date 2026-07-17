/**
 * @file migration-validation.test.ts
 * @description Validate that the T-Lisp core bindings migration preserves identical behavior
 */

import { describe, test, expect } from "bun:test";
import { TerminalIOImpl } from "../../src/core/terminal.ts";
import { FileSystemImpl } from "../../src/core/filesystem.ts";
import { createEditorFixture } from "../helpers/editor-fixture.ts";

describe("Migration Validation", () => {
  test("should create editor successfully", async () => {
    const terminal = new TerminalIOImpl();
    const filesystem = new FileSystemImpl();
    const fixture = await createEditorFixture({ terminal, filesystem, start: false });
    try {
      const editor = fixture.editor;

      // Should create without throwing
      expect(typeof editor.getState()).toBe("object");
    } finally {
      fixture.dispose();
    }
  });

  test("should have key-bind function available", async () => {
    const terminal = new TerminalIOImpl();
    const filesystem = new FileSystemImpl();
    const fixture = await createEditorFixture({ terminal, filesystem, start: false });
    try {
      const editor = fixture.editor;
      const interpreter = editor.getInterpreter();

      // Should be able to execute a key-bind command without error
      const result = interpreter.execute('(key-bind "x" "(cursor-move 0 0)" "normal")');
      expect(typeof result).toBe("object");
    } finally {
      fixture.dispose();
    }
  });

  test("should be able to load core bindings file", async () => {
    const filesystem = new FileSystemImpl();

    // Should be able to read the core bindings file
    const content = await filesystem.readFile("src/tlisp/core-bindings.tlisp");
    expect(typeof content).toBe("string");
    expect(content.length > 0).toBe(true);

    // Should contain expected key binding commands
    expect(content.includes("key-bind")).toBe(true);
    expect(content.includes("cursor-move")).toBe(true);
  });

  test("should execute core binding commands", async () => {
    const terminal = new TerminalIOImpl();
    const filesystem = new FileSystemImpl();
    const fixture = await createEditorFixture({ terminal, filesystem, start: false });
    try {
      const editor = fixture.editor;

      editor.createBuffer("test.txt", "hello world");
      const interpreter = editor.getInterpreter();

      // Test basic editor API commands that are in core bindings
      let result;

      // Test cursor movement command
      result = interpreter.execute('(cursor-move 0 5)');
      expect(typeof result).toBe("object");

      // Test mode setting command
      result = interpreter.execute('(editor-set-mode "insert")');
      expect(typeof result).toBe("object");

      // Test buffer operations
      result = interpreter.execute('(buffer-insert " test")');
      expect(typeof result).toBe("object");

      // Verify state changes
      const state = editor.getState();
      expect(state.mode).toBe("insert");
      // After inserting " test" (5 characters) at position 5, cursor should be at 10
      expect(state.cursorPosition.column).toBe(10);
    } finally {
      fixture.dispose();
    }
  });

  test("should preserve original key mapping count", async () => {
    const filesystem = new FileSystemImpl();
    const content = await filesystem.readFile("src/tlisp/core-bindings.tlisp");

    // Count actual key-bind calls (not comments)
    const lines = content.split('\n');
    const keyBindLines = lines.filter(line => line.trim().startsWith('(key-bind'));
    const count = keyBindLines.length;

    // Preserve the compatibility binding file, including C-g and C-x b.
    expect(count).toBe(17);
  });
});
