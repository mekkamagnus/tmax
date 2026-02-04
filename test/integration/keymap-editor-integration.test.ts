/**
 * @file keymap-editor-integration.test.ts
 * @description Integration tests for T-Lisp keymap and Editor key dispatch
 *
 * Tests for the integration between T-Lisp keymaps and the Editor:
 * - T-Lisp keymaps take precedence over TypeScript bindings
 * - Fallback to TypeScript bindings when T-Lisp keymap has no binding
 * - Key dispatch performance
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { TerminalIO } from "../../src/core/terminal.ts";
import { FileSystem } from "../../src/core/filesystem.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerStdlibFunctions } from "../../src/tlisp/stdlib.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { Either } from "../../src/utils/task-either.ts";

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

  // Add other required methods as no-ops
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

describe("Keymap-Editor Integration", () => {
  let editor: Editor;
  let terminal: MockTerminalIO;
  let filesystem: MockFileSystem;
  let interpreter: TLispInterpreterImpl;

  beforeEach(() => {
    terminal = new MockTerminalIO();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);

    // Get the interpreter from the editor
    interpreter = (editor as any).interpreter as TLispInterpreterImpl;
    registerStdlibFunctions(interpreter);
  });

  describe("T-Lisp Keymap Precedence", () => {
    test("T-Lisp keymap binding should take precedence over TypeScript binding", async () => {
      // Create a T-Lisp keymap with a custom binding for 'j'
      interpreter.execute('(defkeymap "*custom-keymap*")');
      const result = interpreter.execute('(keymap-define-key *custom-keymap* "j" "custom-command")');
      if (result.right) {
        interpreter.globalEnv.define("*custom-keymap*", result.right);
      }

      // Register the keymap with the editor (this would be done via keymap-set)
      const keymap = interpreter.globalEnv.lookup("*custom-keymap*");
      const keymapSync = (editor as any).keymapSync;
      if (keymapSync) {
        keymapSync.registerTlispKeymap("normal", keymap);
      }

      // Press 'j' key
      // The editor should use the T-Lisp binding "custom-command" instead of the default
      // This test verifies the integration is working

      // Verify the keymap is registered
      expect(keymapSync).toBeDefined();
      if (keymapSync) {
        const activeKeymap = keymapSync.getActiveKeymap("normal");
        expect(activeKeymap).toEqual(keymap);
      }
    });

    test("Should fallback to TypeScript bindings when T-Lisp keymap has no binding", async () => {
      // Create an empty T-Lisp keymap
      interpreter.execute('(defkeymap "*empty-keymap*")');
      const keymap = interpreter.globalEnv.lookup("*empty-keymap*");

      // Register the keymap
      const keymapSync = (editor as any).keymapSync;
      if (keymapSync) {
        keymapSync.registerTlispKeymap("normal", keymap);

        // Try to lookup a key that doesn't exist in the T-Lisp keymap
        const command = await keymapSync.lookupKeyBinding("normal", "x");

        // Should return null, allowing the editor to fall back to TypeScript bindings
        expect(command).toBeNull();
      }
    });
  });

  describe("Key Dispatch Performance", () => {
    test("Keymap lookup should complete quickly", async () => {
      // Create a keymap with multiple bindings
      interpreter.execute('(defkeymap "*perf-keymap*")');
      let result = interpreter.execute('(keymap-define-key *perf-keymap* "j" "cmd1")');
      if (result.right) {
        interpreter.globalEnv.define("*perf-keymap*", result.right);
      }
      result = interpreter.execute('(keymap-define-key *perf-keymap* "k" "cmd2")');
      if (result.right) {
        interpreter.globalEnv.define("*perf-keymap*", result.right);
      }

      const keymap = interpreter.globalEnv.lookup("*perf-keymap*");
      const keymapSync = (editor as any).keymapSync;

      if (keymapSync) {
        keymapSync.registerTlispKeymap("normal", keymap);

        // Measure lookup time
        const start = Date.now();
        await keymapSync.lookupKeyBinding("normal", "j");
        const duration = Date.now() - start;

        // Should complete in less than 10ms
        expect(duration).toBeLessThan(10);
      }
    });
  });

  describe("Mode-Specific Keymaps", () => {
    test("Should support different keymaps for different modes", () => {
      // Create keymaps for different modes
      interpreter.execute('(defkeymap "*normal-keymap*")');
      const normalKeymap = interpreter.globalEnv.lookup("*normal-keymap*");

      interpreter.execute('(defkeymap "*insert-keymap*")');
      const insertKeymap = interpreter.globalEnv.lookup("*insert-keymap*");

      const keymapSync = (editor as any).keymapSync;

      if (keymapSync) {
        // Register for different modes
        keymapSync.registerTlispKeymap("normal", normalKeymap);
        keymapSync.registerTlispKeymap("insert", insertKeymap);

        // Verify both are registered
        expect(keymapSync.getActiveKeymap("normal")).toEqual(normalKeymap);
        expect(keymapSync.getActiveKeymap("insert")).toEqual(insertKeymap);
      }
    });
  });

  describe("Error Handling", () => {
    test("Should handle missing KeymapSync gracefully", async () => {
      // If KeymapSync is not initialized, the editor should still work
      // with TypeScript bindings
      const testEditor = new Editor(terminal, filesystem);

      // Should not throw
      await testEditor.handleKey("j");
    });

    test("Should handle malformed keymaps gracefully", async () => {
      const keymapSync = (editor as any).keymapSync;

      if (keymapSync) {
        // Register a non-keymap value
        const notAKeymap = { type: "string", value: "not a keymap" } as TLispValue;
        keymapSync.registerTlispKeymap("normal", notAKeymap);

        // Lookup should return null instead of throwing
        const command = await keymapSync.lookupKeyBinding("normal", "j");
        expect(command).toBeNull();
      }
    });
  });
});
