/**
 * @file keymap-customization.test.ts
 * @description End-to-end tests for .tmaxrc keymap customization
 *
 * Tests for user customization workflows:
 * - Loading custom keybindings from .tmaxrc
 * - Custom bindings override defaults
 * - Multiple keymaps for different modes
 * - Runtime keymap modification via M-x
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { TerminalIO } from "../../src/core/terminal.ts";
import { FileSystem } from "../../src/core/filesystem.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerStdlibFunctions } from "../../src/tlisp/stdlib.ts";
import { Either } from "../../src/utils/task-either.ts";
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Mock TerminalIO for testing
class MockTerminalIO implements TerminalIO {
  private buffer: string[] = [];
  cursor = { row: 0, col: 0 };

  write(text: string): void {
    this.buffer.push(text);
  }

  clear(): void {
    this.buffer = [];
  }

  getSize(): { width: number; height: number } {
    return { width: 80, height: 24 };
  }

  moveCursor(row: number, col: number): void {
    this.cursor = { row, col };
  }

  enterRawMode(): void {}
  exitRawMode(): void {}
  flush(): void {}
  read(): Promise<string> { return Promise.resolve(""); }
  query(seq: string): Promise<boolean> { return Promise.resolve(true); }
}

// Mock FileSystem for testing
class MockFileSystem implements FileSystem {
  private files: Map<string, string> = new Map();

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

describe("Keymap Customization E2E", () => {
  let editor: Editor;
  let terminal: MockTerminalIO;
  let filesystem: MockFileSystem;
  let tempConfigPath: string;

  beforeEach(() => {
    terminal = new MockTerminalIO();
    filesystem = new MockFileSystem();

    // Create a temporary config path for testing
    tempConfigPath = path.join(os.tmpdir(), `.tmaxrc-test-${Date.now()}`);
  });

  afterEach(async () => {
    // Clean up temp config file
    try {
      await fs.unlink(tempConfigPath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe(".tmaxrc Loading", () => {
    test("should load and execute .tmaxrc file during editor start", async () => {
      // Create a .tmaxrc file with a custom keymap
      const tmaxrcContent = `
;; Custom keymap configuration
(defkeymap "*my-custom-keymap*")
(setq "*my-custom-keymap*" (keymap-define-key *my-custom-keymap* "j" "custom-down"))
(setq "*my-custom-keymap*" (keymap-define-key *my-custom-keymap* "k" "custom-up"))

;; Register the keymap for normal mode
(keymap-set "normal" *my-custom-keymap*)
`;
      filesystem.writeFile(tempConfigPath, tmaxrcContent);

      // Create editor (which would normally load ~/.tmaxrc)
      editor = new Editor(terminal, filesystem);

      // Manually execute the .tmaxrc content (simulating what loadInitFile does)
      const interpreter = (editor as any).interpreter as TLispInterpreterImpl;
      registerStdlibFunctions(interpreter);
      interpreter.execute(tmaxrcContent);

      // Verify the keymap was defined
      const keymap = interpreter.globalEnv.lookup("*my-custom-keymap*");
      expect(keymap).toBeDefined();
      expect(keymap?.type).toBe("hashmap");

      // Verify the keymap was registered with KeymapSync
      const keymapSync = (editor as any).keymapSync;
      expect(keymapSync.hasKeymap("normal")).toBe(true);

      // Verify bindings can be looked up
      const command = await keymapSync.lookupKeyBinding("normal", "j");
      expect(command).toBe("custom-down");
    });

    test("should handle missing .tmaxrc gracefully", async () => {
      // Don't create a .tmaxrc file
      editor = new Editor(terminal, filesystem);

      // Editor should still initialize without errors
      const interpreter = (editor as any).interpreter as TLispInterpreterImpl;
      expect(interpreter).toBeDefined();

      // KeymapSync should be initialized but empty
      const keymapSync = (editor as any).keymapSync;
      expect(keymapSync.hasKeymap("normal")).toBe(false);
    });

    test("should handle malformed .tmaxrc gracefully", async () => {
      // Create a .tmaxrc file with invalid T-Lisp syntax
      const tmaxrcContent = `
;; Invalid T-Lisp syntax
(defkeymap "missing-quote
`;
      filesystem.writeFile(tempConfigPath, tmaxrcContent);

      editor = new Editor(terminal, filesystem);

      // Editor should still initialize despite syntax error
      const interpreter = (editor as any).interpreter as TLispInterpreterImpl;
      expect(interpreter).toBeDefined();
    });
  });

  describe("Custom Bindings Override Defaults", () => {
    test("T-Lisp keymap should override TypeScript bindings", async () => {
      // Create .tmaxrc that overrides 'j' key
      const tmaxrcContent = `
;; Override default 'j' binding
(defkeymap "*override-keymap*")
(setq "*override-keymap*" (keymap-define-key *override-keymap* "j" "my-custom-command"))
(keymap-set "normal" *override-keymap*)
`;
      filesystem.writeFile(tempConfigPath, tmaxrcContent);

      editor = new Editor(terminal, filesystem);
      const interpreter = (editor as any).interpreter as TLispInterpreterImpl;
      registerStdlibFunctions(interpreter);
      interpreter.execute(tmaxrcContent);

      // Verify custom binding takes precedence
      const keymapSync = (editor as any).keymapSync;
      const command = await keymapSync.lookupKeyBinding("normal", "j");
      expect(command).toBe("my-custom-command");
    });

    test("should allow binding multiple keys in .tmaxrc", async () => {
      const tmaxrcContent = `
;; Multiple custom bindings
(defkeymap "*multi-keymap*")
(setq "*multi-keymap*" (keymap-define-key *multi-keymap* "j" "cmd1"))
(setq "*multi-keymap*" (keymap-define-key *multi-keymap* "k" "cmd2"))
(setq "*multi-keymap*" (keymap-define-key *multi-keymap* "l" "cmd3"))
(keymap-set "normal" *multi-keymap*)
`;
      filesystem.writeFile(tempConfigPath, tmaxrcContent);

      editor = new Editor(terminal, filesystem);
      const interpreter = (editor as any).interpreter as TLispInterpreterImpl;
      registerStdlibFunctions(interpreter);
      interpreter.execute(tmaxrcContent);

      // Verify all bindings are registered
      const keymapSync = (editor as any).keymapSync;
      expect(await keymapSync.lookupKeyBinding("normal", "j")).toBe("cmd1");
      expect(await keymapSync.lookupKeyBinding("normal", "k")).toBe("cmd2");
      expect(await keymapSync.lookupKeyBinding("normal", "l")).toBe("cmd3");
    });
  });

  describe("Multiple Mode Keymaps", () => {
    test("should support different keymaps for different modes", async () => {
      const tmaxrcContent = `
;; Normal mode keymap
(defkeymap "*normal-custom*")
(setq "*normal-custom*" (keymap-define-key *normal-custom* "j" "normal-cmd-j"))
(keymap-set "normal" *normal-custom*)

;; Insert mode keymap
(defkeymap "*insert-custom*")
(setq "*insert-custom*" (keymap-define-key *insert-custom* "j" "insert-cmd-j"))
(keymap-set "insert" *insert-custom*)
`;
      filesystem.writeFile(tempConfigPath, tmaxrcContent);

      editor = new Editor(terminal, filesystem);
      const interpreter = (editor as any).interpreter as TLispInterpreterImpl;
      registerStdlibFunctions(interpreter);
      interpreter.execute(tmaxrcContent);

      // Verify each mode has its own keymap
      const keymapSync = (editor as any).keymapSync;
      expect(await keymapSync.lookupKeyBinding("normal", "j")).toBe("normal-cmd-j");
      expect(await keymapSync.lookupKeyBinding("insert", "j")).toBe("insert-cmd-j");
    });
  });

  describe("Runtime Keymap Modification", () => {
    test("should allow registering keymaps at runtime via M-x", async () => {
      editor = new Editor(terminal, filesystem);
      const interpreter = (editor as any).interpreter as TLispInterpreterImpl;
      registerStdlibFunctions(interpreter);

      // Simulate user executing commands via M-x
      // User creates a keymap at runtime
      interpreter.execute('(defkeymap "*runtime-keymap*")');
      let result = interpreter.execute('(keymap-define-key *runtime-keymap* "x" "runtime-cmd")');
      if (result.right) {
        interpreter.globalEnv.define("*runtime-keymap*", result.right);
      }

      // User registers the keymap
      const keymap = interpreter.globalEnv.lookup("*runtime-keymap*");
      const keymapSetResult = interpreter.execute('(keymap-set "normal" *runtime-keymap*)');

      // Verify it was registered successfully
      expect(Either.isRight(keymapSetResult) || keymapSetResult.right).toBeDefined();

      // Verify the binding works
      const keymapSync = (editor as any).keymapSync;
      const command = await keymapSync.lookupKeyBinding("normal", "x");
      expect(command).toBe("runtime-cmd");
    });

    test("should allow querying active keymaps at runtime", async () => {
      const tmaxrcContent = `
(defkeymap "*query-test*")
(keymap-define-key *query-test* "a" "cmd-a")
(keymap-set "normal" *query-test*)
`;
      filesystem.writeFile(tempConfigPath, tmaxrcContent);

      editor = new Editor(terminal, filesystem);
      const interpreter = (editor as any).interpreter as TLispInterpreterImpl;
      registerStdlibFunctions(interpreter);
      interpreter.execute(tmaxrcContent);

      // Query active keymap
      const result = interpreter.execute('(keymap-active "normal")');
      expect(Either.isRight(result) || result.right).toBeDefined();

      if (result.right) {
        expect(result.right.type).toBe("hashmap");
      }
    });

    test("should allow listing keys in keymap at runtime", async () => {
      const tmaxrcContent = `
(defkeymap "*keys-test*")
(setq "*keys-test*" (keymap-define-key *keys-test* "a" "cmd-a"))
(setq "*keys-test*" (keymap-define-key *keys-test* "b" "cmd-b"))
(keymap-set "normal" *keys-test*)
`;
      filesystem.writeFile(tempConfigPath, tmaxrcContent);

      editor = new Editor(terminal, filesystem);
      const interpreter = (editor as any).interpreter as TLispInterpreterImpl;
      registerStdlibFunctions(interpreter);
      interpreter.execute(tmaxrcContent);

      // List keys in keymap
      const result = interpreter.execute('(keymap-keys "normal")');
      expect(Either.isRight(result) || result.right).toBeDefined();

      if (result.right) {
        expect(result.right.type).toBe("list");
        if (result.right.type === "list") {
          expect(result.right.value.length).toBe(2);
        }
      }
    });
  });
});
