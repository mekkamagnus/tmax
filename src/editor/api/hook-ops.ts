/**
 * @file hook-ops.ts
 * @description Hook system for T-Lisp editor API
 *
 * Hooks are named lists of entries. Each entry can be:
 * - A string function name (backwards compatible)
 * - A callable TLispValue (lambda, symbol)
 *
 * add-hook prepends by default; (add-hook HOOK FN t) appends.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createList, createString, createBoolean } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { State } from "../../utils/state.ts";
import type { EditorModel } from "../functional/model.ts";

/**
 * CHORE-39 Phase 4: `State<EditorModel>` reader — the active editor mode, used
 * to dispatch mode-specific hooks. Pure model read.
 */
export const currentModeState = (): State<EditorModel, EditorModel["mode"]> =>
  State.gets((m: EditorModel) => m.mode);
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";

export type HookEntry = string | TLispValue;
export type HookRegistry = Map<string, HookEntry[]>;

export function createHookOps(
  hooks: HookRegistry,
  evalFunction: (name: string) => Either<AppError, TLispValue>,
  evalValue?: (value: TLispValue) => Either<AppError, TLispValue>
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  const describeEntry = (entry: HookEntry): string => {
    if (typeof entry === "string") return entry;
    if (entry.type === "symbol") return entry.value as string;
    if (entry.type === "function") {
      const named = entry as typeof entry & { name?: string };
      return named.name ? `#<function ${named.name}>` : "#<lambda>";
    }
    return `#<${entry.type}>`;
  };

  // Execute a single hook entry
  const execEntry = (entry: HookEntry): void => {
    if (typeof entry === "string") {
      const result = evalFunction(entry);
      if (Either.isLeft(result)) {
        console.error(`hook-ops: error running hook '${entry}': ${result.left.message}`);
      }
    } else if (entry.type === "function") {
      const fn = entry.value as TLispFunctionImpl;
      const result = fn([]);
      if (Either.isLeft(result)) {
        console.error(`hook-ops: error running hook function: ${result.left.message}`);
      }
    } else if (entry.type === "symbol" && typeof entry.value === "string") {
      const result = evalFunction(entry.value);
      if (Either.isLeft(result)) {
        console.error(`hook-ops: error running hook symbol '${entry.value}': ${result.left.message}`);
      }
    } else if (evalValue) {
      // Callable TLispValue (lambda, symbol, etc.)
      const result = evalValue(entry);
      if (Either.isLeft(result)) {
        console.error(`hook-ops: error running hook value: ${result.left.message}`);
      }
    }
  };

  // (add-hook HOOK-NAME FUNCTION &optional APPEND)
  api.set("add-hook", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2 || args.length > 3) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'add-hook requires 2-3 arguments: hook-name, function, [append]',
        'args',
        args.length,
        '2-3 arguments'
      ));
    }

    const hookNameArg = args[0]!
    const hookTypeValidation = validateArgType(hookNameArg, "string", 0, "add-hook");
    if (Either.isLeft(hookTypeValidation)) {
      return Either.left(hookTypeValidation.left);
    }

    const hookName = hookNameArg.value as string;
    const funcArg = args[1]!

    // Accept string function names, symbols, or lambda/function values
    let entry: HookEntry;
    if (funcArg.type === "string") {
      entry = funcArg.value as string;
    } else if (funcArg.type === "symbol" || funcArg.type === "function") {
      entry = funcArg;
    } else {
      entry = funcArg; // Store any callable value
    }

    const append = args.length > 2 && args[2] && args[2].type !== "nil" &&
      (args[2].type === "boolean" ? args[2].value === true : true);

    let hookList = hooks.get(hookName);
    if (!hookList) {
      hookList = [];
      hooks.set(hookName, hookList);
    }

    if (append) {
      hookList.push(entry);
    } else {
      hookList.unshift(entry);
    }

    return Either.right(createNil());
  });

  // (remove-hook HOOK-NAME FUNCTION)
  api.set("remove-hook", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "remove-hook");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const hookNameArg = args[0]!
    const funcArg = args[1]!

    const hookTypeValidation = validateArgType(hookNameArg, "string", 0, "remove-hook");
    if (Either.isLeft(hookTypeValidation)) {
      return Either.left(hookTypeValidation.left);
    }

    const hookName = hookNameArg.value as string;
    const hookList = hooks.get(hookName);

    if (hookList) {
      // For string args, remove by name match; for values, remove by reference
      if (funcArg.type === "string") {
        const funcName = funcArg.value as string;
        const index = hookList.findIndex((e) => describeEntry(e) === funcName || e === funcName);
        if (index !== -1) hookList.splice(index, 1);
      } else {
        const index = hookList.findIndex((e) => e === funcArg);
        if (index !== -1) hookList.splice(index, 1);
      }
    }

    return Either.right(createNil());
  });

  // (run-hooks HOOK-NAME)
  api.set("run-hooks", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "run-hooks");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const hookNameArg = args[0]!
    const typeValidation = validateArgType(hookNameArg, "string", 0, "run-hooks");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const hookName = hookNameArg.value as string;
    const hookList = hooks.get(hookName);

    if (hookList) {
      for (const entry of hookList) {
        try {
          execEntry(entry);
        } catch (e) {
          console.error(`hook-ops: error running hook in '${hookName}': ${e}`);
        }
      }
    }

    return Either.right(createNil());
  });

  // (hook-list HOOK-NAME)
  api.set("hook-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "hook-list");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const hookNameArg = args[0]!
    const typeValidation = validateArgType(hookNameArg, "string", 0, "hook-list");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const hookName = hookNameArg.value as string;
    const hookList = hooks.get(hookName);

    if (!hookList) {
      return Either.right(createNil());
    }

    return Either.right(createList(hookList.map((entry) => createString(describeEntry(entry)))));
  });

  return api;
}
