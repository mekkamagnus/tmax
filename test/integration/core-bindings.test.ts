/**
 * @file core-bindings.test.ts
 * @description Integration tests for core bindings loading and execution
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { TerminalIOImpl } from "../../src/core/terminal.ts";
import { FileSystemImpl } from "../../src/core/filesystem.ts";
import type { TerminalIO } from "../../src/core/types.ts";

/**
 * Mock terminal for testing
 */
class MockTerminal implements TerminalIO {
  private output: string[] = [];
  private keyQueue: string[] = [];

  write(data: string): Promise<void> {
    this.output.push(data);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.output = [];
    return Promise.resolve();
  }

  moveCursor(_position: { line: number; column: number }): Promise<void> {
    return Promise.resolve();
  }

  getSize(): { width: number; height: number } {
    return { width: 80, height: 24 };
  }

  enterRawMode(): Promise<void> {
    return Promise.resolve();
  }

  exitRawMode(): Promise<void> {
    return Promise.resolve();
  }

  enterAlternateScreen(): Promise<void> {
    return Promise.resolve();
  }

  exitAlternateScreen(): Promise<void> {
    return Promise.resolve();
  }

  readKey(): Promise<string> {
    const key = this.keyQueue.shift();
    if (!key) {
      return Promise.resolve("q"); // Default to quit to prevent hanging
    }
    return Promise.resolve(key);
  }

  showCursor(): Promise<void> {
    return Promise.resolve();
  }

  hideCursor(): Promise<void> {
    return Promise.resolve();
  }

  clearToEndOfLine(): Promise<void> {
    return Promise.resolve();
  }

  // Test helper methods
  queueKeys(keys: string[]): void {
    this.keyQueue.push(...keys);
  }

  getOutput(): string[] {
    return [...this.output];
  }

  clearOutput(): void {
    this.output = [];
  }
}

describe("Core Bindings Integration", () => {
  let editor: Editor;
  let terminal: MockTerminal;
  let filesystem: FileSystemImpl;

  // Setup before each test
  const setup = () => {
    terminal = new MockTerminal();
    filesystem = new FileSystemImpl();
    editor = new Editor(terminal, filesystem);
  };

  test("should load core bindings during editor startup", async () => {
    setup();

    // Queue a quit command so the editor exits immediately
    terminal.queueKeys(["q"]);

    // Start editor (this should load core bindings)
    await editor.start();

    // Check that the editor state shows core bindings were loaded
    const state = editor.getState();
    expect(typeof state.statusMessage).toBe("string");
    // Should not show an error message about missing bindings
    if (state.statusMessage.includes("Failed to load core bindings")) {
      throw new Error(`Core bindings failed to load: ${state.statusMessage}`);
    }
  });

  test("should execute navigation commands from core bindings", async () => {
    setup();

    // Create a test buffer with some content
    editor.createBuffer("test.txt", "line1\\nline2\\nline3");

    // Test that hjkl navigation bindings work
    const interpreter = editor.getInterpreter();

    // Test h (left)
    const hCommand = '(cursor-move (cursor-line) (- (cursor-column) 1))';
    const result = interpreter.execute(hCommand);
    // Should execute without error
    expect(typeof result).toBe("object");

    terminal.queueKeys(["q"]);
    await editor.start();
  });

  test("should handle mode switching from core bindings", async () => {
    setup();

    // Create test buffer
    editor.createBuffer("test.txt", "content");

    const interpreter = editor.getInterpreter();

    // Test mode switching command
    const insertModeCommand = '(editor-set-mode "insert")';
    interpreter.execute(insertModeCommand);

    const state = editor.getState();
    expect(state.mode).toBe("insert");

    terminal.queueKeys(["q"]);
    await editor.start();
  });

  test("should handle M-x system commands from core bindings", async () => {
    setup();

    editor.createBuffer("test.txt", "content");

    const interpreter = editor.getInterpreter();

    // Test M-x system commands
    const spaceCommand = '(editor-handle-space)';
    interpreter.execute(spaceCommand);

    const semicolonCommand = '(editor-handle-semicolon)';
    interpreter.execute(semicolonCommand);

    // Should execute without throwing errors
    terminal.queueKeys(["q"]);
    await editor.start();
  });

  test("should handle editing commands from core bindings", async () => {
    setup();

    editor.createBuffer("test.txt", "hello");

    const interpreter = editor.getInterpreter();

    // Test buffer operations
    const insertCommand = '(buffer-insert " world")';
    interpreter.execute(insertCommand);

    const deleteCommand = '(buffer-delete 1)';
    interpreter.execute(deleteCommand);

    // Should execute without throwing errors
    terminal.queueKeys(["q"]);
    await editor.start();
  });

  test("should gracefully handle missing core bindings file", async () => {
    setup();

    // Create an editor with a filesystem that will fail to read the core bindings
    class FailingFileSystem extends FileSystemImpl {
      override async readFile(path: string): Promise<string> {
        if (path.includes("core-bindings.tlisp")) {
          throw new Error("File not found");
        }
        return super.readFile(path);
      }
    }

    const failingFs = new FailingFileSystem();
    const testEditor = new Editor(terminal, failingFs);

    terminal.queueKeys(["q"]);

    // Should not throw an error, but should handle gracefully
    await testEditor.start();

    const state = testEditor.getState();
    // Should contain a warning about failed core bindings loading
    expect(state.statusMessage).toContain("Failed to load core bindings");
  });
});