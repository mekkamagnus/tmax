/**
 * @file keymap-ops.test.ts
 * @description Tests for T-Lisp keymap operations API
 *
 * Tests for keymap-ops API functions:
 * - keymap-set: Register T-Lisp keymap with Editor for a mode
 * - keymap-keys: List all bindings in a keymap
 * - keymap-active: Get active keymap for current mode
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerStdlibFunctions } from "../../src/tlisp/stdlib.ts";
import { createKeymapOps } from "../../src/editor/api/keymap-ops.ts";
import type { KeymapSync } from "../../src/editor/keymap-sync.ts";
import { createString, createList, createNil } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

// Mock KeymapSync for testing
class MockKeymapSync implements Partial<KeymapSync> {
  registeredKeymaps: Map<string, any> = new Map();

  registerTlispKeymap(mode: string, keymap: any): void {
    this.registeredKeymaps.set(mode, keymap);
  }

  getActiveKeymap(mode: string): any {
    return this.registeredKeymaps.get(mode) || null;
  }

  lookupKeyBinding(_mode: string, _key: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  hasKeymap(mode: string): boolean {
    return this.registeredKeymaps.has(mode);
  }

  unregisterKeymap(mode: string): void {
    this.registeredKeymaps.delete(mode);
  }

  clearAllKeymaps(): void {
    this.registeredKeymaps.clear();
  }
}

describe("keymap-ops API", () => {
  let interpreter: TLispInterpreterImpl;
  let keymapSync: MockKeymapSync;

  beforeEach(() => {
    interpreter = new TLispInterpreterImpl();
    registerStdlibFunctions(interpreter);
    keymapSync = new MockKeymapSync();
  });

  describe("keymap-set", () => {
    test("should register keymap with Editor for a mode", () => {
      // Create a keymap
      interpreter.execute('(defkeymap "*my-keymap*")');
      const keymap = interpreter.globalEnv.lookup("*my-keymap*");

      // Create keymap-ops API
      const keymapOps = createKeymapOps(interpreter, keymapSync as KeymapSync);

      // Get the keymap-set function
      const keymapSetFn = keymapOps.get("keymap-set");
      expect(keymapSetFn).toBeDefined();

      // Call keymap-set (the value is the function itself)
      const result = (keymapSetFn as Function)([
        createString("normal"),
        keymap
      ]);

      // Verify it succeeded (returns string with mode name)
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.type).toBe("string");
        if (result.right.type === "string") {
          expect(result.right.value).toContain("normal");
        }
      }

      // Verify keymap was registered with KeymapSync
      expect(keymapSync.hasKeymap("normal")).toBe(true);
    });

    test("should handle invalid mode gracefully", () => {
      const keymapOps = createKeymapOps(interpreter, keymapSync as KeymapSync);
      const keymapSetFn = keymapOps.get("keymap-set");

      const result = (keymapSetFn as Function)([
        createString("invalid-mode"),
        createNil()
      ]);

      // Should return error
      expect(Either.isLeft(result)).toBe(true);
    });

    test("should handle invalid keymap gracefully", () => {
      const keymapOps = createKeymapOps(interpreter, keymapSync as KeymapSync);
      const keymapSetFn = keymapOps.get("keymap-set");

      // Pass a non-keymap value
      const result = (keymapSetFn as Function)([
        createString("normal"),
        createString("not a keymap")
      ]);

      // Should return error
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  describe("keymap-keys", () => {
    test("should return list of keys in keymap", () => {
      // Create a keymap with bindings
      interpreter.execute('(defkeymap "*keys-test-keymap*")');
      let result = interpreter.execute('(keymap-define-key *keys-test-keymap* "j" "cursor-down")');
      if (result.right) {
        interpreter.globalEnv.define("*keys-test-keymap*", result.right);
      }
      result = interpreter.execute('(keymap-define-key *keys-test-keymap* "k" "cursor-up")');
      if (result.right) {
        interpreter.globalEnv.define("*keys-test-keymap*", result.right);
      }

      const keymap = interpreter.globalEnv.lookup("*keys-test-keymap*");
      keymapSync.registerTlispKeymap("normal", keymap);

      const keymapOps = createKeymapOps(interpreter, keymapSync as KeymapSync);
      const keymapKeysFn = keymapOps.get("keymap-keys");

      const keysResult = (keymapKeysFn as Function)([
        createString("normal")
      ]);

      // Should return a list of keys
      expect(Either.isRight(keysResult)).toBe(true);
      if (Either.isRight(keysResult)) {
        expect(keysResult.right.type).toBe("list");
        if (keysResult.right.type === "list") {
          const keys = keysResult.right.value;
          expect(keys.length).toBe(2);
          // Check that keys are strings
          expect(keys[0].type).toBe("string");
          expect(keys[1].type).toBe("string");
        }
      }
    });

    test("should handle mode with no keymap", () => {
      const keymapOps = createKeymapOps(interpreter, keymapSync as KeymapSync);
      const keymapKeysFn = keymapOps.get("keymap-keys");

      const result = (keymapKeysFn as Function)([
        createString("insert")
      ]);

      // Should return error or empty list
      expect(Either.isLeft(result)).toBe(true);
    });

    test("should handle keymap with no bindings", () => {
      // Create empty keymap
      interpreter.execute('(defkeymap "*empty-keymap*")');
      const keymap = interpreter.globalEnv.lookup("*empty-keymap*");
      keymapSync.registerTlispKeymap("normal", keymap);

      const keymapOps = createKeymapOps(interpreter, keymapSync as KeymapSync);
      const keymapKeysFn = keymapOps.get("keymap-keys");

      const result = (keymapKeysFn as Function)([
        createString("normal")
      ]);

      // Should return empty list
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.type).toBe("list");
        if (result.right.type === "list") {
          expect(result.right.value.length).toBe(0);
        }
      }
    });
  });

  describe("keymap-active", () => {
    test("should return active keymap for mode", () => {
      // Create and register a keymap
      interpreter.execute('(defkeymap "*active-keymap*")');
      const keymap = interpreter.globalEnv.lookup("*active-keymap*");
      keymapSync.registerTlispKeymap("normal", keymap);

      const keymapOps = createKeymapOps(interpreter, keymapSync as KeymapSync);
      const keymapActiveFn = keymapOps.get("keymap-active");

      const result = (keymapActiveFn as Function)([
        createString("normal")
      ]);

      // Should return the keymap
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.type).toBe("hashmap");
      }
    });

    test("should return nil for mode with no keymap", () => {
      const keymapOps = createKeymapOps(interpreter, keymapSync as KeymapSync);
      const keymapActiveFn = keymapOps.get("keymap-active");

      const result = (keymapActiveFn as Function)([
        createString("visual")
      ]);

      // Should return nil
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.type).toBe("nil");
      }
    });
  });
});
