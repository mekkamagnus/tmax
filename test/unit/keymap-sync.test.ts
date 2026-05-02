/**
 * @file keymap-sync.test.ts
 * @description Tests for KeymapSync bridge layer between T-Lisp keymaps and Editor
 *
 * Tests for KeymapSync functionality:
 * - Register T-Lisp keymap with Editor for a mode
 * - Query T-Lisp keymap for a key (used during key dispatch)
 * - Get active keymap for current mode
 * - Fallback to TypeScript bindings when T-Lisp keymap has no binding
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { KeymapSync } from "../../src/editor/keymap-sync.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerStdlibFunctions } from "../../src/tlisp/stdlib.ts";
import { createHashmap, createString, createNil } from "../../src/tlisp/values.ts";

describe("KeymapSync - Bridge Layer", () => {
  let interpreter: TLispInterpreterImpl;
  let keymapSync: KeymapSync;

  beforeEach(() => {
    interpreter = new TLispInterpreterImpl();
    registerStdlibFunctions(interpreter);
    keymapSync = new KeymapSync(interpreter);
  });

  describe("registerTlispKeymap", () => {
    test("should register a T-Lisp keymap for a mode", () => {
      // Create a keymap in T-Lisp
      interpreter.execute('(defkeymap "*test-keymap*")');
      const keymap = interpreter.globalEnv.lookup("*test-keymap*");

      // Register with KeymapSync
      keymapSync.registerTlispKeymap("normal", keymap);

      // Verify registration
      const activeKeymap = keymapSync.getActiveKeymap("normal");
      expect(activeKeymap).toBeDefined();
      expect(activeKeymap?.type).toBe("hashmap");
    });

    test("should replace existing keymap for a mode", () => {
      // Create and register first keymap
      interpreter.execute('(defkeymap "*first-keymap*")');
      const firstKeymap = interpreter.globalEnv.lookup("*first-keymap*");
      keymapSync.registerTlispKeymap("normal", firstKeymap);

      // Create and register second keymap
      interpreter.execute('(defkeymap "*second-keymap*")');
      const secondKeymap = interpreter.globalEnv.lookup("*second-keymap*");
      keymapSync.registerTlispKeymap("normal", secondKeymap);

      // Verify second keymap replaced first
      const activeKeymap = keymapSync.getActiveKeymap("normal");
      expect(activeKeymap).toBeDefined();
      expect(activeKeymap).toEqual(secondKeymap);
    });

    test("should support multiple modes with different keymaps", () => {
      // Create keymaps for different modes
      interpreter.execute('(defkeymap "*normal-keymap*")');
      const normalKeymap = interpreter.globalEnv.lookup("*normal-keymap*");

      interpreter.execute('(defkeymap "*insert-keymap*")');
      const insertKeymap = interpreter.globalEnv.lookup("*insert-keymap*");

      // Register for different modes
      keymapSync.registerTlispKeymap("normal", normalKeymap);
      keymapSync.registerTlispKeymap("insert", insertKeymap);

      // Verify both are registered
      expect(keymapSync.getActiveKeymap("normal")).toEqual(normalKeymap);
      expect(keymapSync.getActiveKeymap("insert")).toEqual(insertKeymap);
    });
  });

  describe("lookupKeyBinding", () => {
    test("should return command for key in T-Lisp keymap", async () => {
      // Create a keymap with a binding
      interpreter.execute('(defkeymap "*lookup-keymap*")');

      // Execute keymap-define-key and update the environment
      const result = interpreter.execute('(keymap-define-key *lookup-keymap* "j" "cursor-down")');
      // Store the updated keymap back in the environment
      if (result.right && result.right.type === "hashmap") {
        interpreter.globalEnv.define("*lookup-keymap*", result.right);
      }

      const keymap = interpreter.globalEnv.lookup("*lookup-keymap*");
      keymapSync.registerTlispKeymap("normal", keymap);

      // Lookup the binding
      const command = await keymapSync.lookupKeyBinding("normal", "j");

      expect(command).toBe("cursor-down");
    });

    test("should return null for non-existent key", async () => {
      // Create a keymap without the key
      interpreter.execute('(defkeymap "*empty-keymap*")');
      const keymap = interpreter.globalEnv.lookup("*empty-keymap*");
      keymapSync.registerTlispKeymap("normal", keymap);

      // Lookup non-existent key
      const command = await keymapSync.lookupKeyBinding("normal", "x");

      expect(command).toBeNull();
    });

    test("should return null for mode with no registered keymap", async () => {
      // Don't register any keymap for "visual" mode
      const command = await keymapSync.lookupKeyBinding("visual", "j");

      expect(command).toBeNull();
    });

    test("should handle keymap with multiple bindings", async () => {
      // Create keymap with multiple bindings
      interpreter.execute('(defkeymap "*multi-keymap*")');

      // Add bindings sequentially, updating the environment each time
      let result = interpreter.execute('(keymap-define-key *multi-keymap* "j" "cursor-down")');
      if (result.right && result.right.type === "hashmap") {
        interpreter.globalEnv.define("*multi-keymap*", result.right);
      }

      result = interpreter.execute('(keymap-define-key *multi-keymap* "k" "cursor-up")');
      if (result.right && result.right.type === "hashmap") {
        interpreter.globalEnv.define("*multi-keymap*", result.right);
      }

      result = interpreter.execute('(keymap-define-key *multi-keymap* "l" "cursor-right")');
      if (result.right && result.right.type === "hashmap") {
        interpreter.globalEnv.define("*multi-keymap*", result.right);
      }

      const keymap = interpreter.globalEnv.lookup("*multi-keymap*");
      keymapSync.registerTlispKeymap("normal", keymap);

      // Lookup each binding
      expect(await keymapSync.lookupKeyBinding("normal", "j")).toBe("cursor-down");
      expect(await keymapSync.lookupKeyBinding("normal", "k")).toBe("cursor-up");
      expect(await keymapSync.lookupKeyBinding("normal", "l")).toBe("cursor-right");
    });
  });

  describe("getActiveKeymap", () => {
    test("should return null for mode with no registered keymap", () => {
      const keymap = keymapSync.getActiveKeymap("normal");
      expect(keymap).toBeNull();
    });

    test("should return registered keymap for mode", () => {
      interpreter.execute('(defkeymap "*active-keymap*")');
      const keymap = interpreter.globalEnv.lookup("*active-keymap*");
      keymapSync.registerTlispKeymap("insert", keymap);

      const active = keymapSync.getActiveKeymap("insert");
      expect(active).toEqual(keymap);
    });
  });

  describe("Error Handling", () => {
    test("should handle malformed keymap gracefully", async () => {
      // Create a non-keymap value
      const notAKeymap = createString("not a keymap");

      keymapSync.registerTlispKeymap("normal", notAKeymap);

      // Lookup should return null for malformed keymap
      const command = await keymapSync.lookupKeyBinding("normal", "j");
      expect(command).toBeNull();
    });

    test("should handle keymap lookup errors gracefully", async () => {
      // Create a keymap that will cause errors during lookup
      interpreter.execute('(defkeymap "*error-keymap*")');
      const keymap = interpreter.globalEnv.lookup("*error-keymap*");

      // Manually corrupt the keymap to simulate errors
      if (keymap.type === "hashmap") {
        // Remove the bindings property
        keymap.value.delete("bindings");
      }

      keymapSync.registerTlispKeymap("normal", keymap);

      // Lookup should return null instead of throwing
      const command = await keymapSync.lookupKeyBinding("normal", "j");
      expect(command).toBeNull();
    });
  });
});
