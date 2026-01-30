/**
 * @file hashmap.test.ts
 * @description Tests for T-Lisp hash-map data structure and standard library functions
 */

import { describe, test, expect } from "bun:test";
import { createHashmap, isHashmap } from "../../src/tlisp/values.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerStdlibFunctions } from "../../src/tlisp/stdlib.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Hash-Map Data Structure", () => {
  const interpreter = new TLispInterpreterImpl();
  registerStdlibFunctions(interpreter);

  // Helper to execute code and extract .right value
  const exec = (code: string) => {
    const result = interpreter.execute(code);
    if (Either.isLeft(result)) {
      const error = result.left;
      const errorMsg = typeof error === 'object' ? JSON.stringify(error) : String(error);
      throw new Error(`Execution error: ${errorMsg}`);
    }
    return result.right;
  };

  test("should create empty hash-map", () => {
    const result = exec("(hashmap)");
    expect(result.type).toBe("hashmap");
    if (isHashmap(result)) {
      expect(result.value.size).toBe(0);
    }
  });

  test("should create hash-map with string key-value pairs", () => {
    const result = exec('(hashmap "a" 1 "b" 2)');
    expect(result.type).toBe("hashmap");
    if (isHashmap(result)) {
      expect(result.value.size).toBe(2);
      expect(result.value.get("a")?.type).toBe("number");
      expect(result.value.get("b")?.type).toBe("number");
    }
  });

  test("should evaluate values in hash-map", () => {
    const result = exec("(hashmap \"double\" (* 2 5))");
    expect(result.type).toBe("hashmap");
    if (isHashmap(result)) {
      const value = result.value.get("double");
      expect(value).toBeDefined();
      expect(value.type).toBe("number");
      if (value.type === "number") {
        expect(value.value).toBe(10);
      }
    }
  });

  test("should throw error for odd number of arguments", () => {
    let errorThrown = false;
    try {
      exec('(hashmap "a" 1 "b")');
    } catch (error) {
      errorThrown = true;
    }
    expect(errorThrown).toBe(true);
  });
});

