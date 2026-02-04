/**
 * @file stdlib.ts
 * @description T-Lisp Standard Library Functions
 *
 * This file contains all built-in T-Lisp standard library functions.
 * These functions provide core functionality for hash-map manipulation,
 * and will be expanded to include additional utility functions in the future.
 *
 * Usage:
 *   import { registerStdlibFunctions } from "./stdlib.ts";
 *   registerStdlibFunctions(interpreter);
 *
 * The standard library functions are automatically registered with the
 * interpreter's global environment, making them available to all T-Lisp code.
 */

import type { TLispInterpreter, TLispValue } from "./types.ts";
import {
  createBoolean,
  createHashmap,
  createList,
  createNil,
  createString,
  isHashmap,
} from "./values.ts";

/**
 * Register all standard library functions with the T-Lisp interpreter
 * @param interpreter - The T-Lisp interpreter instance
 *
 * This function registers all built-in standard library functions
 * by calling interpreter.defineBuiltin() for each function.
 *
 * Standard library functions include:
 * - Hash-map manipulation (hashmap-get, hashmap-set, hashmap-keys, etc.)
 *
 * More functions will be added here as the standard library expands.
 */
export function registerStdlibFunctions(interpreter: TLispInterpreter): void {
  /**
   * Create a hash-map from key-value pairs
   * Usage: (hashmap key1 value1 key2 value2 ...)
   * Returns a new hash-map with the given key-value pairs
   * Requires an even number of arguments
   */
  interpreter.defineBuiltin("hashmap", (args: TLispValue[]): TLispValue => {
    if (args.length % 2 !== 0) {
      throw new Error("hashmap requires an even number of arguments: key-value pairs");
    }

    const entries: [string, TLispValue][] = [];

    for (let i = 0; i < args.length; i += 2) {
      const keyArg = args[i];
      const valueArg = args[i + 1];

      if (!keyArg || keyArg.type !== "string") {
        throw new Error(`hashmap keys must be strings, got ${keyArg?.type}`);
      }

      const key = keyArg.value as string;
      entries.push([key, valueArg]);
    }

    return createHashmap(entries);
  });

  /**
   * Get a value from a hash-map by key
   * Usage: (hashmap-get map key)
   * Returns the value if found, nil if not found
   */
  interpreter.defineBuiltin("hashmap-get", (args: TLispValue[]): TLispValue => {
    if (args.length !== 2) {
      throw new Error("hashmap-get requires exactly 2 arguments: map and key");
    }

    const [mapArg, keyArg] = args;

    if (!mapArg || !isHashmap(mapArg)) {
      throw new Error("hashmap-get first argument must be a hash-map");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("hashmap-get second argument must be a string");
    }

    const key = keyArg.value as string;
    const map = mapArg.value;

    const value = map.get(key);

    // Return nil if key not found (following functional programming principles)
    return value === undefined ? createNil() : value;
  });

  /**
   * Set a key-value pair in a hash-map (immutable operation)
   * Usage: (hashmap-set map key value)
   * Returns a new hash-map with the key-value pair set
   */
  interpreter.defineBuiltin("hashmap-set", (args: TLispValue[]): TLispValue => {
    if (args.length !== 3) {
      throw new Error("hashmap-set requires exactly 3 arguments: map, key, and value");
    }

    const [mapArg, keyArg, valueArg] = args;

    if (!mapArg || !isHashmap(mapArg)) {
      throw new Error("hashmap-set first argument must be a hash-map");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("hashmap-set second argument must be a string");
    }

    const key = keyArg.value as string;
    const oldMap = mapArg.value;

    // Create new Map for immutable operation (functional programming principle)
    const newMap = new Map(oldMap);
    newMap.set(key, valueArg);

    return createHashmap(Array.from(newMap.entries()));
  });

  /**
   * Get all keys from a hash-map
   * Usage: (hashmap-keys map)
   * Returns a list of all keys as strings
   */
  interpreter.defineBuiltin("hashmap-keys", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("hashmap-keys requires exactly 1 argument: map");
    }

    const [mapArg] = args;

    if (!mapArg || !isHashmap(mapArg)) {
      throw new Error("hashmap-keys argument must be a hash-map");
    }

    const map = mapArg.value;
    const keys = Array.from(map.keys()).map((key) => createString(key));

    return createList(keys);
  });

  /**
   * Get all values from a hash-map
   * Usage: (hashmap-values map)
   * Returns a list of all values
   */
  interpreter.defineBuiltin("hashmap-values", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("hashmap-values requires exactly 1 argument: map");
    }

    const [mapArg] = args;

    if (!mapArg || !isHashmap(mapArg)) {
      throw new Error("hashmap-values argument must be a hash-map");
    }

    const map = mapArg.value;
    const values = Array.from(map.values());

    return createList(values);
  });

  /**
   * Check if a hash-map contains a key
   * Usage: (hashmap-has-key? map key)
   * Returns true if key exists, false otherwise
   */
  interpreter.defineBuiltin("hashmap-has-key?", (args: TLispValue[]): TLispValue => {
    if (args.length !== 2) {
      throw new Error("hashmap-has-key? requires exactly 2 arguments: map and key");
    }

    const [mapArg, keyArg] = args;

    if (!mapArg || !isHashmap(mapArg)) {
      throw new Error("hashmap-has-key? first argument must be a hash-map");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("hashmap-has-key? second argument must be a string");
    }

    const key = keyArg.value as string;
    const map = mapArg.value;

    return createBoolean(map.has(key));
  });

  /**
   * Create a new keymap with default properties
   * Usage: (defkeymap name)
   * Defines a new keymap variable with mode, parent, and bindings properties
   */
  interpreter.defineBuiltin("defkeymap", (args: TLispValue[]): TLispValue => {
    if (args.length < 1) {
      throw new Error("defkeymap requires at least 1 argument: keymap name");
    }

    const nameArg = args[0];
    if (!nameArg || nameArg.type !== "string") {
      throw new Error("defkeymap requires a string as the first argument (keymap name)");
    }

    const keymapName = nameArg.value as string;

    // Create a new keymap with default properties
    const keymap = createHashmap([
      ["mode", createString("unknown")],
      ["parent", createNil()],
      ["bindings", createHashmap([])]
    ]);

    // Define the keymap in the global environment
    interpreter.globalEnv.define(keymapName, keymap);
    return keymap;
  });

  /**
   * Get a property from a keymap
   * Usage: (keymap-get keymap property)
   * Returns the value of the specified property from the keymap
   */
  interpreter.defineBuiltin("keymap-get", (args: TLispValue[]): TLispValue => {
    if (args.length !== 2) {
      throw new Error("keymap-get requires exactly 2 arguments: keymap and property");
    }

    const [keymapArg, propArg] = args;

    if (!keymapArg || !isHashmap(keymapArg)) {
      throw new Error("keymap-get first argument must be a keymap (hashmap)");
    }

    if (!propArg || propArg.type !== "string") {
      throw new Error("keymap-get second argument must be a string property name");
    }

    const property = propArg.value as string;
    const keymap = keymapArg.value;

    const value = keymap.get(property);
    return value === undefined ? createNil() : value;
  });

  /**
   * Define a key binding in a keymap
   * Usage: (keymap-define-key keymap key command)
   * Adds or updates a key-command binding in the keymap's bindings
   */
  interpreter.defineBuiltin("keymap-define-key", (args: TLispValue[]): TLispValue => {
    if (args.length !== 3) {
      throw new Error("keymap-define-key requires exactly 3 arguments: keymap, key, command");
    }

    const [keymapArg, keyArg, commandArg] = args;

    if (!keymapArg || !isHashmap(keymapArg)) {
      throw new Error("keymap-define-key first argument must be a keymap (hashmap)");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("keymap-define-key second argument must be a string key");
    }

    if (!commandArg) {
      throw new Error("keymap-define-key third argument must be a command value");
    }

    const key = keyArg.value as string;
    const keymap = keymapArg.value;

    // Get the current bindings
    const bindings = keymap.get("bindings");
    let newBindings = createHashmap([]);

    if (bindings && isHashmap(bindings)) {
      newBindings = bindings;
    }

    // Update the bindings with the new key-command mapping
    const bindingsMap = newBindings.value;
    const updatedBindingsMap = new Map(bindingsMap);
    updatedBindingsMap.set(key, commandArg);

    // Create the updated bindings hashmap
    const updatedBindings = createHashmap(Array.from(updatedBindingsMap.entries()));

    // Create a new keymap with updated bindings
    const newKeymap = createHashmap([
      ["mode", keymap.get("mode") || createString("unknown")],
      ["parent", keymap.get("parent") || createNil()],
      ["bindings", updatedBindings]
    ]);

    return newKeymap;
  });

  /**
   * Lookup a command bound to a key in a keymap
   * Usage: (keymap-lookup keymap key)
   * Returns the command bound to the specified key, or nil if not found
   */
  interpreter.defineBuiltin("keymap-lookup", (args: TLispValue[]): TLispValue => {
    if (args.length !== 2) {
      throw new Error("keymap-lookup requires exactly 2 arguments: keymap and key");
    }

    const [keymapArg, keyArg] = args;

    if (!keymapArg || !isHashmap(keymapArg)) {
      throw new Error("keymap-lookup first argument must be a keymap (hashmap)");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("keymap-lookup second argument must be a string key");
    }

    const key = keyArg.value as string;
    const keymap = keymapArg.value;

    // Get the bindings from the keymap
    const bindings = keymap.get("bindings");

    if (!bindings || !isHashmap(bindings)) {
      return createNil();
    }

    const bindingsMap = bindings.value;
    const command = bindingsMap.get(key);

    return command === undefined ? createNil() : command;
  });

  /**
   * Set a variable in the current environment
   * Usage: (setq variable-name value)
   * Sets the variable to the given value and returns the value
   * The variable name can be a string or a symbol
   */
  interpreter.defineBuiltin("setq", (args: TLispValue[]): TLispValue => {
    if (args.length !== 2) {
      throw new Error("setq requires exactly 2 arguments: variable name and value");
    }

    const [nameArg, valueArg] = args;

    if (!nameArg) {
      throw new Error("setq first argument cannot be null");
    }

    let variableName: string;

    if (nameArg.type === "string") {
      variableName = nameArg.value as string;
    } else if (nameArg.type === "symbol") {
      variableName = nameArg.value as string;
    } else {
      throw new Error("setq first argument must be a string or symbol (variable name)");
    }

    // Define the variable in the global environment
    interpreter.globalEnv.define(variableName, valueArg);

    return valueArg;
  });

  // Testing framework variables
  const testRegistry: Map<string, { body: TLispValue[], name: string }> = new Map();
  let currentTestResults: { testName: string, passed: boolean, error?: string }[] = [];
  let testCounts = { passed: 0, failed: 0, total: 0 };

  /**
   * Define a test function
   * Usage: (deftest test-name () body...)
   * Defines a test that can be run later
   */
  interpreter.defineBuiltin("deftest", (args: TLispValue[]): TLispValue => {
    if (args.length < 2) {
      throw new Error("deftest requires at least 2 arguments: test name and parameter list");
    }

    const nameArg = args[0];
    const paramsArg = args[1];

    if (!nameArg || nameArg.type !== "string") {
      throw new Error("deftest first argument must be a string (test name)");
    }

    if (!paramsArg || paramsArg.type !== "list") {
      throw new Error("deftest second argument must be a list (parameters)");
    }

    const testName = nameArg.value as string;
    const testBody = args.slice(2); // Everything after name and params

    // Register the test
    testRegistry.set(testName, { body: testBody, name: testName });

    return createString(testName);
  });

  /**
   * Run a specific test
   * Usage: (test-run test-name)
   * Executes the test and returns the result
   */
  interpreter.defineBuiltin("test-run", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("test-run requires exactly 1 argument: test name");
    }

    const nameArg = args[0];
    if (!nameArg || nameArg.type !== "string") {
      throw new Error("test-run requires a string as the argument (test name)");
    }

    const testName = nameArg.value as string;
    const testDef = testRegistry.get(testName);

    if (!testDef) {
      throw new Error(`Test '${testName}' not found`);
    }

    let testPassed = true;
    let errorMessage: string | undefined;

    try {
      // Execute each expression in the test body
      for (const expr of testDef.body) {
        const result = interpreter.eval(expr);
        if (result._tag === 'Left') {
          throw new Error(`Test '${testName}' failed with error: ${result.left.message || result.left}`);
        }
      }

      currentTestResults.push({ testName, passed: true });
    } catch (error) {
      testPassed = false;
      errorMessage = error instanceof Error ? error.message : String(error);
      currentTestResults.push({ testName, passed: false, error: errorMessage });
    }

    return createBoolean(testPassed);
  });

  /**
   * Run all registered tests
   * Usage: (test-run-all)
   * Executes all tests and returns summary statistics
   */
  interpreter.defineBuiltin("test-run-all", (args: TLispValue[]): TLispValue => {
    // Reset test results and counts
    currentTestResults = [];
    testCounts.passed = 0;
    testCounts.failed = 0;
    testCounts.total = 0;

    // Run each registered test
    for (const [testName, testDef] of testRegistry.entries()) {
      let testPassed = true;
      let errorMessage: string | undefined;

      try {
        // Execute each expression in the test body
        for (const expr of testDef.body) {
          const result = interpreter.eval(expr);
          if (result._tag === 'Left') {
            throw new Error(`Test '${testName}' failed with error: ${result.left.message || result.left}`);
          }
        }

        testCounts.passed++;
        currentTestResults.push({ testName, passed: true });
      } catch (error) {
        testPassed = false;
        errorMessage = error instanceof Error ? error.message : String(error);
        testCounts.failed++;
        currentTestResults.push({ testName, passed: false, error: errorMessage });
      }
    }

    testCounts.total = testCounts.passed + testCounts.failed;

    // Return a summary as a list: [passed, failed, total]
    return createList([
      createNumber(testCounts.passed),
      createNumber(testCounts.failed),
      createNumber(testCounts.total)
    ]);
  });

  /**
   * Assert that a value is truthy
   * Usage: (assert-true value)
   * Passes when value is truthy, throws error otherwise
   */
  interpreter.defineBuiltin("assert-true", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("assert-true requires exactly 1 argument: value");
    }

    const value = args[0];
    if (!isTruthy(value)) {
      throw new Error(`Assertion failed: expected truthy value, got ${valueToString(value)}`);
    }

    return createBoolean(true);
  });

  /**
   * Assert that a value is falsy
   * Usage: (assert-false value)
   * Passes when value is falsy, throws error otherwise
   */
  interpreter.defineBuiltin("assert-false", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("assert-false requires exactly 1 argument: value");
    }

    const value = args[0];
    if (isTruthy(value)) {
      throw new Error(`Assertion failed: expected falsy value, got ${valueToString(value)}`);
    }

    return createBoolean(true);
  });

  /**
   * Assert that two values are equal
   * Usage: (assert-equal expected actual)
   * Passes when values are equal, throws error otherwise
   */
  interpreter.defineBuiltin("assert-equal", (args: TLispValue[]): TLispValue => {
    if (args.length !== 2) {
      throw new Error("assert-equal requires exactly 2 arguments: expected and actual");
    }

    const [expected, actual] = args;
    if (!valuesEqual(expected, actual)) {
      throw new Error(`Assertion failed: expected ${valueToString(expected)}, got ${valueToString(actual)}`);
    }

    return createBoolean(true);
  });

  /**
   * Assert that two values are not equal
   * Usage: (assert-not-equal expected actual)
   * Passes when values are not equal, throws error otherwise
   */
  interpreter.defineBuiltin("assert-not-equal", (args: TLispValue[]): TLispValue => {
    if (args.length !== 2) {
      throw new Error("assert-not-equal requires exactly 2 arguments: expected and actual");
    }

    const [expected, actual] = args;
    if (valuesEqual(expected, actual)) {
      throw new Error(`Assertion failed: expected ${valueToString(expected)} to not equal ${valueToString(actual)}`);
    }

    return createBoolean(true);
  });

  /**
   * Assert that a form raises an error
   * Usage: (assert-error form)
   * Passes when form raises error, throws error if form succeeds
   */
  interpreter.defineBuiltin("assert-error", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("assert-error requires exactly 1 argument: form");
    }

    const form = args[0];

    try {
      const result = interpreter.eval(form);
      if (result._tag === 'Left') {
        // Form raised an error as expected
        return createBoolean(true);
      } else {
        // Form succeeded when it should have failed
        throw new Error(`Expected error but form evaluated successfully to ${valueToString(result.right)}`);
      }
    } catch (error) {
      // Form raised an error as expected
      return createBoolean(true);
    }
  });
}
