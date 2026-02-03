/**
 * @file yank-ops.ts
 * @description Yank (copy) operator operations for T-Lisp editor API (US-1.2.2)
 *
 * Implements Vim-style yank operator:
 * - yank-word: yank word (yw)
 * - yank-line: yank entire line (yy)
 * - yank-to-line-end: yank to end of line (y$)
 * - paste-after: paste after cursor (p)
 * - paste-before: paste before cursor (P)
 * - All functions support count prefix for repeated yanks/pastes
 * - Yanked text stored in register for pasting
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNumber, createNil } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer, Position } from "../../core/types.ts";
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
import { killRingSave } from "./kill-ring.ts";
import { activateYankPopState } from "./yank-pop-ops.ts";

/**
 * Register storage for yanked text
 * Simple implementation using a global variable
 */
let yankRegister: string = "";

/**
 * Get the current content of the yank register
 */
export function getYankRegister(): string {
  return yankRegister;
}

/**
 * Set the yank register content
 */
export function setYankRegister(text: string): void {
  yankRegister = text;
}

/**
 * Check if a character is a word character
 */
function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char);
}

/**
 * Find the end of the current word starting from position
 * Returns the position after the last character of the word
 */
function findWordEnd(
  text: string,
  line: number,
  column: number
): { line: number; column: number } {
  const lines = text.split('\n');

  // Handle empty text
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return { line: 0, column: 0 };
  }

  // Clamp to valid range
  let currentLine = Math.max(0, Math.min(line, lines.length - 1));
  let currentColumn = Math.max(0, Math.min(column, lines[currentLine]!.length - 1));

  const lineText = lines[currentLine]!;

  // If we're not on a word character, find the next word
  if (currentColumn >= lineText.length || !isWordChar(lineText[currentColumn]!)) {
    // Skip non-word characters
    while (currentColumn < lineText.length && !isWordChar(lineText[currentColumn]!)) {
      currentColumn++;
    }

    // If we reached end of line, move to next line
    if (currentColumn >= lineText.length && currentLine < lines.length - 1) {
      currentLine++;
      currentColumn = 0;
      while (currentLine < lines.length && currentColumn >= lines[currentLine]!.length) {
        currentLine++;
        currentColumn = 0;
      }
      return { line: currentLine, column: currentColumn };
    }
  }

  // Now skip through the word
  while (currentColumn < lineText.length && isWordChar(lineText[currentColumn]!)) {
    currentColumn++;
  }

  return { line: currentLine, column: currentColumn };
}

/**
 * Create yank operator API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param setCurrentBuffer - Function to set current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getCursorColumn - Function to get cursor column
 * @param setCursorColumn - Function to set cursor column
 * @returns Map of yank operator function names to implementations
 */
