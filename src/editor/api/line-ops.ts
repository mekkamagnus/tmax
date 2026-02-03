/**
 * @file line-ops.ts
 * @description Line navigation operations for T-Lisp editor API (US-1.1.2)
 *
 * Implements Vim-style line navigation:
 * - line-first-column: move to first column (0 key)
 * - line-last-column: move to last non-empty column ($ key)
 * - line-first-non-blank: move to first non-blank column (_ key)
 * - line-previous: move to first non-blank of previous line (- key)
 * - line-next: move to first non-blank of next line (+ key)
 * - All functions support count prefix for repeated movements
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNumber, createNil } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType,
  validateBufferExists
} from "../../utils/validation.ts";
import {
  createValidationError,
  createBufferError,
  AppError
} from "../../error/types.ts";

/**
 * Find the first non-blank column in a line
 * @param lineText - Text of the line
 * @returns Column index of first non-blank character
 */
function findFirstNonBlankColumn(lineText: string): number {
  let column = 0;
  while (column < lineText.length && /\s/.test(lineText[column]!)) {
    column++;
  }
  return column;
}

/**
 * Find the last non-empty column in a line
 * @param lineText - Text of the line
 * @returns Column index of last non-whitespace character
 */
function findLastNonEmptyColumn(lineText: string): number {
  let column = lineText.length - 1;
  while (column >= 0 && /\s/.test(lineText[column]!)) {
    column--;
  }
  return column < 0 ? 0 : column;
}

/**
 * Create line navigation API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getCursorColumn - Function to get cursor column
 * @param setCursorColumn - Function to set cursor column
 * @returns Map of line navigation function names to implementations
 */
export function createLineOps(
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  getCursorLine: () => number,
  setCursorLine: (line: number) => void,
  getCursorColumn: () => number,
  setCursorColumn: (column: number) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * line-first-column - move to first column (0 key in Vim)
   * Usage: (line-first-column)
   */
  api.set("line-first-column", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'line-first-column requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    // Move to column 0
    setCursorColumn(0);

    return Either.right(createNil());
  });

  /**
   * line-last-column - move to last non-empty column ($ key in Vim)
   * Usage: (line-last-column)
   */
  api.set("line-last-column", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'line-last-column requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    // Get buffer content
    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    const lines = text.split('\n');
    const currentLine = getCursorLine();

    // Clamp to valid range
    const lineIndex = Math.max(0, Math.min(currentLine, lines.length - 1));
    const lineText = lines[lineIndex] || '';

    // Find last non-empty column
    const lastColumn = findLastNonEmptyColumn(lineText);
    setCursorColumn(lastColumn);

    return Either.right(createNil());
  });

  /**
   * line-first-non-blank - move to first non-blank column (_ key in Vim)
   * Usage: (line-first-non-blank)
   */
  api.set("line-first-non-blank", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'line-first-non-blank requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    // Get buffer content
    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    const lines = text.split('\n');
    const currentLine = getCursorLine();

    // Clamp to valid range
    const lineIndex = Math.max(0, Math.min(currentLine, lines.length - 1));
    const lineText = lines[lineIndex] || '';

    // Find first non-blank column
    const firstNonBlank = findFirstNonBlankColumn(lineText);
    setCursorColumn(firstNonBlank);

    return Either.right(createNil());
  });

  /**
   * line-previous - move to first non-blank of previous line (- key in Vim)
   * Usage: (line-previous) or (line-previous count)
   */
  api.set("line-previous", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'line-previous requires 0 or 1 argument: optional count',
        'args',
        args,
        '0 or 1 arguments'
      ));
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    // Get count (default to 1)
    let count = 1;
    if (args.length === 1) {
      const countArg = args[0];
      const typeValidation = validateArgType(countArg, "number", 0, "line-previous");
      if (Either.isLeft(typeValidation)) {
        return Either.left(typeValidation.left);
      }
      count = Math.max(0, countArg.value as number);
    }

    // Get buffer content
    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    const lines = text.split('\n');
    let currentLine = getCursorLine();

    // Move up by count lines
    for (let i = 0; i < count; i++) {
      if (currentLine > 0) {
        currentLine--;
      }
    }

    // Clamp to valid range
    currentLine = Math.max(0, currentLine);
    const lineIndex = Math.min(currentLine, lines.length - 1);
    const lineText = lines[lineIndex] || '';

    // Move to first non-blank column
    const firstNonBlank = findFirstNonBlankColumn(lineText);
    setCursorLine(currentLine);
    setCursorColumn(firstNonBlank);

    return Either.right(createNil());
  });

  /**
   * line-next - move to first non-blank of next line (+ key in Vim)
   * Usage: (line-next) or (line-next count)
   */
  api.set("line-next", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'line-next requires 0 or 1 argument: optional count',
        'args',
        args,
        '0 or 1 arguments'
      ));
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    // Get count (default to 1)
    let count = 1;
    if (args.length === 1) {
      const countArg = args[0];
      const typeValidation = validateArgType(countArg, "number", 0, "line-next");
      if (Either.isLeft(typeValidation)) {
        return Either.left(typeValidation.left);
      }
      count = Math.max(0, countArg.value as number);
    }

    // Get buffer content
    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    const lines = text.split('\n');
    let currentLine = getCursorLine();

    // Move down by count lines
    for (let i = 0; i < count; i++) {
      if (currentLine < lines.length - 1) {
        currentLine++;
      }
    }

    // Clamp to valid range
    currentLine = Math.min(currentLine, lines.length - 1);
    const lineText = lines[currentLine] || '';

    // Move to first non-blank column
    const firstNonBlank = findFirstNonBlankColumn(lineText);
    setCursorLine(currentLine);
    setCursorColumn(firstNonBlank);

    return Either.right(createNil());
  });

  return api;
}
