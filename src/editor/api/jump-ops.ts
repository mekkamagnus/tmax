/**
 * @file jump-ops.ts
 * @description Jump commands for T-Lisp editor API (US-1.6.1)
 *
 * Implements Vim-style jump commands:
 * - jump-to-first-line: move to first line (gg key)
 * - jump-to-last-line: move to last line (G key)
 * - jump-to-line: move to specific line with count (50G)
 * - page-down: scroll down one full page (Ctrl+f)
 * - page-up: scroll up one full page (Ctrl+b)
 * - half-page-down: scroll down half page (Ctrl+d)
 * - half-page-up: scroll up half page (Ctrl+u)
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
 * Get terminal height for page size calculation
 * Default to 24 lines if terminal dimensions not available
 */
function getTerminalHeight(): number {
  // Try to get terminal height from environment
  // Default to 24 lines (typical terminal height)
  return 24;
}

/**
 * Get half page size (half of terminal height)
 */
function getHalfPageSize(): number {
  return Math.floor(getTerminalHeight() / 2);
}

/**
 * Create jump commands API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getCursorColumn - Function to get cursor column
 * @param setCursorColumn - Function to set cursor column
 * @returns Map of jump command function names to implementations
 */
export function createJumpOps(
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  getCursorLine: () => number,
  setCursorLine: (line: number) => void,
  getCursorColumn: () => number,
  setCursorColumn: (column: number) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * jump-to-first-line - move to first line (gg key in Vim)
   * Usage: (jump-to-first-line)
   */
  api.set("jump-to-first-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'jump-to-first-line requires 0 arguments',
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

    // Get buffer content to find first non-blank column
    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    const lines = text.split('\n');
    const firstLine = lines[0] || '';

    // Find first non-blank column
    const firstNonBlank = findFirstNonBlankColumn(firstLine);

    // Move to first line, first non-blank column
    setCursorLine(0);
    setCursorColumn(firstNonBlank);

    return Either.right(createNil());
  });

  /**
   * jump-to-last-line - move to last line (G key in Vim)
   * Usage: (jump-to-last-line)
   */
  api.set("jump-to-last-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'jump-to-last-line requires 0 arguments',
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
    const lastLineIndex = Math.max(0, lines.length - 1);
    const lastLine = lines[lastLineIndex] || '';

    // Find first non-blank column
    const firstNonBlank = findFirstNonBlankColumn(lastLine);

    // Move to last line, first non-blank column
    setCursorLine(lastLineIndex);
    setCursorColumn(firstNonBlank);

    return Either.right(createNil());
  });

  /**
   * jump-to-line - move to specific line with count ({count}G in Vim)
   * Usage: (jump-to-line 50)
   * Note: Line numbers are 1-indexed (1 = first line)
   */
  api.set("jump-to-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Exactly 1 argument required
    const argsValidation = validateArgsCount(args, 1, "jump-to-line");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const lineArg = args[0];
    const typeValidation = validateArgType(lineArg, "number", 0, "jump-to-line");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const lineNum = lineArg.value as number;

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

    // Convert 1-indexed line number to 0-indexed
    // Line 0 or 1 should go to first line (index 0)
    let targetLine = Math.max(0, lineNum - 1);

    // Clamp to valid range
    targetLine = Math.min(targetLine, lines.length - 1);

    const targetLineText = lines[targetLine] || '';

    // Find first non-blank column
    const firstNonBlank = findFirstNonBlankColumn(targetLineText);

    // Move to target line, first non-blank column
    setCursorLine(targetLine);
    setCursorColumn(firstNonBlank);

    return Either.right(createNil());
  });

  /**
   * page-down - scroll down one full page (Ctrl+f in Vim)
   * Usage: (page-down)
   */
  api.set("page-down", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'page-down requires 0 arguments',
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
    const pageSize = getTerminalHeight();

    // Move down by page size, but don't exceed last line
    let targetLine = Math.min(currentLine + pageSize, lines.length - 1);
    targetLine = Math.max(0, targetLine);

    const targetLineText = lines[targetLine] || '';

    // Find first non-blank column
    const firstNonBlank = findFirstNonBlankColumn(targetLineText);

    // Move to target line, first non-blank column
    setCursorLine(targetLine);
    setCursorColumn(firstNonBlank);

    return Either.right(createNil());
  });

  /**
   * page-up - scroll up one full page (Ctrl+b in Vim)
   * Usage: (page-up)
   */
  api.set("page-up", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'page-up requires 0 arguments',
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
    const pageSize = getTerminalHeight();

    // Move up by page size, but don't go before first line
    let targetLine = Math.max(currentLine - pageSize, 0);
    targetLine = Math.min(targetLine, lines.length - 1);

    const targetLineText = lines[targetLine] || '';

    // Find first non-blank column
    const firstNonBlank = findFirstNonBlankColumn(targetLineText);

    // Move to target line, first non-blank column
    setCursorLine(targetLine);
    setCursorColumn(firstNonBlank);

    return Either.right(createNil());
  });

  /**
   * half-page-down - scroll down half a page (Ctrl+d in Vim)
   * Usage: (half-page-down)
   */
  api.set("half-page-down", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'half-page-down requires 0 arguments',
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
    const halfPageSize = getHalfPageSize();

    // Move down by half page size, but don't exceed last line
    let targetLine = Math.min(currentLine + halfPageSize, lines.length - 1);
    targetLine = Math.max(0, targetLine);

    const targetLineText = lines[targetLine] || '';

    // Find first non-blank column
    const firstNonBlank = findFirstNonBlankColumn(targetLineText);

    // Move to target line, first non-blank column
    setCursorLine(targetLine);
    setCursorColumn(firstNonBlank);

    return Either.right(createNil());
  });

  /**
   * half-page-up - scroll up half a page (Ctrl+u in Vim)
   * Usage: (half-page-up)
   */
  api.set("half-page-up", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'half-page-up requires 0 arguments',
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
    const halfPageSize = getHalfPageSize();

    // Move up by half page size, but don't go before first line
    let targetLine = Math.max(currentLine - halfPageSize, 0);
    targetLine = Math.min(targetLine, lines.length - 1);

    const targetLineText = lines[targetLine] || '';

    // Find first non-blank column
    const firstNonBlank = findFirstNonBlankColumn(targetLineText);

    // Move to target line, first non-blank column
    setCursorLine(targetLine);
    setCursorColumn(firstNonBlank);

    return Either.right(createNil());
  });

  return api;
}
