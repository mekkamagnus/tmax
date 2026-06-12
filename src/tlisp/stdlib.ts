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

import type { EvalContext, TLispFunctionImpl, TLispInterpreter, TLispValue } from "./types.ts";
import {
  createBoolean,
  createHashmap,
  createList,
  createNil,
  createNumber,
  createPromise,
  createString,
  isHashmap,
  isPromise,
  isTruthy,
  valueToString,
  valuesEqual,
} from "./values.ts";
import { Either } from "../utils/task-either.ts";
import type { AppError } from "../error/types.ts";
import { awaitPromiseValue } from "./async.ts";

/** Wrap a raw TLispValue-returning function into a TLispFunctionImpl */
function raw(fn: (args: TLispValue[]) => TLispValue): (args: TLispValue[]) => Either<AppError, TLispValue> {
  return (args) => Either.right(fn(args));
}

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
  const resolveCallable = (value: TLispValue): TLispValue => {
    if (value.type === "symbol" || value.type === "string") {
      const name = value.value as string;
      let resolved = interpreter.globalEnv.lookup(name);

      // Try module exports for qualified names
      if (!resolved && (interpreter as any).moduleRegistry) {
        const registry = (interpreter as any).moduleRegistry;
        const slashIdx = name.indexOf("/");
        const publicExport = slashIdx > 0 && typeof registry.resolvePublicName === "function"
          ? registry.resolvePublicName(name)
          : undefined;
        if (publicExport) {
          resolved = publicExport.value;
        }

        if (slashIdx > 0) {
          const alias = name.substring(0, slashIdx);
          const symName = name.substring(slashIdx + 1);
          // Walk imports to find the module
          let current: any = interpreter.globalEnv;
          while (current) {
            if (current.moduleImports) {
              const imp = current.moduleImports.get(alias);
              if (imp) {
                const record = registry.resolve(imp.moduleName);
                if (record && record.state === "loaded" && record.exports.has(symName)) {
                  resolved = record.env.lookup(symName);
                  if (resolved) return resolved;
                }
              }
            }
            current = current.parent;
          }
        }
        // Check unique module exports for unqualified callback names.
        if (!resolved && slashIdx < 0 && typeof registry.resolveUniqueExport === "function") {
          const entry = registry.resolveUniqueExport(name);
          if (entry && entry !== "ambiguous") resolved = entry.value;
        }
      }

      if (!resolved) throw new Error(`Undefined function: ${String(value.value)}`);
      return resolved;
    }
    return value;
  };

  const call = (callable: TLispValue, args: TLispValue[]): TLispValue => {
    const resolved = resolveCallable(callable);
    if (resolved.type !== "function") {
      throw new Error("Value is not callable");
    }
    const result = (resolved.value as TLispFunctionImpl)(args);
    if (result && typeof result === "object" && "_tag" in result) {
      if (Either.isLeft(result)) {
        throw new Error(result.left.message);
      }
      return result.right;
    }
    return result as TLispValue;
  };

  interpreter.defineBuiltin("promise-resolved-p", (args: TLispValue[]) => {
    if (args.length !== 1 || !args[0] || !isPromise(args[0])) {
      return Either.left({ type: "EvalError", variant: "TypeError", message: "promise-resolved-p requires a promise" });
    }
    return Either.right(createBoolean(args[0].resolved));
  });

  interpreter.defineAsyncBuiltin?.(
    "promise-value",
    () => Either.left({
      type: "EvalError",
      variant: "RuntimeError",
      message: "promise-value requires async evaluation; use async-let",
    }),
    async (args: TLispValue[], context: EvalContext) => {
      if (!context.asyncMode) {
        return Either.left({
          type: "EvalError",
          variant: "RuntimeError",
          message: "promise-value requires async evaluation; use async-let",
        });
      }
      if (args.length !== 1 || !args[0] || !isPromise(args[0])) {
        return Either.left({ type: "EvalError", variant: "TypeError", message: "promise-value requires a promise" });
      }
      return awaitPromiseValue(args[0]);
    }
  );

  interpreter.defineAsyncBuiltin?.(
    "promise-then",
    () => Either.left({
      type: "EvalError",
      variant: "RuntimeError",
      message: "promise-then requires async evaluation; use async-let",
    }),
    async (args: TLispValue[], context: EvalContext) => {
      if (!context.asyncMode) {
        return Either.left({
          type: "EvalError",
          variant: "RuntimeError",
          message: "promise-then requires async evaluation; use async-let",
        });
      }
      if (args.length !== 2 || !args[0] || !isPromise(args[0]) || !args[1]) {
        return Either.left({ type: "EvalError", variant: "TypeError", message: "promise-then requires a promise and function" });
      }

      const callback = resolveCallable(args[1]);
      if (callback.type !== "function") {
        return Either.left({ type: "EvalError", variant: "TypeError", message: "promise-then callback must be a function" });
      }

      return Either.right(createPromise(args[0].value.then(async (value) => {
        const fn = callback as any;
        const result = fn.asyncValue
          ? await fn.asyncValue([value], context)
          : fn.value([value], context);
        if (result && typeof result === "object" && "_tag" in result) {
          if (Either.isLeft(result)) {
            throw result.left;
          }
          return result.right;
        }
        return result as TLispValue;
      })));
    }
  );

  interpreter.defineBuiltin("funcall", raw((args: TLispValue[]) => {
    if (args.length === 0) throw new Error("funcall requires a function");
    return call(args[0]!, args.slice(1));
  }));

  interpreter.defineBuiltin("apply", raw((args: TLispValue[]) => {
    if (args.length < 2) throw new Error("apply requires a function and argument list");
    const finalArg = args[args.length - 1]!;
    if (finalArg.type !== "list") throw new Error("apply final argument must be a list");
    return call(args[0]!, [...args.slice(1, -1), ...(finalArg.value as TLispValue[])]);
  }));

  interpreter.defineBuiltin("mapcar", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[1]?.type !== "list") {
      throw new Error("mapcar requires a function and list");
    }
    return createList((args[1].value as TLispValue[]).map(value => call(args[0]!, [value])));
  }));

  interpreter.defineBuiltin("filter", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[1]?.type !== "list") {
      throw new Error("filter requires a predicate and list");
    }
    return createList(
      (args[1].value as TLispValue[]).filter(value => isTruthy(call(args[0]!, [value]))),
    );
  }));

  interpreter.defineBuiltin("stable-sort", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[1]?.type !== "list") {
      throw new Error("stable-sort requires a predicate and list");
    }
    const values = [...(args[1].value as TLispValue[])];
    values.sort((left, right) => {
      if (isTruthy(call(args[0]!, [left, right]))) return -1;
      if (isTruthy(call(args[0]!, [right, left]))) return 1;
      return 0;
    });
    return createList(values);
  }));

  interpreter.defineBuiltin("identity", raw((args: TLispValue[]) => {
    if (args.length !== 1) throw new Error("identity requires one argument");
    return args[0]!;
  }));

  interpreter.defineBuiltin("list-slice", raw((args: TLispValue[]) => {
    if (args.length !== 3 || args[0]?.type !== "list" || args[1]?.type !== "number" || args[2]?.type !== "number") {
      throw new Error("list-slice requires list, start, and end");
    }
    return createList((args[0].value as TLispValue[]).slice(args[1].value as number, args[2].value as number));
  }));

  interpreter.defineBuiltin("string-split", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-split requires string and separator");
    }
    return createList(
      (args[0].value as string)
        .split(args[1].value as string)
        .map(createString),
    );
  }));

  interpreter.defineBuiltin("string-prefix-p", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-prefix-p requires prefix and string");
    }
    return createBoolean((args[1].value as string).startsWith(args[0].value as string));
  }));

  interpreter.defineBuiltin("string-suffix-p", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-suffix-p requires suffix and string");
    }
    return createBoolean((args[1].value as string).endsWith(args[0].value as string));
  }));

  interpreter.defineBuiltin("string-contains-p", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-contains-p requires needle and string");
    }
    return createBoolean((args[1].value as string).includes(args[0].value as string));
  }));

  interpreter.defineBuiltin("string-char-at", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "number") {
      throw new Error("string-char-at requires string and index");
    }
    return createString(Array.from(args[0].value as string)[args[1].value as number] ?? "");
  }));

  interpreter.defineBuiltin("string-printable-p", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("string-printable-p requires a string");
    }
    const value = args[0].value as string;
    return createBoolean(Array.from(value).length === 1 && value >= " " && value !== "\x7f");
  }));

  interpreter.defineBuiltin("regexp-quote", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("regexp-quote requires a string");
    }
    return createString((args[0].value as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }));

  interpreter.defineBuiltin("string-match-spans", raw((args: TLispValue[]) => {
    if (args.length < 2 || args.length > 3 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-match-spans requires pattern, string, and optional case-sensitive flag");
    }
    const caseSensitive = args[2]?.type === "boolean" ? args[2].value as boolean : true;
    try {
      const regexp = new RegExp(args[0].value as string, caseSensitive ? "gu" : "giu");
      const spans: TLispValue[] = [];
      for (const match of (args[1].value as string).matchAll(regexp)) {
        if (match.index === undefined) continue;
        const text = match[0] ?? "";
        spans.push(createList([createNumber(match.index), createNumber(match.index + text.length)]));
        if (text.length === 0) regexp.lastIndex++;
      }
      return createList(spans);
    } catch {
      return createList([]);
    }
  }));

  interpreter.defineBuiltin("literal-match-spans", raw((args: TLispValue[]) => {
    if (args.length < 2 || args.length > 3 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("literal-match-spans requires needle, string, and optional case-sensitive flag");
    }
    const caseSensitive = args[2]?.type === "boolean" ? args[2].value as boolean : true;
    const original = args[1].value as string;
    const needle = args[0].value as string;
    const target = caseSensitive ? original : original.toLowerCase();
    const query = caseSensitive ? needle : needle.toLowerCase();
    if (query.length === 0) return createList([]);
    const spans: TLispValue[] = [];
    let start = 0;
    while (start <= target.length) {
      const index = target.indexOf(query, start);
      if (index < 0) break;
      spans.push(createList([createNumber(index), createNumber(index + query.length)]));
      start = index + Math.max(1, query.length);
    }
    return createList(spans);
  }));

  interpreter.defineBuiltin("string-join", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "list") {
      throw new Error("string-join requires separator string and list");
    }
    const separator = args[0].value as string;
    const parts = args[1].value as TLispValue[];
    return createString(parts.map((part) => part.type === "string" ? part.value as string : valueToString(part)).join(separator));
  }));

  interpreter.defineBuiltin("string-trim", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("string-trim requires a string");
    }
    return createString((args[0].value as string).trim());
  }));

  interpreter.defineBuiltin("string-replace", raw((args: TLispValue[]) => {
    if (args.length !== 3 || args[0]?.type !== "string" || args[1]?.type !== "string" || args[2]?.type !== "string") {
      throw new Error("string-replace requires string, search, and replacement");
    }
    const source = args[0].value as string;
    const search = args[1].value as string;
    const replacement = args[2].value as string;
    return createString(source.split(search).join(replacement));
  }));

  interpreter.defineBuiltin("number-to-string", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "number") {
      throw new Error("number-to-string requires a number");
    }
    return createString(String(args[0].value as number));
  }));

  interpreter.defineBuiltin("string-to-number", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("string-to-number requires a string");
    }
    const value = Number(args[0].value as string);
    if (Number.isNaN(value)) {
      throw new Error("string-to-number invalid number");
    }
    return createNumber(value);
  }));

  interpreter.defineBuiltin("nilp", raw((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("nilp requires exactly 1 argument");
    }
    return createBoolean(args[0]?.type === "nil");
  }));

  interpreter.defineBuiltin("string-flex-spans", raw((args: TLispValue[]) => {
    if (args.length < 2 || args.length > 3 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-flex-spans requires pattern, string, and optional case-sensitive flag");
    }
    const caseSensitive = args[2]?.type === "boolean" ? args[2].value as boolean : true;
    const pattern = caseSensitive ? args[0].value as string : (args[0].value as string).toLowerCase();
    const target = caseSensitive ? args[1].value as string : (args[1].value as string).toLowerCase();
    const spans: TLispValue[] = [];
    let targetIndex = 0;
    for (const character of pattern) {
      const index = target.indexOf(character, targetIndex);
      if (index < 0) return createList([]);
      spans.push(createList([createNumber(index), createNumber(index + character.length)]));
      targetIndex = index + character.length;
    }
    return createList(spans);
  }));

  interpreter.defineBuiltin("string-initialism-spans", raw((args: TLispValue[]) => {
    if (args.length < 2 || args.length > 3 || args[0]?.type !== "string" || args[1]?.type !== "string") {
      throw new Error("string-initialism-spans requires pattern, string, and optional case-sensitive flag");
    }
    const caseSensitive = args[2]?.type === "boolean" ? args[2].value as boolean : true;
    const pattern = caseSensitive ? args[0].value as string : (args[0].value as string).toLowerCase();
    const original = args[1].value as string;
    const target = caseSensitive ? original : original.toLowerCase();
    const starts = Array.from(target.matchAll(/(^|[-_\s/])([\p{L}\p{N}])/gu))
      .map(match => (match.index ?? 0) + (match[1]?.length ?? 0));
    const spans: TLispValue[] = [];
    let startIndex = 0;
    for (const character of pattern) {
      const found = starts.findIndex((position, index) =>
        index >= startIndex && target.slice(position).startsWith(character)
      );
      if (found < 0) return createList([]);
      const position = starts[found]!;
      spans.push(createList([createNumber(position), createNumber(position + character.length)]));
      startIndex = found + 1;
    }
    return createList(spans);
  }));

  interpreter.defineBuiltin("display-width", raw((args: TLispValue[]) => {
    if (args.length !== 1 || args[0]?.type !== "string") {
      throw new Error("display-width requires a string");
    }
    return createNumber(Array.from(args[0].value as string).length);
  }));

  interpreter.defineBuiltin("truncate-display", raw((args: TLispValue[]) => {
    if (args.length !== 2 || args[0]?.type !== "string" || args[1]?.type !== "number") {
      throw new Error("truncate-display requires string and width");
    }
    return createString(Array.from(args[0].value as string).slice(0, Math.max(0, args[1].value as number)).join(""));
  }));

  interpreter.defineBuiltin("symbol-name", raw((args: TLispValue[]) => {
    if (args.length !== 1 || (args[0]?.type !== "symbol" && args[0]?.type !== "string")) {
      throw new Error("symbol-name requires a symbol or string");
    }
    return createString(args[0].value as string);
  }));

  interpreter.defineBuiltin("hashmapp", raw((args: TLispValue[]) => {
    if (args.length !== 1) throw new Error("hashmapp requires one argument");
    return createBoolean(args[0]?.type === "hashmap");
  }));

  /**
   * Create a hash-map from key-value pairs
   * Usage: (hashmap key1 value1 key2 value2 ...)
   * Returns a new hash-map with the given key-value pairs
   * Requires an even number of arguments
   */
  interpreter.defineBuiltin("hashmap", raw((args: TLispValue[]) => {
    if (args.length % 2 !== 0) {
      throw new Error("hashmap requires an even number of arguments: key-value pairs");
    }

    const entries: [string, TLispValue][] = [];

    for (let i = 0; i < args.length; i += 2) {
      const keyArg = args[i]!;
      const valueArg = args[i + 1]!;

      if (!keyArg || keyArg.type !== "string") {
        throw new Error(`hashmap keys must be strings, got ${keyArg?.type}`);
      }

      const key = keyArg.value as string;
      entries.push([key, valueArg]);
    }

    return createHashmap(entries);
  }));

  /**
   * Get a value from a hash-map by key
   * Usage: (hashmap-get map key)
   * Returns the value if found, nil if not found
   */
  interpreter.defineBuiltin("hashmap-get", raw((args: TLispValue[]) => {
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
  }));

  /**
   * Set a key-value pair in a hash-map (immutable operation)
   * Usage: (hashmap-set map key value)
   * Returns a new hash-map with the key-value pair set
   */
  interpreter.defineBuiltin("hashmap-set", raw((args: TLispValue[]) => {
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
    newMap.set(key, valueArg!);

    return createHashmap(Array.from(newMap.entries()));
  }));

  /**
   * Get all keys from a hash-map
   * Usage: (hashmap-keys map)
   * Returns a list of all keys as strings
   */
  interpreter.defineBuiltin("hashmap-keys", raw((args: TLispValue[]) => {
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
  }));

  /**
   * Get all values from a hash-map
   * Usage: (hashmap-values map)
   * Returns a list of all values
   */
  interpreter.defineBuiltin("hashmap-values", raw((args: TLispValue[]) => {
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
  }));

  /**
   * Check if a hash-map contains a key
   * Usage: (hashmap-has-key? map key)
   * Returns true if key exists, false otherwise
   */
  interpreter.defineBuiltin("hashmap-has-key?", raw((args: TLispValue[]) => {
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
  }));

  /**
   * Create a new keymap with default properties
   * Usage: (defkeymap name)
   * Defines a new keymap variable with mode, parent, and bindings properties
   */
  interpreter.defineBuiltin("defkeymap", raw((args: TLispValue[]) => {
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
  }));

  /**
   * Get a property from a keymap
   * Usage: (keymap-get keymap property)
   * Returns the value of the specified property from the keymap
   */
  interpreter.defineBuiltin("keymap-get", raw((args: TLispValue[]) => {
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
  }));

  /**
   * Define a key binding in a keymap
   * Usage: (keymap-define-key keymap key command)
   * Adds or updates a key-command binding in the keymap's bindings
   */
  interpreter.defineBuiltin("keymap-define-key", raw((args: TLispValue[]) => {
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
  }));

  /**
   * Lookup a command bound to a key in a keymap
   * Usage: (keymap-lookup keymap key)
   * Returns the command bound to the specified key, or nil if not found
   */
  interpreter.defineBuiltin("keymap-lookup", raw((args: TLispValue[]) => {
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
  }));

  /**
   * Mutate a hashmap in place (for keymap bindings performance)
   * Usage: (keymap-mutable-set! hashmap key value)
   * Mutates the hashmap's internal map directly instead of copying
   */
  interpreter.defineBuiltin("keymap-mutable-set!", raw((args: TLispValue[]) => {
    if (args.length !== 3) {
      throw new Error("keymap-mutable-set! requires exactly 3 arguments: hashmap, key, value");
    }

    const [hashmapArg, keyArg, valueArg] = args as [TLispValue, TLispValue, TLispValue];

    if (!hashmapArg || !isHashmap(hashmapArg)) {
      throw new Error("keymap-mutable-set! first argument must be a hashmap");
    }

    if (!keyArg || keyArg.type !== "string") {
      throw new Error("keymap-mutable-set! second argument must be a string key");
    }

    const key = keyArg.value as string;
    hashmapArg.value.set(key, valueArg);
    return hashmapArg;
  }));

  /**
   * Set a variable in the current environment
   * Usage: (setq variable-name value)
   * Sets the variable to the given value and returns the value
   * The variable name can be a string or a symbol
   */
  interpreter.defineBuiltin("setq", raw((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("setq requires exactly 2 arguments: variable name and value");
    }

    const [nameArg, valueArg] = args as [TLispValue, TLispValue];

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
  }));

  // Testing framework variables
  const testRegistry: Map<string, { body: TLispValue[], name: string }> = new Map();
  let currentTestResults: { testName: string, passed: boolean, error?: string }[] = [];
  let testCounts = { passed: 0, failed: 0, total: 0 };

  /**
   * Define a test function
   * Usage: (deftest test-name () body...)
   * Defines a test that can be run later
   */
  interpreter.defineBuiltin("deftest", raw((args: TLispValue[]) => {
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
  }));

  /**
   * Run a specific test
   * Usage: (test-run test-name)
   * Executes the test and returns the result
   */
  interpreter.defineBuiltin("test-run", raw((args: TLispValue[]) => {
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
  }));

  /**
   * Run all registered tests
   * Usage: (test-run-all)
   * Executes all tests and returns summary statistics
   */
  interpreter.defineBuiltin("test-run-all", raw((args: TLispValue[]) => {
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
  }));

  /**
   * Assert that a value is truthy
   * Usage: (assert-true value)
   * Passes when value is truthy, throws error otherwise
   */
  interpreter.defineBuiltin("assert-true", raw((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("assert-true requires exactly 1 argument: value");
    }

    const value = args[0]!;
    if (!isTruthy(value)) {
      throw new Error(`Assertion failed: expected truthy value, got ${valueToString(value)}`);
    }

    return createBoolean(true);
  }));

  /**
   * Assert that a value is falsy
   * Usage: (assert-false value)
   * Passes when value is falsy, throws error otherwise
   */
  interpreter.defineBuiltin("assert-false", raw((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("assert-false requires exactly 1 argument: value");
    }

    const value = args[0]!;
    if (isTruthy(value)) {
      throw new Error(`Assertion failed: expected falsy value, got ${valueToString(value)}`);
    }

    return createBoolean(true);
  }));

  /**
   * Assert that two values are equal
   * Usage: (assert-equal expected actual)
   * Passes when values are equal, throws error otherwise
   */
  interpreter.defineBuiltin("assert-equal", raw((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("assert-equal requires exactly 2 arguments: expected and actual");
    }

    const [expected, actual] = args as [TLispValue, TLispValue];
    if (!valuesEqual(expected, actual)) {
      throw new Error(`Assertion failed: expected ${valueToString(expected)}, got ${valueToString(actual)}`);
    }

    return createBoolean(true);
  }));

  /**
   * Assert that two values are not equal
   * Usage: (assert-not-equal expected actual)
   * Passes when values are not equal, throws error otherwise
   */
  interpreter.defineBuiltin("assert-not-equal", raw((args: TLispValue[]) => {
    if (args.length !== 2) {
      throw new Error("assert-not-equal requires exactly 2 arguments: expected and actual");
    }

    const [expected, actual] = args as [TLispValue, TLispValue];
    if (valuesEqual(expected, actual)) {
      throw new Error(`Assertion failed: expected ${valueToString(expected)} to not equal ${valueToString(actual)}`);
    }

    return createBoolean(true);
  }));

  /**
   * Assert that a form raises an error
   * Usage: (assert-error form)
   * Passes when form raises error, throws error if form succeeds
   */
  interpreter.defineBuiltin("assert-error", raw((args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("assert-error requires exactly 1 argument: form");
    }

    const form = args[0]!;

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
  }));
}
