/**
 * @file keymap-ops.ts
 * @description T-Lisp API operations for keymap management
 *
 * This module provides T-Lisp callable functions for keymap operations,
 * as specified in ADR 006. These functions allow T-Lisp code to interact
 * with the Editor's keymap system.
 *
 * Available operations:
 * - keymap-set: Register a T-Lisp keymap with the Editor for a mode
 * - keymap-keys: List all bindings in a keymap
 * - keymap-active: Get the active keymap for a mode
 *
 * Usage:
 *   import { createKeymapOps } from "./api/keymap-ops.ts";
 *   const keymapOps = createKeymapOps(interpreter, keymapSync);
 *   for (const [name, fn] of keymapOps) {
 *     interpreter.defineBuiltin(name, fn);
 *   }
 */

import type { TLispInterpreter, TLispValue } from "../../tlisp/types.ts";
import { createString, createList, createNil, isHashmap } from "../../tlisp/values.ts";
import type { KeymapSync } from "../keymap-sync.ts";
import { Either } from "../../utils/task-either.ts";
import { log } from "../../utils/logger.ts";

const logger = log.module('keymap-ops');

/**
 * Create keymap operations for T-Lisp API
 * @param interpreter - T-Lisp interpreter instance
 * @param keymapSync - KeymapSync bridge instance
 * @returns Map of operation names to T-Lisp functions
 */
export function createKeymapOps(
  interpreter: TLispInterpreter,
  keymapSync: KeymapSync
): Map<string, (args: TLispValue[]) => Either<string, TLispValue>> {
  const ops = new Map<string, (args: TLispValue[]) => Either<string, TLispValue>>();

  /**
   * keymap-set: Register a T-Lisp keymap with the Editor for a mode
   * Usage: (keymap-set "normal" *my-keymap*)
   *
   * This registers a T-Lisp keymap so that the Editor will check it during
   * key dispatch for the specified mode.
   */
  ops.set("keymap-set", (args: TLispValue[]): Either<string, TLispValue> => {
    // Validate argument count
    if (args.length !== 2) {
      return Either.left(`keymap-set requires exactly 2 arguments: mode and keymap, got ${args.length}`);
    }

    const [modeArg, keymapArg] = args;

    // Validate mode argument
    if (!modeArg || modeArg.type !== "string") {
      return Either.left(`keymap-set first argument must be a string (mode), got ${modeArg?.type}`);
    }

    const mode = modeArg.value as string;

    // Validate mode value
    const validModes = ["normal", "insert", "visual", "command", "mx"];
    if (!validModes.includes(mode)) {
      return Either.left(`Invalid mode: ${mode}. Must be one of: ${validModes.join(", ")}`);
    }

    // Validate keymap argument
    if (!keymapArg || !isHashmap(keymapArg)) {
      return Either.left(`keymap-set second argument must be a keymap (hashmap), got ${keymapArg?.type}`);
    }

    try {
      // Register the keymap with KeymapSync
      keymapSync.registerTlispKeymap(mode, keymapArg);

      logger.info(`Registered T-Lisp keymap for mode: ${mode}`, {
        data: { mode }
      });

      return Either.right(createString(`Registered keymap for mode: ${mode}`));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to register keymap for mode ${mode}`, undefined, {
        operation: 'keymap-set',
        data: { mode, error: errorMsg }
      });
      return Either.left(`Failed to register keymap: ${errorMsg}`);
    }
  });

  /**
   * keymap-keys: List all bindings in a keymap for a mode
   * Usage: (keymap-keys "normal") => ("j" "k" "l" "h")
   *
   * Returns a list of all keys that have bindings in the keymap
   * for the specified mode.
   */
  ops.set("keymap-keys", (args: TLispValue[]): Either<string, TLispValue> => {
    // Validate argument count
    if (args.length !== 1) {
      return Either.left(`keymap-keys requires exactly 1 argument: mode, got ${args.length}`);
    }

    const [modeArg] = args;

    // Validate mode argument
    if (!modeArg || modeArg.type !== "string") {
      return Either.left(`keymap-keys argument must be a string (mode), got ${modeArg?.type}`);
    }

    const mode = modeArg.value as string;

    // Get the active keymap for the mode
    const keymap = keymapSync.getActiveKeymap(mode);

    if (!keymap) {
      return Either.left(`No keymap registered for mode: ${mode}`);
    }

    // Validate keymap structure
    if (!isHashmap(keymap)) {
      return Either.left(`Active keymap for mode ${mode} is not a valid hashmap`);
    }

    // Get the bindings from the keymap
    const bindingsValue = keymap.value.get("bindings");

    if (!bindingsValue || !isHashmap(bindingsValue)) {
      // No bindings - return empty list
      return Either.right(createList([]));
    }

    // Extract all keys from the bindings
    const keys = Array.from(bindingsValue.value.keys()).map(key =>
      createString(key)
    );

    return Either.right(createList(keys));
  });

  /**
   * keymap-active: Get the active keymap for a mode
   * Usage: (keymap-active "normal") => *normal-keymap*
   *
   * Returns the keymap currently active for the specified mode,
   * or nil if no keymap is registered.
   */
  ops.set("keymap-active", (args: TLispValue[]): Either<string, TLispValue> => {
    // Validate argument count
    if (args.length !== 1) {
      return Either.left(`keymap-active requires exactly 1 argument: mode, got ${args.length}`);
    }

    const [modeArg] = args;

    // Validate mode argument
    if (!modeArg || modeArg.type !== "string") {
      return Either.left(`keymap-active argument must be a string (mode), got ${modeArg?.type}`);
    }

    const mode = modeArg.value as string;

    // Get the active keymap for the mode
    const keymap = keymapSync.getActiveKeymap(mode);

    if (!keymap) {
      // No keymap registered - return nil
      return Either.right(createNil());
    }

    // Return the keymap
    return Either.right(keymap);
  });

  return ops;
}
