/**
 * @file hashmap.test.ts
 * @description Tests for T-Lisp hash-map data structure and standard library functions
 */

import { assertEquals, assertExists } from "@std/assert";
import { createHashmap, isHashmap } from "../../src/tlisp/values.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerStdlibFunctions } from "../../src/tlisp/stdlib.ts";

Deno.test("Hash-Map Data Structure", async (t) => {
  const interpreter = new TLispInterpreterImpl();
  registerStdlibFunctions(interpreter);

  await t.step("should create empty hash-map", () => {
    const result = interpreter.execute("(hashmap)");
    assertEquals(result.type, "hashmap");
    if (isHashmap(result)) {
      assertEquals(result.value.size, 0);
    }
  });

  await t.step("should create hash-map with string key-value pairs", () => {
    const result = interpreter.execute('(hashmap "a" 1 "b" 2)');
    assertEquals(result.type, "hashmap");
    if (isHashmap(result)) {
      assertEquals(result.value.size, 2);
      assertEquals(result.value.get("a")?.type, "number");
      assertEquals(result.value.get("b")?.type, "number");
    }
  });

  await t.step("should evaluate values in hash-map", () => {
    const result = interpreter.execute("(hashmap \"double\" (* 2 5))");
    assertEquals(result.type, "hashmap");
    if (isHashmap(result)) {
      const value = result.value.get("double");
      assertExists(value);
      assertEquals(value.type, "number");
      if (value.type === "number") {
        assertEquals(value.value, 10);
      }
    }
  });

  await t.step("should throw error for odd number of arguments", () => {
    let errorThrown = false;
    try {
      interpreter.execute('(hashmap "a" 1 "b")');
    } catch (error) {
      errorThrown = true;
    }
    assertEquals(errorThrown, true);
  });
});

Deno.test("Hash-Map Standard Library Functions", async (t) => {
  const interpreter = new TLispInterpreterImpl();
  registerStdlibFunctions(interpreter);

  await t.step("hashmap-get should retrieve value by key", () => {
    const testMap = interpreter.execute('(hashmap "a" 1 "b" 2)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = interpreter.execute('(hashmap-get *test-map* "a")');
    assertEquals(result.type, "number");
    if (result.type === "number") {
      assertEquals(result.value, 1);
    }
  });

  await t.step("hashmap-get should return nil for missing key", () => {
    const testMap = interpreter.execute('(hashmap "a" 1)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = interpreter.execute('(hashmap-get *test-map* "missing")');
    assertEquals(result.type, "nil");
  });

  await t.step("hashmap-set should add new key-value pair", () => {
    const testMap = interpreter.execute('(hashmap)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = interpreter.execute('(hashmap-set *test-map* "new" 42)');
    assertEquals(result.type, "hashmap");
    if (isHashmap(result)) {
      assertEquals(result.value.size, 1);
      const value = result.value.get("new");
      assertExists(value);
      assertEquals(value.type, "number");
      if (value.type === "number") {
        assertEquals(value.value, 42);
      }
    }
  });

  await t.step("hashmap-set should overwrite existing key", () => {
    const testMap = interpreter.execute('(hashmap "a" 1)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = interpreter.execute('(hashmap-set *test-map* "a" 999)');
    assertEquals(result.type, "hashmap");
    if (isHashmap(result)) {
      assertEquals(result.value.size, 1);
      const value = result.value.get("a");
      assertExists(value);
      assertEquals(value.type, "number");
      if (value.type === "number") {
        assertEquals(value.value, 999);
      }
    }
  });

  await t.step("hashmap-keys should return list of all keys", () => {
    const testMap = interpreter.execute('(hashmap "a" 1 "b" 2 "c" 3)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = interpreter.execute('(hashmap-keys *test-map*)');
    assertEquals(result.type, "list");
    if (result.type === "list") {
      const listValue = result.value as TLispValue[];
      assertEquals(listValue.length, 3);
      // Check that all values are strings
      for (const item of listValue) {
        assertEquals(item.type, "string");
      }
    }
  });

  await t.step("hashmap-values should return list of all values", () => {
    const testMap = interpreter.execute('(hashmap "a" 1 "b" 2)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = interpreter.execute('(hashmap-values *test-map*)');
    assertEquals(result.type, "list");
    if (result.type === "list") {
      const listValue = result.value as TLispValue[];
      assertEquals(listValue.length, 2);
    }
  });

  await t.step("hashmap-has-key? should return true for existing key", () => {
    const testMap = interpreter.execute('(hashmap "exists" 123)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = interpreter.execute('(hashmap-has-key? *test-map* "exists")');
    assertEquals(result.type, "boolean");
    if (result.type === "boolean") {
      assertEquals(result.value, true);
    }
  });

  await t.step("hashmap-has-key? should return false for missing key", () => {
    const testMap = interpreter.execute('(hashmap "a" 1)');
    interpreter.globalEnv.define("*test-map*", testMap);
    const result = interpreter.execute('(hashmap-has-key? *test-map* "missing")');
    assertEquals(result.type, "boolean");
    if (result.type === "boolean") {
      assertEquals(result.value, false);
    }
  });

  await t.step("hashmap functions should throw error for non-hashmap argument", () => {
    let errorThrown = false;
    try {
      interpreter.execute('(hashmap-get "not-a-map" "key")');
    } catch (error) {
      errorThrown = true;
    }
    assertEquals(errorThrown, true);
  });
});

Deno.test("Editor Keymap Variables", async (t) => {
  // Note: These tests verify that keymap variables can be created and accessed
  // Full editor initialization is tested in editor.test.ts

  await t.step("should create keymap variables as hash-maps", () => {
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

    assertExists(normalKeymap);
    assertExists(insertKeymap);
    assertExists(globalKeymap);

    assertEquals(normalKeymap.type, "hashmap");
    assertEquals(insertKeymap.type, "hashmap");
    assertEquals(globalKeymap.type, "hashmap");
  });

  await t.step("should initialize all six keymap variables", () => {
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
      assertExists(keymap);
      assertEquals(keymap.type, "hashmap");
      if (isHashmap(keymap)) {
        assertEquals(keymap.value.size, 0);
      }
    }
  });
});
