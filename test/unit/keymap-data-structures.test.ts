/**
 * @file keymap-data-structures.test.ts
 * @description Tests for T-Lisp keymap data structures functionality
 * 
 * Tests for US-0.4.1: T-Lisp Keymap Data Structures
 * - keymap-get function returns nested alist structure when inspected
 * - defkeymap my-mode-map creates a new keymap in T-Lisp
 * - keymap-define-key adds binding to existing keymap
 * - keymap-lookup returns command bound to key
 * - Keymap objects have mode, parent, and bindings properties
 */

import { describe, test, expect } from "bun:test";
import { createHashmap, isHashmap, createNil, createString, createList } from "../../src/tlisp/values.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerStdlibFunctions } from "../../src/tlisp/stdlib.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("T-Lisp Keymap Data Structures - US-0.4.1", () => {
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

  test("keymap-get function returns nested alist structure when inspected", () => {
    // Create a keymap using defkeymap
    exec('(defkeymap "*test-keymap*")');
    
    // Get the keymap
    const keymap = interpreter.globalEnv.lookup("*test-keymap*");
    expect(keymap).toBeDefined();
    expect(keymap.type).toBe("hashmap");
    
    // Test keymap-get to retrieve properties
    const modeResult = exec('(keymap-get *test-keymap* "mode")');
    expect(modeResult.type).toBe("string");
    if (modeResult.type === "string") {
      expect(modeResult.value).toBe("unknown");
    }
    
    const parentResult = exec('(keymap-get *test-keymap* "parent")');
    expect(parentResult.type).toBe("nil");
    
    const bindingsResult = exec('(keymap-get *test-keymap* "bindings")');
    expect(bindingsResult.type).toBe("hashmap");
  });

  test("defkeymap creates a new keymap in T-Lisp", () => {
    // Create a new keymap
    exec('(defkeymap "*my-mode-map*")');
    
    // Verify the keymap exists
    const keymap = interpreter.globalEnv.lookup("*my-mode-map*");
    expect(keymap).toBeDefined();
    expect(keymap.type).toBe("hashmap");
    
    // Verify it has the required properties
    if (isHashmap(keymap)) {
      expect(keymap.value.has("mode")).toBe(true);
      expect(keymap.value.has("parent")).toBe(true);
      expect(keymap.value.has("bindings")).toBe(true);
    }
  });

  test("keymap-define-key adds binding to existing keymap", () => {
    // Create a keymap first
    exec('(defkeymap "*test-mode-map*")');
    
    // Add a binding to the keymap
    const updatedKeymap = exec('(keymap-define-key *test-mode-map* "k" "cursor-up")');
    expect(updatedKeymap.type).toBe("hashmap");

    if (isHashmap(updatedKeymap)) {
      const bindings = updatedKeymap.value.get("bindings");
      expect(bindings).toBeDefined();
      expect(bindings.type).toBe("hashmap");

      if (isHashmap(bindings)) {
        const command = bindings.value.get("k");
        expect(command).toBeDefined();
        expect(command.type).toBe("string");
        if (command.type === "string") {
          expect(command.value).toBe("cursor-up");
        }
      }
    }
  });

  test("keymap-lookup returns command bound to key", () => {
    // Create a keymap and add a binding
    exec('(defkeymap "*lookup-test-map*")');
    const keymapWithBinding = exec('(keymap-define-key *lookup-test-map* "j" "cursor-down")');
    
    // Manually set the updated keymap in the environment for testing
    interpreter.globalEnv.define("*lookup-test-map*", keymapWithBinding);
    
    // Lookup the command for the key
    const command = exec('(keymap-lookup *lookup-test-map* "j")');
    expect(command.type).toBe("string");
    if (command.type === "string") {
      expect(command.value).toBe("cursor-down");
    }
    
    // Test lookup for non-existent key
    const missingCommand = exec('(keymap-lookup *lookup-test-map* "x")');
    expect(missingCommand.type).toBe("nil");
  });

  test("Keymap objects have mode, parent, and bindings properties", () => {
    // Create a keymap
    exec('(defkeymap "*props-test-map*")');
    
    const keymap = interpreter.globalEnv.lookup("*props-test-map*");
    expect(keymap).toBeDefined();
    expect(keymap.type).toBe("hashmap");
    
    if (isHashmap(keymap)) {
      // Check that all three properties exist
      expect(keymap.value.has("mode")).toBe(true);
      expect(keymap.value.has("parent")).toBe(true);
      expect(keymap.value.has("bindings")).toBe(true);
      
      // Check their types
      const mode = keymap.value.get("mode");
      const parent = keymap.value.get("parent");
      const bindings = keymap.value.get("bindings");
      
      expect(mode.type).toBe("string");
      expect(parent.type).toBe("nil");
      expect(bindings.type).toBe("hashmap");
    }
  });
});