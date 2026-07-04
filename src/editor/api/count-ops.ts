/**
 * @file count-ops.ts
 * @description Count prefix operations for T-Lisp editor API (US-1.3.1)
 *
 * Implements Vim-style count prefix functionality:
 * - count-get: Get current count prefix value
 * - count-set: Set count prefix value
 * - count-reset: Reset count prefix to 0
 * - count-active: Check if count is active
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNumber, createBoolean, createNil } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType
} from "../../utils/validation.ts";
import {
  createValidationError,
  AppError
} from "../../error/types.ts";
import { runModel, readModelField, setModelField, type EditorModelAccess } from "./state-context.ts";

/**
 * Create count prefix operations for T-Lisp API.
 * CHORE-39 Phase 4: count now lives on EditorModel (`countPrefix`); this
 * factory reads/writes it through the State monad against the live model.
 */
export function createCountOps(
  access: EditorModelAccess
): Map<string, TLispFunctionImpl> {
  const getCount = (): number => runModel(access, readModelField("countPrefix"));
  const setCount = (count: number): void => {
    runModel(access, setModelField("countPrefix", Math.max(0, count)));
  };
  const resetCount = (): void => {
    runModel(access, setModelField("countPrefix", 0));
  };
  const ops = new Map<string, TLispFunctionImpl>();

  /**
   * Get current count prefix value
   * T-Lisp: (count-get) -> number
   * Returns: Current count value (0 if no count active)
   */
  ops.set("count-get", ((args: TLispValue[]): Either<AppError, TLispValue> => {
    const validation = validateArgsCount(args, 0, "count-get");
    if (Either.isLeft(validation)) {
      return Either.left(validation.left);
    }

    const count = getCount();
    return Either.right(createNumber(count));
  }) as TLispFunctionImpl);

  /**
   * Set count prefix value
   * T-Lisp: (count-set number) -> nil
   * Parameters:
   *   - number: The count value to set (must be >= 0)
   * Returns: nil
   */
  ops.set("count-set", ((args: TLispValue[]): Either<AppError, TLispValue> => {
    const validation = validateArgsCount(args, 1, "count-set");
    if (Either.isLeft(validation)) {
      return Either.left(validation.left);
    }

    const countValidation = validateArgType(args[0], "number", 0, "count-set");
    if (Either.isLeft(countValidation)) {
      return Either.left(countValidation.left);
    }

    const count = (args[0] as { type: "number"; value: number }).value;

    if (count < 0) {
      return Either.left(createValidationError("RangeError", "Count must be >= 0", "count", count));
    }

    setCount(count);
    return Either.right(createNil());
  }) as TLispFunctionImpl);

  /**
   * Reset count prefix to 0
   * T-Lisp: (count-reset) -> nil
   * Returns: nil
   */
  ops.set("count-reset", ((args: TLispValue[]): Either<AppError, TLispValue> => {
    const validation = validateArgsCount(args, 0, "count-reset");
    if (Either.isLeft(validation)) {
      return Either.left(validation.left);
    }

    resetCount();
    return Either.right(createNil());
  }) as TLispFunctionImpl);

  /**
   * Check if count is active
   * T-Lisp: (count-active) -> boolean
   * Returns: true if count > 0, false otherwise
   */
  ops.set("count-active", ((args: TLispValue[]): Either<AppError, TLispValue> => {
    const validation = validateArgsCount(args, 0, "count-active");
    if (Either.isLeft(validation)) {
      return Either.left(validation.left);
    }

    const count = getCount();
    return Either.right(createBoolean(count > 0));
  }) as TLispFunctionImpl);

  return ops;
}
