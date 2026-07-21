/**
 * @file cursor-ops.ts
 * @description Cursor operations for T-Lisp editor API
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../../tlisp/values.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import type { EditorModel } from "../functional/model.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
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
  access: EditorModelAccess,
  setCursorLine: (line: number) => void,
  setCursorColumn: (column: number) => void,
  getMode?: () => EditorModel["mode"],
  updateVisualSelection?: () => void
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: cursor/buffer reads flow through the State monad against
  // EditorModel (equivalent to the bridge getters, which proxy
  // model.cursorPosition / model.currentBuffer). Cursor writes stay on the
  // supplied setters so window-tracking/fold side effects are preserved.
  const getCursorLine = (): number => runModel(access, readModelField("cursorPosition")).line;
  const getCursorColumn = (): number => runModel(access, readModelField("cursorPosition")).column;
  const getCurrentBuffer = (): TextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const api = new Map<string, TLispFunctionImpl>();

  api.set("cursor-position", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "cursor-position");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createList([createNumber(getCursorLine()), createNumber(getCursorColumn())]));
  });

  /**
   * scan-number-on-line - SPEC-067 factual scan for vim C-a/C-x.
   * Finds the decimal number at or after COL on LINE. If the cursor sits on a
   * digit, the whole digit run containing it is used; otherwise scans forward.
   * A leading '-' counts as part of the number only when preceded by a
   * non-digit (so "-5" is negative, but "5-3"'s '-' does not invert the 3).
   * This is character-scanning on a line (a TS primitive per the editor C/Lisp
   * split); the +/-count decision and replacement live in T-Lisp.
   * Usage: (scan-number-on-line LINE COL) → (start-col end-col-excl text) | nil
   */
  api.set("scan-number-on-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "scan-number-on-line");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0]!;
    const lineTypeValidation = validateArgType(lineArg, "number", 0, "scan-number-on-line");
    if (Either.isLeft(lineTypeValidation)) {
      return Either.left(lineTypeValidation.left);
    }
    const colArg = args[1]!;
    const colTypeValidation = validateArgType(colArg, "number", 1, "scan-number-on-line");
    if (Either.isLeft(colTypeValidation)) {
      return Either.left(colTypeValidation.left);
    }

    const line = lineArg.value as number;
    const col = colArg.value as number;
    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const lines = contentResult.right.split('\n');
    if (line < 0 || line >= lines.length) {
      return Either.right(createNil());
    }

    const text = lines[line]!;
    const isDigit = (c: string | undefined): boolean => !!c && c >= '0' && c <= '9';

    let i = col;
    if (i < 0) i = 0;
    if (!isDigit(text[i])) {
      // Cursor not on a digit — scan forward for the first digit.
      while (i < text.length && !isDigit(text[i])) {
        i++;
      }
      if (i >= text.length) {
        return Either.right(createNil()); // no number on the rest of the line
      }
    } else {
      // Cursor on a digit — back up to the first digit of this run.
      while (i > 0 && isDigit(text[i - 1]!)) {
        i--;
      }
    }

    const digitStart = i;
    let end = digitStart;
    while (end < text.length && isDigit(text[end])) {
      end++;
    }

    // A leading '-' belongs to the number only when preceded by a non-digit.
    let start = digitStart;
    if (digitStart > 0 && text[digitStart - 1] === '-') {
      const prev = digitStart - 2 >= 0 ? text[digitStart - 2]! : '';
      if (!isDigit(prev)) {
        start = digitStart - 1;
      }
    }

    return Either.right(createList([
      createNumber(start),
      createNumber(end),
      createString(text.slice(start, end))
    ]));
  });

  api.set("cursor-move", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "cursor-move");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0]!
    const lineTypeValidation = validateArgType(lineArg, "number", 0, "cursor-move");
    if (Either.isLeft(lineTypeValidation)) {
      return Either.left(lineTypeValidation.left);
    }

    const columnArg = args[1]!
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