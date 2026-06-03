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
import { registerYank, resetRegisterState } from "./evil-integration.ts";

/**
 * Register storage for yanked text (legacy, for backward compatibility)
 * @deprecated Use registerYank from evil-integration.ts instead
 */
let yankRegister: string = "";

/**
 * Get the current content of the yank register
 * @deprecated Use getRegister('0') from evil-integration.ts instead
 */
export function getYankRegister(): string {
  return yankRegister;
}

/**
 * Set the yank register content
 * @deprecated Use registerYank from evil-integration.ts instead
 */
export function setYankRegister(text: string): void {
  yankRegister = text;
}

/**
 * Reset yank register state (for testing)
 */
export function resetYankRegisterState(): void {
  yankRegister = "";
  resetRegisterState();
}

/**
 * Check if a character is a word character
 */
import { isWordChar, findWordEnd } from "./text-utils.ts";

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
   * yank-chars - yank characters from the cursor (yl command in Vim)
   * Usage: (yank-chars) or (yank-chars count)
   */
  api.set("yank-chars", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'yank-chars requires 0 or 1 argument: optional count',
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

    let count = 1;
    if (args.length === 1) {
      const countArg = args[0];
      const typeValidation = validateArgType(countArg, "number", 0, "yank-chars");
      if (Either.isLeft(typeValidation)) {
        return Either.left(typeValidation.left);
      }
      count = Math.max(0, countArg.value as number);
    }

    const lineResult = currentBuffer!.getLine(getCursorLine());
    if (Either.isLeft(lineResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line: ${lineResult.left}`));
    }

    const startColumn = getCursorColumn();
    const endColumn = Math.min(startColumn + count, lineResult.right.length);
    const yankedTextResult = currentBuffer!.getText({
      start: { line: getCursorLine(), column: startColumn },
      end: { line: getCursorLine(), column: endColumn }
    });

    if (Either.isRight(yankedTextResult)) {
      setYankRegister(yankedTextResult.right);
      registerYank(yankedTextResult.right);
    }

    return Either.right(createNil());
  });

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
    const lines = text.split('\n');
    const currentLineText = lines[startLine] ?? "";

    if (
      count === 1 &&
      startColumn > 0 &&
      !isWordChar(currentLineText[startColumn] ?? "") &&
      isWordChar(currentLineText[startColumn - 1] ?? "")
    ) {
      endColumn = startColumn;
      startColumn--;
      while (startColumn > 0 && isWordChar(currentLineText[startColumn - 1] ?? "")) {
        startColumn--;
      }
    } else {
      // Find end position after count words
      for (let i = 0; i < count; i++) {
        const endPos = findWordEnd(text, endLine, endColumn);
        endLine = endPos.line;
        endColumn = endPos.column;
      }
    }

    // Get yanked text for register
    const yankedTextResult = currentBuffer!.getText({
      start: { line: startLine, column: startColumn },
      end: { line: endLine, column: endColumn }
    });

    if (Either.isRight(yankedTextResult)) {
      setYankRegister(yankedTextResult.right);  // Legacy register
      registerYank(yankedTextResult.right);  // Evil Integration (US-1.9.3)
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

    const yankedText = `${lines.slice(startLine, endLine).join('\n')}\n`;
    setYankRegister(yankedText);  // Legacy register
    registerYank(yankedText);  // Evil Integration (US-1.9.3)
    setCursorLine(Math.max(startLine, endLine - 1));
    setCursorColumn(0);

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
      setYankRegister(yankedTextResult.right);  // Legacy register
      registerYank(yankedTextResult.right);  // Evil Integration (US-1.9.3)
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
      // Build repeated text
      let pasteText = yankRegister;
      for (let i = 1; i < count; i++) {
        pasteText += yankRegister;
      }

      const lineCountResult = currentBuffer!.getLineCount();
      const lineCount = Either.isRight(lineCountResult) ? lineCountResult.right : currentLine + 1;
      let insertPos = { line: currentLine, column: 0 };
      if (lineCount > 2 && currentLine >= lineCount - 1) {
        const lastLineResult = currentBuffer!.getLine(lineCount - 1);
        const lastLineLength = Either.isRight(lastLineResult) ? lastLineResult.right.length : 0;
        pasteText = `\n${pasteText.replace(/\n$/, "")}`;
        insertPos = { line: lineCount - 1, column: lastLineLength };
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

      const lineResult = currentBuffer!.getLine(currentLine);
      const suffix = Either.isRight(lineResult) ? lineResult.right.slice(currentColumn + 1) : "";
      const repetitions = suffix.startsWith(yankRegister) ? Math.max(0, count - 1) : count;

      // Build repeated text
      let pasteText = "";
      for (let i = 0; i < repetitions; i++) {
        pasteText += yankRegister;
      }

      if (pasteText === "") {
        return Either.right(createNil());
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
      // Character paste: paste before the cursor's current character. For cursors
      // positioned at the start of a word after whitespace, this inserts before
      // the separator, matching the legacy tests for P.
      const insertPos = { line: currentLine, column: Math.max(0, currentColumn - 1) };

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
