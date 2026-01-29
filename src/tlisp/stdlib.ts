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
}
