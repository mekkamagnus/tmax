/**
 * @file cursor-ops.ts
 * @description Cursor operations for T-Lisp editor API
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType,
  validateBufferExists
} from "../../utils/validation.ts";
import {
  ValidationError,
  createValidationError,
  createBufferError,
  AppError
} from "../../error/types.ts";

/**
 * T-Lisp function implementation that returns Either for error handling
 */
export type TLispFunctionWithEither = (args: TLispValue[]) => Either<AppError, TLispValue>;

/**
 * Create cursor operations API functions
 * @param getCursorLine - Function to get current cursor line
 * @param setCursorLine - Function to set current cursor line
 * @param getCursorColumn - Function to get current cursor column
 * @param setCursorColumn - Function to set current cursor column
 * @param getCurrentBuffer - Function to get current buffer
 * @param getMode - Function to get current editor mode (optional)
 * @param updateVisualSelection - Function to update visual selection (optional)
 * @returns Map of cursor function names to implementations
 */
export function createCursorOps(
  getCursorLine: () => number,
  setCursorLine: (line: number) => void,
  getCursorColumn: () => number,
  setCursorColumn: (column: number) => void,
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  getMode?: () => "normal" | "insert" | "visual" | "command" | "mx",
  updateVisualSelection?: () => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  api.set("cursor-position", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "cursor-position");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createList([createNumber(getCursorLine()), createNumber(getCursorColumn())]));
  });

  api.set("cursor-move", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "cursor-move");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0];
    const lineTypeValidation = validateArgType(lineArg, "number", 0, "cursor-move");
    if (Either.isLeft(lineTypeValidation)) {
      return Either.left(lineTypeValidation.left);
    }

    const columnArg = args[1];
    const columnTypeValidation = validateArgType(columnArg, "number", 1, "cursor-move");
    if (Either.isLeft(columnTypeValidation)) {
      return Either.left(columnTypeValidation.left);
    }

    const line = lineArg.value as number;
    const column = columnArg.value as number;

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const lineCountResult = currentBuffer!.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line count: ${lineCountResult.left}`));
    }

    const maxLine = lineCountResult.right;
    const targetLine = Math.max(0, Math.min(line, maxLine - 1));

    const lineResult = currentBuffer!.getLine(targetLine);
    if (Either.isLeft(lineResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line: ${lineResult.left}`));
    }

    const lineLength = lineResult.right.length;
    const targetColumn = Math.max(0, Math.min(column, lineLength));

    setCursorLine(targetLine);
    setCursorColumn(targetColumn);

    // Update visual selection if in visual mode
    if (getMode && updateVisualSelection && getMode() === "visual") {
      try {
        updateVisualSelection();
      } catch (error) {
        // Ignore errors from visual update
      }
    }

    return Either.right(createList([createNumber(getCursorLine()), createNumber(getCursorColumn())]));
  });

  api.set("cursor-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "cursor-line");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createNumber(getCursorLine()));
  });

  api.set("cursor-column", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "cursor-column");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createNumber(getCursorColumn()));
  });

  return api;
}