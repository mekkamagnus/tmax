/**
 * @file file-ops.ts
 * @description File operations for T-Lisp editor API
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { createValidationError, AppError } from "../../error/types.ts";

/**
 * T-Lisp function implementation that returns Either for error handling
 */
export type TLispFunctionWithEither = (args: TLispValue[]) => Either<AppError, TLispValue>;

/**
 * Create file operations API functions
 * @param operations - Editor operations reference
 * @param setStatusMessage - Function to set status message
 * @returns Map of file function names to implementations
 */
export function createFileOps(
  operations: { saveFile?: () => Promise<void>; openFile?: (filename: string) => Promise<void> } | undefined,
  setStatusMessage: (message: string) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  // File operations - Note: These are placeholders since T-Lisp can't handle async operations
  // File operations should be handled through editor commands instead
  api.set("file-read", (args: TLispValue[]): Either<AppError, TLispValue> => {
    return Either.left(createValidationError(
      'ConstraintViolation',
      'file-read not implemented - use editor file operations instead',
      'operation',
      'file-read',
      'not supported'
    ));
  });

  api.set("file-write", (args: TLispValue[]): Either<AppError, TLispValue> => {
    return Either.left(createValidationError(
      'ConstraintViolation',
      'file-write not implemented - use editor file operations instead',
      'operation',
      'file-write',
      'not supported'
    ));
  });

  return api;
}