describe("Hash-Map Standard Library Functions", () => {
  const interpreter = new TLispInterpreterImpl();
  registerStdlibFunctions(interpreter);

  // Helper to execute code and extract .right value
  const exec = (code: string) => {
    const result = interpreter.execute(code);
    if (Either.isLeft(result)) {
      const error = result.left;
      const errorMsg = typeof error === 'object' ? JSON.stringify(error) : String(error);
      throw new Error(`Execution error: ${errorMsg}`);
    }
    return result.right;
  };

  test("hashmap-get should retrieve value by key", () => {
    const testMap = exec('(hashmap "a" 1 "b" 2)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = exec('(hashmap-get *test-map* "a")');
    expect(result.type).toBe("number");
    if (result.type === "number") {
      expect(result.value).toBe(1);
    }
  });

  test("hashmap-get should return nil for missing key", () => {
    const testMap = exec('(hashmap "a" 1)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = exec('(hashmap-get *test-map* "missing")');
    expect(result.type).toBe("nil");
  });

  test("hashmap-set should add new key-value pair", () => {
    const testMap = exec('(hashmap)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = exec('(hashmap-set *test-map* "new" 42)');
    expect(result.type).toBe("hashmap");
    if (isHashmap(result)) {
      expect(result.value.size).toBe(1);
      const value = result.value.get("new");
      expect(value).toBeDefined();
      expect(value.type).toBe("number");
      if (value.type === "number") {
        expect(value.value).toBe(42);
      }
    }
  });

  test("hashmap-set should overwrite existing key", () => {
    const testMap = exec('(hashmap "a" 1)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = exec('(hashmap-set *test-map* "a" 999)');
    expect(result.type).toBe("hashmap");
    if (isHashmap(result)) {
      expect(result.value.size).toBe(1);
      const value = result.value.get("a");
      expect(value).toBeDefined();
      expect(value.type).toBe("number");
      if (value.type === "number") {
        expect(value.value).toBe(999);
      }
    }
  });

  test("hashmap-keys should return list of all keys", () => {
    const testMap = exec('(hashmap "a" 1 "b" 2 "c" 3)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = exec('(hashmap-keys *test-map*)');
    expect(result.type).toBe("list");
    if (result.type === "list") {
      const listValue = result.value as TLispValue[];
      expect(listValue.length).toBe(3);
      // Check that all values are strings
      for (const item of listValue) {
        expect(item.type).toBe("string");
      }
    }
  });

  test("hashmap-values should return list of all values", () => {
    const testMap = exec('(hashmap "a" 1 "b" 2)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = exec('(hashmap-values *test-map*)');
    expect(result.type).toBe("list");
    if (result.type === "list") {
      const listValue = result.value as TLispValue[];
      expect(listValue.length).toBe(2);
    }
  });

  test("hashmap-has-key? should return true for existing key", () => {
    const testMap = exec('(hashmap "exists" 123)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = exec('(hashmap-has-key? *test-map* "exists")');
    expect(result.type).toBe("boolean");
    if (result.type === "boolean") {
      expect(result.value).toBe(true);
    }
  });

  test("hashmap-has-key? should return false for missing key", () => {
    const testMap = exec('(hashmap "a" 1)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = exec('(hashmap-has-key? *test-map* "missing")');
    expect(result.type).toBe("boolean");
    if (result.type === "boolean") {
      expect(result.value).toBe(false);
    }
  });

  test("hashmap functions should throw error for non-hashmap argument", () => {
    let errorThrown = false;
    try {
      exec('(hashmap-get "not-a-map" "key")');
    } catch (error) {
      errorThrown = true;
    }
    expect(errorThrown).toBe(true);
  });
});

describe("Editor Keymap Variables", () => {
  // Note: These tests verify that keymap variables can be created and accessed
  // Full editor initialization is tested in editor.test.ts

  test("should create keymap variables as hash-maps", () => {
    const interpreter = new TLispInterpreterImpl();

    // Create keymap variables manually (simulating what editor does)
    const emptyKeymap = createHashmap([]);
    interpreter.globalEnv.define("*normal-mode-keymap*", emptyKeymap);
    interpreter.globalEnv.define("*insert-mode-keymap*", emptyKeymap);
    interpreter.globalEnv.define("*global-keymap*", emptyKeymap);

    // Verify they exist and are hash-maps
    const normalKeymap = interpreter.globalEnv.lookup("*normal-mode-keymap*");
    const insertKeymap = interpreter.globalEnv.lookup("*insert-mode-keymap*");
    const globalKeymap = interpreter.globalEnv.lookup("*global-keymap*");

    expect(normalKeymap).toBeDefined();
    expect(insertKeymap).toBeDefined();
    expect(globalKeymap).toBeDefined();

    expect(normalKeymap.type).toBe("hashmap");
    expect(insertKeymap.type).toBe("hashmap");
    expect(globalKeymap.type).toBe("hashmap");
  });

  test("should initialize all six keymap variables", () => {
    const interpreter = new TLispInterpreterImpl();

    // Create all six keymap variables
    const emptyKeymap = createHashmap([]);
    const keymapNames = [
      "*global-keymap*",
      "*normal-mode-keymap*",
      "*insert-mode-keymap*",
      "*visual-mode-keymap*",
      "*command-mode-keymap*",
      "*mx-mode-keymap*",
    ];

    for (const name of keymapNames) {
      interpreter.globalEnv.define(name, emptyKeymap);
    }

    // Verify all exist
    for (const name of keymapNames) {
      const keymap = interpreter.globalEnv.lookup(name);
      expect(keymap).toBeDefined();
      expect(keymap.type).toBe("hashmap");
      if (isHashmap(keymap)) {
        expect(keymap.value.size).toBe(0);
      }
    }
  });
});
