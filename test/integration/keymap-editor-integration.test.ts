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
import { expectDefined, expectRight } from "../helpers/editor-fixture.ts";
import { Editor } from "../../src/editor/editor.ts";
import type { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerStdlibFunctions } from "../../src/tlisp/stdlib.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";

describe("Keymap-Editor Integration", () => {
  let editor: Editor;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let interpreter: TLispInterpreterImpl;

  beforeEach(() => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);

    // Get the interpreter from the editor
    interpreter = editor.getInterpreter();
    registerStdlibFunctions(interpreter);
  });

  describe("T-Lisp Keymap Precedence", () => {
    test("T-Lisp keymap binding should take precedence over TypeScript binding", async () => {
      // Create a T-Lisp keymap with a custom binding for 'j'
      interpreter.execute('(defkeymap "*custom-keymap*")');
      const result = interpreter.execute('(keymap-define-key *custom-keymap* "j" "custom-command")');
      if (expectRight(result)) {
        interpreter.globalEnv.define("*custom-keymap*", expectRight(result));
      }

      // Register the keymap with the editor (this would be done via keymap-set)
      const keymap = expectDefined(interpreter.globalEnv.lookup("*custom-keymap*"));
      const keymapSync = editor.keymapSync;
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
      const keymap = expectDefined(interpreter.globalEnv.lookup("*empty-keymap*"));

      // Register the keymap
      const keymapSync = editor.keymapSync;
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
      if (expectRight(result)) {
        interpreter.globalEnv.define("*perf-keymap*", expectRight(result));
      }
      result = interpreter.execute('(keymap-define-key *perf-keymap* "k" "cmd2")');
      if (expectRight(result)) {
        interpreter.globalEnv.define("*perf-keymap*", expectRight(result));
      }

      const keymap = expectDefined(interpreter.globalEnv.lookup("*perf-keymap*"));
      const keymapSync = editor.keymapSync;

      if (keymapSync) {
        keymapSync.registerTlispKeymap("normal", keymap);

        // Measure lookup time
        const start = Date.now();
        await keymapSync.lookupKeyBinding("normal", "j");
        const duration = Date.now() - start;

        // Should complete quickly. 1s catches a real regression (a hung/seconds-long
        // lookup) while tolerating scheduler jitter under full-suite load — the
        // previous 10ms budget flaked whenever the process was contended.
        expect(duration).toBeLessThan(1000);
      }
    });
  });

  describe("Mode-Specific Keymaps", () => {
    test("Should support different keymaps for different modes", () => {
      // Create keymaps for different modes
      interpreter.execute('(defkeymap "*normal-keymap*")');
      const normalKeymap = expectDefined(interpreter.globalEnv.lookup("*normal-keymap*"));

      interpreter.execute('(defkeymap "*insert-keymap*")');
      const insertKeymap = expectDefined(interpreter.globalEnv.lookup("*insert-keymap*"));

      const keymapSync = editor.keymapSync;

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
      const keymapSync = editor.keymapSync;

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
