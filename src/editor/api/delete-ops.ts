/**
 * @file delete-ops.ts
 * @description Delete operator operations for T-Lisp editor API (US-1.2.1)
 *
 * Implements Vim-style delete operator:
 * - delete-word: delete word (dw)
 * - delete-to-line-end: delete to end of line (d$)
 * - delete-line: delete current line (dd)
 * - delete-to-sentence-end: delete to end of sentence (d))
 * - All functions support count prefix for repeated deletions
 * - Deleted text stored in register for pasting
 * - Deleted text also added to kill ring (US-1.9.1)
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNumber, createString, createNil } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer, Position, Range } from "../../core/types.ts";
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
import { registerDelete, resetRegisterState } from "./evil-integration.ts";

/**
 * Register storage for deleted text (legacy, for backward compatibility)
 * @deprecated Use registerDelete from evil-integration.ts instead
 */
let deleteRegister: string = "";

/**
 * Get the current content of the delete register
 * @deprecated Use getRegister('"') from evil-integration.ts instead
 */
export function getDeleteRegister(): string {
  return deleteRegister;
}

/**
 * Set the delete register content
 * @deprecated Use registerDelete from evil-integration.ts instead
 */
export function setDeleteRegister(text: string): void {
  deleteRegister = text;
}

/**
 * Reset delete register state (for testing)
 */
export function resetDeleteRegisterState(): void {
  deleteRegister = "";
  resetRegisterState();
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
 * Find the end of the current sentence
 * Sentences end with . ! or ? followed by whitespace or end of text
 */
function findSentenceEnd(
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
  let currentColumn = Math.max(0, column);

  // Sentence terminators
  const terminators = ['.', '!', '?'];

  // Scan forward for sentence terminator
  while (currentLine < lines.length) {
    const lineText = lines[currentLine]!;

    while (currentColumn < lineText.length) {
      const char = lineText[currentColumn]!;

      if (terminators.includes(char)) {
        // Found terminator, move to next position
        currentColumn++;

        // Skip whitespace after terminator
        while (currentColumn < lineText.length && /\s/.test(lineText[currentColumn]!)) {
          currentColumn++;
        }

        // If we're at end of line, move to next line
        if (currentColumn >= lineText.length && currentLine < lines.length - 1) {
          currentLine++;
          currentColumn = 0;
        }

        return { line: currentLine, column: currentColumn };
      }

      currentColumn++;
    }

    // Move to next line
    currentLine++;
    currentColumn = 0;
  }

  // No sentence end found, return end of text
  return {
    line: lines.length - 1,
    column: lines[lines.length - 1]?.length || 0
  };
}

/**
 * Create delete operator API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param setCurrentBuffer - Function to set current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getCursorColumn - Function to get cursor column
 * @param setCursorColumn - Function to set cursor column
 * @returns Map of delete operator function names to implementations
 */
export function createDeleteOps(
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  getCursorLine: () => number,
  setCursorLine: (line: number) => void,
  getCursorColumn: () => number,
  setCursorColumn: (column: number) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * delete-word - delete word (dw command in Vim)
   * Usage: (delete-word) or (delete-word count)
   */
  api.set("delete-word", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'delete-word requires 0 or 1 argument: optional count',
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
      const typeValidation = validateArgType(countArg, "number", 0, "delete-word");
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

    return Either.right(createNil());
  });

  /**
   * delete-to-line-end - delete to end of line (d$ command in Vim)
   * Usage: (delete-to-line-end)
   */
  api.set("delete-to-line-end", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'delete-to-line-end requires 0 arguments',
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

    return Either.right(createNil());
  });

  /**
   * delete-line - delete current line (dd command in Vim)
   * Usage: (delete-line) or (delete-line count)
   */
  api.set("delete-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'delete-line requires 0 or 1 argument: optional count',
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
      const typeValidation = validateArgType(countArg, "number", 0, "delete-line");
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
      registerDelete(deletedTextResult.right, true);  // Evil Integration - line delete (US-1.9.3)
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

    // Move cursor to first non-blank of line after deleted lines
    const newContentResult = deleteResult.right.getContent();
    if (Either.isLeft(newContentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get new buffer content: ${newContentResult.left}`));
    }

    const newLines = newContentResult.right.split('\n');
    const targetLine = Math.min(startLine, newLines.length - 1);

    // Find first non-blank column
    const targetLineText = newLines[targetLine] || '';
    let firstNonBlank = 0;
    while (firstNonBlank < targetLineText.length && /\s/.test(targetLineText[firstNonBlank]!)) {
      firstNonBlank++;
    }

    setCursorLine(targetLine);
    setCursorColumn(firstNonBlank);

    return Either.right(createNil());
  });

  /**
   * delete-to-sentence-end - delete to end of sentence (d) command in Vim)
   * Usage: (delete-to-sentence-end)
   */
  api.set("delete-to-sentence-end", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'delete-to-sentence-end requires 0 arguments',
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
    const currentLine = getCursorLine();
    const currentColumn = getCursorColumn();

    // Find sentence end
    const endPos = findSentenceEnd(text, currentLine, currentColumn);

    // Get deleted text for register
    const deletedTextResult = currentBuffer!.getText({
      start: { line: currentLine, column: currentColumn },
      end: { line: endPos.line, column: endPos.column }
    });

    if (Either.isRight(deletedTextResult)) {
      setDeleteRegister(deletedTextResult.right);  // Legacy register
      registerDelete(deletedTextResult.right, false);  // Evil Integration (US-1.9.3)
    }

    // Perform deletion
    const deleteResult = currentBuffer!.delete({
      start: { line: currentLine, column: currentColumn },
      end: { line: endPos.line, column: endPos.column }
    });

    if (Either.isLeft(deleteResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to delete: ${deleteResult.left}`));
    }

    // Update buffer
    setCurrentBuffer(deleteResult.right);

    // Keep cursor at same position
    setCursorLine(currentLine);
    setCursorColumn(currentColumn);

    return Either.right(createNil());
  });

  /**
   * delete-register-get - get content of delete register
   * Usage: (delete-register-get)
   */
  api.set("delete-register-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'delete-register-get requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    return Either.right(createString(deleteRegister));
  });

  return api;
}