export function createYankOps(
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  getCursorLine: () => number,
  setCursorLine: (line: number) => void,
  getCursorColumn: () => number,
  setCursorColumn: (column: number) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * yank-word - yank word (yw command in Vim)
   * Usage: (yank-word) or (yank-word count)
   */
  api.set("yank-word", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'yank-word requires 0 or 1 argument: optional count',
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
      const typeValidation = validateArgType(countArg, "number", 0, "yank-word");
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
    let startLine = getCursorLine();
    let startColumn = getCursorColumn();
    let endLine = startLine;
    let endColumn = startColumn;

    // Find end position after count words
    for (let i = 0; i < count; i++) {
      const endPos = findWordEnd(text, endLine, endColumn);
      endLine = endPos.line;
      endColumn = endPos.column;
    }

    // Get yanked text for register
    const yankedTextResult = currentBuffer!.getText({
      start: { line: startLine, column: startColumn },
      end: { line: endLine, column: endColumn }
    });

    if (Either.isRight(yankedTextResult)) {
      setYankRegister(yankedTextResult.right);
      killRingSave(yankedTextResult.right);  // Also save to kill ring (US-1.9.1)
    }

    // Yank doesn't modify buffer - just return success
    return Either.right(createNil());
  });

  /**
   * yank-line - yank entire line (yy command in Vim)
   * Usage: (yank-line) or (yank-line count)
   */
  api.set("yank-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'yank-line requires 0 or 1 argument: optional count',
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
      const typeValidation = validateArgType(countArg, "number", 0, "yank-line");
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
    const currentLine = getCursorLine();

    // Clamp to valid range
    const startLine = Math.max(0, Math.min(currentLine, lines.length - 1));
    let endLine = Math.min(startLine + count, lines.length);

    // Get yanked text for register (include newlines for line yanks)
    const yankedTextResult = currentBuffer!.getText({
      start: { line: startLine, column: 0 },
      end: { line: endLine, column: 0 }
    });

    if (Either.isRight(yankedTextResult)) {
      setYankRegister(yankedTextResult.right);
      killRingSave(yankedTextResult.right);  // Also save to kill ring (US-1.9.1)
    }

    // Yank doesn't modify buffer - just return success
    return Either.right(createNil());
  });

  /**
   * yank-to-line-end - yank to end of line (y$ command in Vim)
   * Usage: (yank-to-line-end)
   */
  api.set("yank-to-line-end", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'yank-to-line-end requires 0 arguments',
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
    const currentColumn = getCursorColumn();

    // Clamp to valid range
    const lineIndex = Math.max(0, Math.min(currentLine, lines.length - 1));
    const lineText = lines[lineIndex] || '';
    const endColumn = lineText.length;

    // Get yanked text for register
    const yankedTextResult = currentBuffer!.getText({
      start: { line: currentLine, column: currentColumn },
      end: { line: currentLine, column: endColumn }
    });

    if (Either.isRight(yankedTextResult)) {
      setYankRegister(yankedTextResult.right);
      killRingSave(yankedTextResult.right);  // Also save to kill ring (US-1.9.1)
    }

    // Yank doesn't modify buffer - just return success
    return Either.right(createNil());
  });

  /**
   * paste-after - paste after cursor (p command in Vim)
   * Usage: (paste-after) or (paste-after count)
   */
  api.set("paste-after", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'paste-after requires 0 or 1 argument: optional count',
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
      const typeValidation = validateArgType(countArg, "number", 0, "paste-after");
      if (Either.isLeft(typeValidation)) {
        return Either.left(typeValidation.left);
      }
      count = Math.max(0, countArg.value as number);
    }

    // Check if register has content
    if (yankRegister === "") {
      // Empty register - nothing to paste
      return Either.right(createNil());
    }

    const currentLine = getCursorLine();
    const currentColumn = getCursorColumn();


    // Determine if this is a line paste or character paste
    const isLinePaste = yankRegister.includes('\n');

    if (isLinePaste) {
      // Line paste: paste after current line
      // Get current content to find line end
      const contentResult = currentBuffer!.getContent();
      if (Either.isLeft(contentResult)) {
        return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
      }

      const lines = contentResult.right.split('\n');
      const lineIndex = Math.max(0, Math.min(currentLine, lines.length - 1));

      // To paste after a line, insert at the end of that line
      const currentLineText = lines[lineIndex] || '';
      const insertPos = { line: lineIndex, column: currentLineText.length };

      // Build repeated text
      let pasteText = yankRegister;
      for (let i = 1; i < count; i++) {
        pasteText += yankRegister;
      }

      const insertResult = currentBuffer!.insert(insertPos, pasteText);

      if (Either.isLeft(insertResult)) {
        return Either.left(createBufferError('InvalidOperation', `Failed to paste: ${insertResult.left}`));
      }

      // Update buffer
      setCurrentBuffer(insertResult.right);

      // Move cursor to first non-blank of pasted line
      setCursorLine(currentLine + 1);
      setCursorColumn(0);

      // Activate yank-pop state for M-y support (US-1.9.2)
      activateYankPopState(pasteText, { line: currentLine + 1, column: 0 });
    } else {
      // Character paste: paste after cursor position
      const insertPos = { line: currentLine, column: currentColumn + 1 };

      // Build repeated text
      let pasteText = yankRegister;
      for (let i = 1; i < count; i++) {
        pasteText += yankRegister;
      }

      const insertResult = currentBuffer!.insert(insertPos, pasteText);

      if (Either.isLeft(insertResult)) {
        return Either.left(createBufferError('InvalidOperation', `Failed to paste: ${insertResult.left}`));
      }

      // Update buffer
      setCurrentBuffer(insertResult.right);

      // Move cursor to first character of pasted text
      setCursorLine(currentLine);
      setCursorColumn(currentColumn + 1);

      // Activate yank-pop state for M-y support (US-1.9.2)
      activateYankPopState(pasteText, insertPos);
    }

    return Either.right(createNil());
  });

  /**
   * paste-before - paste before cursor (P command in Vim)
   * Usage: (paste-before) or (paste-before count)
   */
  api.set("paste-before", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'paste-before requires 0 or 1 argument: optional count',
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
      const typeValidation = validateArgType(countArg, "number", 0, "paste-before");
      if (Either.isLeft(typeValidation)) {
        return Either.left(typeValidation.left);
      }
      count = Math.max(0, countArg.value as number);
    }

    // Check if register has content
    if (yankRegister === "") {
      // Empty register - nothing to paste
      return Either.right(createNil());
    }

    const currentLine = getCursorLine();
    const currentColumn = getCursorColumn();

    // Determine if this is a line paste or character paste
    const isLinePaste = yankRegister.includes('\n');

    if (isLinePaste) {
      // Line paste: paste before current line (at current line, column 0)
      // Build repeated text
      let pasteText = yankRegister;
      for (let i = 1; i < count; i++) {
        pasteText += yankRegister;
      }

      const insertPos = { line: currentLine, column: 0 };
      const insertResult = currentBuffer!.insert(insertPos, pasteText);

      if (Either.isLeft(insertResult)) {
        return Either.left(createBufferError('InvalidOperation', `Failed to paste: ${insertResult.left}`));
      }

      // Update buffer
      setCurrentBuffer(insertResult.right);

      // Move cursor to first non-blank of pasted line
      setCursorLine(currentLine);
      setCursorColumn(0);

      // Activate yank-pop state for M-y support (US-1.9.2)
      activateYankPopState(pasteText, { line: currentLine, column: 0 });
    } else {
      // Character paste: paste before cursor position
      const insertPos = { line: currentLine, column: currentColumn };

      // Build repeated text
      let pasteText = yankRegister;
      for (let i = 1; i < count; i++) {
        pasteText += yankRegister;
      }

      const insertResult = currentBuffer!.insert(insertPos, pasteText);

      if (Either.isLeft(insertResult)) {
        return Either.left(createBufferError('InvalidOperation', `Failed to paste: ${insertResult.left}`));
      }

      // Update buffer
      setCurrentBuffer(insertResult.right);

      // Move cursor to first character of pasted text
      setCursorLine(currentLine);
      setCursorColumn(currentColumn);

      // Activate yank-pop state for M-y support (US-1.9.2)
      activateYankPopState(pasteText, insertPos);
    }

    return Either.right(createNil());
  });

  /**
   * yank-register-get - get content of yank register
   * Usage: (yank-register-get)
   */
  api.set("yank-register-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'yank-register-get requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    return Either.right({ type: 'string', value: yankRegister });
  });

  /**
   * yank-register-set - set content of yank register (for testing)
   * Usage: (yank-register-set "text")
   */
  api.set("yank-register-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'yank-register-set requires 1 argument: text',
        'args',
        args,
        '1 argument'
      ));
    }

    const textArg = args[0];
    if (textArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'yank-register-set argument must be a string',
        'args[0]',
        textArg,
        'string'
      ));
    }

    setYankRegister(textArg.value);
    return Either.right(createNil());
  });

  return api;
}
