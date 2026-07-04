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
import { createList, createNumber, createNil } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer } from "../../core/types.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
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
import { findFirstNonBlankColumn } from "./text-utils.ts";

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
 * Create jump commands API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getCursorColumn - Function to get cursor column
 * @param setCursorColumn - Function to set cursor column
 * @returns Map of jump command function names to implementations
 */
export function createJumpOps(
  access: EditorModelAccess,
  setCursorLine: (line: number) => void,
  setCursorColumn: (column: number) => void,
  setViewportTop?: (top: number) => void,
  getTerminalHeightFn?: () => number,
  setViewportLeft?: (left: number) => void,
  getTerminalWidthFn?: () => number,
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: cursor/buffer/viewport reads flow through the State monad
  // against EditorModel; writes + terminal-size accessors stay on callbacks.
  const getCursorLine = (): number => runModel(access, readModelField("cursorPosition")).line;
  const getCursorColumn = (): number => runModel(access, readModelField("cursorPosition")).column;
  const getCurrentBuffer = (): FunctionalTextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const getViewportTop = (): number => runModel(access, readModelField("viewportTop"));
  const getViewportLeft = (): number => runModel(access, readModelField("viewportLeft")) ?? 0;
  const api = new Map<string, TLispFunctionImpl>();
  const terminalHeight = (): number => getTerminalHeightFn?.() ?? getTerminalHeight();

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

    const lineArg = args[0]!
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
    const pageSize = terminalHeight();

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
    const pageSize = terminalHeight();

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
    const halfPageSize = Math.floor(terminalHeight() / 2);

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
    const halfPageSize = Math.floor(terminalHeight() / 2);

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

  api.set("find-char-position", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 4, "find-char-position");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const charArg = args[0]!
    const charValidation = validateArgType(charArg, "string", 0, "find-char-position");
    if (Either.isLeft(charValidation)) {
      return Either.left(charValidation.left);
    }

    const directionArg = args[1]!
    const directionValidation = validateArgType(directionArg, "string", 1, "find-char-position");
    if (Either.isLeft(directionValidation)) {
      return Either.left(directionValidation.left);
    }

    const tillArg = args[2]!
    const tillValidation = validateArgType(tillArg, "boolean", 2, "find-char-position");
    if (Either.isLeft(tillValidation)) {
      return Either.left(tillValidation.left);
    }

    const countArg = args[3]!
    const countValidation = validateArgType(countArg, "number", 3, "find-char-position");
    if (Either.isLeft(countValidation)) {
      return Either.left(countValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const target = (charArg.value as string)[0];
    if (!target) {
      return Either.right(createNil());
    }

    const direction = directionArg.value as string;
    const backward = direction === "backward";
    const till = tillArg.value as boolean;
    const count = Math.max(1, countArg.value as number);
    const lineResult = currentBuffer!.getLine(getCursorLine());
    if (Either.isLeft(lineResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line: ${lineResult.left}`));
    }

    const line = lineResult.right;
    let seen = 0;
    let foundColumn = -1;
    if (backward) {
      for (let i = Math.min(getCursorColumn() - 1, line.length - 1); i >= 0; i--) {
        if (line[i] === target) {
          seen++;
          if (seen === count) {
            foundColumn = till ? Math.min(i + 1, line.length) : i;
            break;
          }
        }
      }
    } else {
      for (let i = Math.max(0, getCursorColumn() + 1); i < line.length; i++) {
        if (line[i] === target) {
          seen++;
          if (seen === count) {
            foundColumn = till ? Math.max(0, i - 1) : i;
            break;
          }
        }
      }
    }

    if (foundColumn < 0) {
      return Either.right(createNil());
    }

    return Either.right(createList([createNumber(getCursorLine()), createNumber(foundColumn)]));
  });

  api.set("match-bracket-position", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "match-bracket-position");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const lines = contentResult.right.split("\n");
    const line = Math.max(0, Math.min(getCursorLine(), lines.length - 1));
    const column = Math.max(0, getCursorColumn());
    const currentLine = lines[line] ?? "";
    const char = currentLine[column];
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}", ")": "(", "]": "[", "}": "{" };
    const match = char ? pairs[char] : undefined;
    if (!char || !match) {
      return Either.right(createNil());
    }

    const opening = char === "(" || char === "[" || char === "{";
    let depth = 0;
    if (opening) {
      for (let l = line; l < lines.length; l++) {
        const text = lines[l] ?? "";
        const start = l === line ? column : 0;
        for (let c = start; c < text.length; c++) {
          const ch = text[c];
          if (ch === char) depth++;
          if (ch === match) depth--;
          if (depth === 0) {
            return Either.right(createList([createNumber(l), createNumber(c)]));
          }
        }
      }
    } else {
      for (let l = line; l >= 0; l--) {
        const text = lines[l] ?? "";
        const start = l === line ? column : text.length - 1;
        for (let c = start; c >= 0; c--) {
          const ch = text[c];
          if (ch === char) depth++;
          if (ch === match) depth--;
          if (depth === 0) {
            return Either.right(createList([createNumber(l), createNumber(c)]));
          }
        }
      }
    }

    return Either.right(createNil());
  });

  api.set("paragraph-boundary-position", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "paragraph-boundary-position");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const directionArg = args[0]!
    const directionValidation = validateArgType(directionArg, "string", 0, "paragraph-boundary-position");
    if (Either.isLeft(directionValidation)) {
      return Either.left(directionValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const lines = contentResult.right.split("\n");
    const direction = directionArg.value as string;
    if (direction === "backward") {
      for (let i = getCursorLine() - 1; i >= 0; i--) {
        if ((lines[i] ?? "").trim() === "") {
          return Either.right(createList([createNumber(i), createNumber(0)]));
        }
      }
      return Either.right(createList([createNumber(0), createNumber(0)]));
    }

    for (let i = getCursorLine() + 1; i < lines.length; i++) {
      if ((lines[i] ?? "").trim() === "") {
        return Either.right(createList([createNumber(i), createNumber(0)]));
      }
    }

    return Either.right(createList([createNumber(Math.max(0, lines.length - 1)), createNumber(0)]));
  });

  api.set("viewport-top-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "viewport-top-get");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    return Either.right(createNumber(getViewportTop?.() ?? 0));
  });

  api.set("viewport-top-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "viewport-top-set");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const topArg = args[0]!
    const topValidation = validateArgType(topArg, "number", 0, "viewport-top-set");
    if (Either.isLeft(topValidation)) {
      return Either.left(topValidation.left);
    }

    const top = Math.max(0, topArg.value as number);
    setViewportTop?.(top);
    return Either.right(createNumber(top));
  });

  api.set("terminal-height-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "terminal-height-get");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    return Either.right(createNumber(terminalHeight()));
  });

  api.set("viewport-left-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "viewport-left-get");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    return Either.right(createNumber(getViewportLeft?.() ?? 0));
  });

  api.set("viewport-left-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "viewport-left-set");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const leftArg = args[0]!
    const leftValidation = validateArgType(leftArg, "number", 0, "viewport-left-set");
    if (Either.isLeft(leftValidation)) {
      return Either.left(leftValidation.left);
    }

    const left = Math.max(0, leftArg.value as number);
    setViewportLeft?.(left);
    return Either.right(createNumber(left));
  });

  api.set("terminal-width-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "terminal-width-get");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    return Either.right(createNumber(getTerminalWidthFn?.() ?? 80));
  });

  return api;
}
