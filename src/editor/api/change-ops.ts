/**
 * @file change-ops.ts
 * @description Change operator operations for T-Lisp editor API (US-1.4.1)
 *
 * Implements Vim-style change operator:
 * - change-word: delete word and enter insert mode (cw)
 * - change-line: clear line and enter insert mode (cc)
 * - change-to-line-end: delete to end of line and enter insert mode (c$)
 * - All functions support count prefix for repeated changes
 * - Deleted text stored in register for pasting
 * - After deletion, editor switches to insert mode
 * - Deleted text also added to kill ring (US-1.9.1)
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil } from "../../tlisp/values.ts";
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
import { killRingSave } from "./kill-ring.ts";
import { registerDelete } from "./evil-integration.ts";

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
 * Create change operator API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param setCurrentBuffer - Function to set current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getCursorColumn - Function to get cursor column
 * @param setCursorColumn - Function to set cursor column
 * @param setMode - Function to set editor mode (for switching to insert mode)
 * @param setDeleteRegister - Function to set delete register (for storing deleted text)
 * @returns Map of change operator function names to implementations
 */
export function createChangeOps(
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  getCursorLine: () => number,
  setCursorLine: (line: number) => void,
  getCursorColumn: () => number,
  setCursorColumn: (column: number) => void,
  setMode: (mode: "normal" | "insert" | "visual" | "command" | "mx") => void,
  setDeleteRegister: (text: string) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * change-word - delete word and enter insert mode (cw command in Vim)
   * Usage: (change-word) or (change-word count)
   */
  api.set("change-word", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'change-word requires 0 or 1 argument: optional count',
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
      const typeValidation = validateArgType(countArg, "number", 0, "change-word");
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

    // Get deleted text for register
    const deletedTextResult = currentBuffer!.getText({
      start: { line: startLine, column: startColumn },
      end: { line: endLine, column: endColumn }
    });

    if (Either.isRight(deletedTextResult)) {
      setDeleteRegister(deletedTextResult.right);  // Legacy register
      registerDelete(deletedTextResult.right, false);  // Evil Integration (US-1.9.3)
    }

    // Perform deletion
    const deleteResult = currentBuffer!.delete({
      start: { line: startLine, column: startColumn },
      end: { line: endLine, column: endColumn }
    });

    if (Either.isLeft(deleteResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to delete: ${deleteResult.left}`));
    }

    // Update buffer
    setCurrentBuffer(deleteResult.right);

    // Update cursor position (move to start of deleted text)
    setCursorLine(startLine);
    setCursorColumn(startColumn);

    // Switch to insert mode
    setMode("insert");

    return Either.right(createNil());
  });

  /**
   * change-line - clear line and enter insert mode (cc command in Vim)
   * Usage: (change-line) or (change-line count)
   */
  api.set("change-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'change-line requires 0 or 1 argument: optional count',
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
      const typeValidation = validateArgType(countArg, "number", 0, "change-line");
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

    // Get deleted text for register
    const deletedTextResult = currentBuffer!.getText({
      start: { line: startLine, column: 0 },
      end: { line: endLine, column: 0 }
    });

    if (Either.isRight(deletedTextResult)) {
      setDeleteRegister(deletedTextResult.right);  // Legacy register
      registerDelete(deletedTextResult.right, false);  // Evil Integration (US-1.9.3)
    }

    // Perform deletion
    const deleteResult = currentBuffer!.delete({
      start: { line: startLine, column: 0 },
      end: { line: endLine, column: 0 }
    });

    if (Either.isLeft(deleteResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to delete: ${deleteResult.left}`));
    }

    // Update buffer
    setCurrentBuffer(deleteResult.right);

    // Move cursor to start of cleared line(s)
    setCursorLine(startLine);
    setCursorColumn(0);

    // Switch to insert mode
    setMode("insert");

    return Either.right(createNil());
  });

  /**
   * change-to-line-end - delete to end of line and enter insert mode (c$ command in Vim)
   * Usage: (change-to-line-end)
   */
  api.set("change-to-line-end", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'change-to-line-end requires 0 arguments',
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

    // Get deleted text for register
    const deletedTextResult = currentBuffer!.getText({
      start: { line: currentLine, column: currentColumn },
      end: { line: currentLine, column: endColumn }
    });

    if (Either.isRight(deletedTextResult)) {
      setDeleteRegister(deletedTextResult.right);  // Legacy register
      registerDelete(deletedTextResult.right, false);  // Evil Integration (US-1.9.3)
    }

    // Perform deletion
    const deleteResult = currentBuffer!.delete({
      start: { line: currentLine, column: currentColumn },
      end: { line: currentLine, column: endColumn }
    });

    if (Either.isLeft(deleteResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to delete: ${deleteResult.left}`));
    }

    // Update buffer
    setCurrentBuffer(deleteResult.right);

    // Keep cursor at same position (which is now at end of shortened line)
    setCursorLine(currentLine);
    setCursorColumn(Math.min(currentColumn, lineText.length));

    // Switch to insert mode
    setMode("insert");

    return Either.right(createNil());
  });

  return api;
}
