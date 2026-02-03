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

/**
 * Create count prefix operations for T-Lisp API
 * @param getCount - Function to get current count
 * @param setCount - Function to set count value
 * @param resetCount - Function to reset count to 0
 * @returns Map of count operation functions
 */
export function createCountOps(
  getCount: () => number,
  setCount: (count: number) => void,
  resetCount: () => void
): Map<string, TLispFunctionImpl> {
  const ops = new Map<string, TLispFunctionImpl>();

  /**
   * Get current count prefix value
   * T-Lisp: (count-get) -> number
   * Returns: Current count value (0 if no count active)
   */
  ops.set("count-get", ((args: TLispValue[]): Either<AppError, TLispValue> => {
    const validation = validateArgsCount(args, 0, 0);
    if (Either.isLeft(validation)) {
      return validation;
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
    const validation = validateArgsCount(args, 1, 1);
    if (Either.isLeft(validation)) {
      return validation;
    }

    const countValidation = validateArgType(args[0], "number");
    if (Either.isLeft(countValidation)) {
      return countValidation;
    }

    const count = (args[0] as { type: "number"; value: number }).value;

    if (count < 0) {
      return Either.left(createValidationError("Count must be >= 0"));
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
    const validation = validateArgsCount(args, 0, 0);
    if (Either.isLeft(validation)) {
      return validation;
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
    const validation = validateArgsCount(args, 0, 0);
    if (Either.isLeft(validation)) {
      return validation;
    }

    const count = getCount();
    return Either.right(createBoolean(count > 0));
  }) as TLispFunctionImpl);

  return ops;
}
