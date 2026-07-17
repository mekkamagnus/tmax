/**
 * @file editor.test.ts
 * @description Test suite for the editor implementation
 */

import { describe, test, expect, afterEach } from "bun:test";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { Either } from "../../src/utils/task-either.ts";
import { bufferText, createEditorFixture, type EditorFixture } from "../helpers/editor-fixture.ts";

describe("Editor Implementation", () => {
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let fixture: EditorFixture;
  let editor: import("../../src/editor/editor.ts").Editor;

  // Keep a reference for afterEach disposal. setup() creates a fresh fixture
  // per test; dispose is idempotent so calling it again in afterEach after a
  // test-local dispose is a no-op.
  let current: EditorFixture | undefined;
  afterEach(() => { current?.dispose(); current = undefined; });

  // Setup before each test. Constructor-only state (no start) — these tests
  // exercise the editor's constructor + interpreter, not the full binding
  // policy.
  const setup = async () => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    fixture = await createEditorFixture({ terminal, filesystem, start: false });
    editor = fixture.editor;
    current = fixture;
  };

  test("should create editor with default state", async () => {
    await setup();
    const state = editor.getState();

    expect(state.mode).toBe("normal");
    expect(state.cursorPosition.line).toBe(0);
    expect(state.cursorPosition.column).toBe(0);
    expect(state.currentBuffer).toBeUndefined();
  });

  test("should create buffer", async () => {
    await setup();
    editor.createBuffer("test", "hello\nworld");

    const state = editor.getState();
    // currentBuffer should be set after createBuffer
    expect(state.currentBuffer).toBeDefined();

    // getContent returns Either<BufferError, string>
    const contentResult = state.currentBuffer?.getContent();
    expect(contentResult?._tag).toBe("Right");
    if (contentResult?._tag === "Right") {
      expect(contentResult.right).toBe("hello\nworld");
    }
  });

  test("should execute T-Lisp editor API functions", async () => {
    await setup();
    editor.createBuffer("test", "hello\nworld");

    const interpreter = editor.getInterpreter();

    // Test buffer functions - these execute T-Lisp commands which update state
    interpreter.execute("(buffer-text)");
    const state1 = editor.getState();
    expect(state1.currentBuffer).toBeDefined();

    interpreter.execute("(buffer-line-count)");
    const state2 = editor.getState();
    expect(state2.currentBuffer).toBeDefined();

    interpreter.execute("(buffer-line 0)");
    const state3 = editor.getState();
    expect(state3.currentBuffer).toBeDefined();
  });

  test("should handle cursor movement", async () => {
    await setup();
    editor.createBuffer("test", "hello\nworld");

    const interpreter = editor.getInterpreter();

    // Move cursor
    interpreter.execute("(cursor-move 1 2)");

    const state = editor.getState();
    expect(state.cursorPosition.line).toBe(1);
    expect(state.cursorPosition.column).toBe(2);
  });

  test("should handle text insertion", async () => {
    await setup();
    editor.createBuffer("test", "hello");

    const interpreter = editor.getInterpreter();

    // Move cursor to end and insert text
    interpreter.execute("(cursor-move 0 5)");
    interpreter.execute("(buffer-insert \" world\")");

    expect(bufferText(editor)).toBe("hello world");
  });

  test("should handle text deletion", async () => {
    await setup();
    editor.createBuffer("test", "hello world");

    const interpreter = editor.getInterpreter();

    // Move cursor to position 5
    interpreter.execute("(cursor-move 0 5)");

    // Delete operation - buffer-delete is currently a placeholder that returns "deleted"
    // The actual deletion logic needs to be implemented
    const deleteResult = interpreter.execute("(buffer-delete 6)");
    expect(deleteResult).toBeDefined();

    const state = editor.getState();
    expect(state.cursorPosition.line).toBe(0);
    expect(state.cursorPosition.column).toBe(5);
  });

  test("should handle mode switching", async () => {
    await setup();
    const interpreter = editor.getInterpreter();

    // Switch to insert mode
    interpreter.execute("(editor-set-mode \"insert\")");

    const state = editor.getState();
    expect(state.mode).toBe("insert");
  });

  test("should handle status messages", async () => {
    await setup();
    const interpreter = editor.getInterpreter();

    // Set status message
    interpreter.execute("(editor-set-status \"Test message\")");

    const state = editor.getState();
    expect(state.statusMessage).toBe("Test message");
  });

  test("should handle buffer management", async () => {
    await setup();
    const interpreter = editor.getInterpreter();

    // Create multiple buffers
    interpreter.execute("(buffer-create \"buffer1\")");
    interpreter.execute("(buffer-create \"buffer2\")");

    // List buffers - T-Lisp API function
    const bufferList = interpreter.execute("(buffer-list)");
    expect(bufferList).toBeDefined();

    // Switch buffer - T-Lisp API function
    interpreter.execute("(buffer-switch \"buffer1\")");
    const currentBuffer = interpreter.execute("(buffer-current)");
    expect(currentBuffer).toBeDefined();
  });

  test("should handle key bindings", async () => {
    await setup();
    const interpreter = editor.getInterpreter();

    // Bind a key - should not throw
    interpreter.execute("(key-bind \"x\" \"(editor-set-status \\\"X pressed\\\")\" \"normal\")");

    const mappings = editor.getKeyMappings().get("x") ?? [];
    expect(mappings.some(mapping =>
      mapping.mode === "normal" &&
      mapping.command === '(editor-set-status "X pressed")'
    )).toBe(true);
  });

  test("should handle file operations", async () => {
    await setup();

    // Set up mock file
    filesystem.files.set("test.txt", "file content");

    const interpreter = editor.getInterpreter();

    // file-exists-p checks if a file exists (sync)
    const existsResult = interpreter.execute("(file-exists-p \"/nonexistent.txt\")");
    expect(Either.isRight(existsResult)).toBe(true);
    if (Either.isRight(existsResult)) {
      expect(existsResult.right.value).toBe(false);
    }

    // write-file-content returns nil immediately (fire-and-forget async)
    const writeResult = interpreter.execute("(write-file-content \"/tmp/tmax-test-write.txt\" \"hello\")");
    expect(Either.isRight(writeResult)).toBe(true);
    if (Either.isRight(writeResult)) {
      expect(writeResult.right.type).toBe("nil");
    }

    // read-file-content returns nil for nonexistent files
    const readResult = interpreter.execute("(read-file-content \"/nonexistent.txt\")");
    expect(Either.isRight(readResult)).toBe(true);
    if (Either.isRight(readResult)) {
      expect(readResult.right.type).toBe("nil");
    }
  });

  test("should handle complex editor operations", async () => {
    await setup();
    editor.createBuffer("test", "line1\nline2\nline3");

    const interpreter = editor.getInterpreter();

    // Complex operation: go to line 2, insert text, move cursor
    const complexCommand = `
      (let ()
        (cursor-move 1 0)
        (buffer-insert "NEW ")
        (cursor-move 2 0)
        (buffer-text))
    `;

    const result = interpreter.execute(complexCommand);
    expect(result).toBeDefined();
  });

  test("should support editor customization", async () => {
    await setup();
    const interpreter = editor.getInterpreter();

    // Define custom function - use single line to avoid parsing issues
    const customFunction = "(defun my-custom-command () (editor-set-mode \"insert\"))";

    const defResult = interpreter.execute(customFunction);
    expect(Either.isRight(defResult)).toBe(true);

    // Execute custom function
    const callResult = interpreter.execute("(my-custom-command)");
    expect(Either.isRight(callResult)).toBe(true);

    const state = editor.getState();
    // The mode should be changed by the custom function
    expect(state.mode).toBe("insert");
  });

  test("should support macro definitions", async () => {
    await setup();
    const interpreter = editor.getInterpreter();

    // Define macro for common operation - use single line
    const macroDefinition = "(defmacro goto-line (line) `(cursor-move ,line 0))";

    const defResult = interpreter.execute(macroDefinition);
    expect(Either.isRight(defResult)).toBe(true);

    // Use macro
    editor.createBuffer("test", "line1\nline2\nline3");
    const callResult = interpreter.execute("(goto-line 2)");
    expect(Either.isRight(callResult)).toBe(true);

    const state = editor.getState();
    expect(state.cursorPosition.line).toBe(2);
    expect(state.cursorPosition.column).toBe(0);
  });
});
