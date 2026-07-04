/**
 * @file word-ops.ts
 * @description Word navigation operations for T-Lisp editor API (US-1.1.1)
 *
 * Implements Vim-style word navigation:
 * - word-next: move to start of next word (w)
 * - word-previous: move to start of previous word (b)
 * - word-end: move to end of current word (e)
 * - All functions support count prefix for repeated movements
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNumber, createNil } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer } from "../../core/types.ts";
import type { EditorModel } from "../functional/model.ts";
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
 * Word definition for navigation purposes
 * Words are sequences of:
 * - Alphanumeric characters (a-z, A-Z, 0-9)
 * - Underscores (_)
 *
 * Word boundaries are:
 * - Whitespace (space, tab, newline)
 * - Punctuation (anything not alphanumeric or underscore)
 */

/**
 * Check if a character is a word character
 * @param char - Character to check
 * @returns true if character is alphanumeric or underscore
 */
import { isWordChar, isWhitespace } from "./text-utils.ts";

/**
 * Find the start of the next WORD (W command).
 * A WORD is a whitespace-delimited token — punctuation joins the
 * surrounding word characters as one unit.
 */
function findNextWORDStart(
  text: string,
  line: number,
  column: number
): { line: number; column: number } {
  const lines = text.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return { line: 0, column: 0 };
  }

  let currentLine = Math.max(0, Math.min(line, lines.length - 1));
  let currentColumn = Math.max(0, column);

  // Skip the current non-whitespace cluster.
  const currLineText = lines[currentLine]!;
  while (currentColumn < currLineText.length && !isWhitespace(currLineText[currentColumn]!)) {
    currentColumn++;
  }

  // Now skip whitespace, possibly across lines.
  while (currentLine < lines.length) {
    const lineText = lines[currentLine]!;
    while (currentColumn < lineText.length && isWhitespace(lineText[currentColumn]!)) {
      currentColumn++;
    }
    if (currentColumn < lineText.length) {
      return { line: currentLine, column: currentColumn };
    }
    currentLine++;
    currentColumn = 0;
  }

  // Land at end of buffer.
  const lastLine = lines.length - 1;
  return { line: lastLine, column: Math.max(0, (lines[lastLine]?.length ?? 1) - 1) };
}

/**
 * Find the start of the previous WORD (B command).
 */
function findPreviousWORDStart(
  text: string,
  line: number,
  column: number
): { line: number; column: number } {
  const lines = text.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return { line: 0, column: 0 };
  }

  let currentLine = Math.max(0, Math.min(line, lines.length - 1));
  let currentColumn = Math.max(0, column);

  // Step back one position; if at start of line, go to end of previous line.
  if (currentColumn === 0) {
    if (currentLine === 0) {
      return { line: 0, column: 0 };
    }
    currentLine--;
    currentColumn = lines[currentLine]!.length;
  } else {
    currentColumn--;
  }

  // Skip whitespace backward.
  while (true) {
    const lineText = lines[currentLine]!;
    while (currentColumn > 0 && isWhitespace(lineText[currentColumn - 1]!)) {
      currentColumn--;
    }
    if (currentColumn > 0) break;
    // Whole line is whitespace; jump to end of previous line.
    if (currentLine === 0) {
      return { line: 0, column: 0 };
    }
    currentLine--;
    currentColumn = lines[currentLine]!.length;
  }

  // Skip non-whitespace backward to land on the first char of the WORD.
  const lineText = lines[currentLine]!;
  while (currentColumn > 0 && !isWhitespace(lineText[currentColumn - 1]!)) {
    currentColumn--;
  }
  return { line: currentLine, column: currentColumn };
}

/**
 * Find the end of the current/next WORD (E command).
 */
function findWORDEnd(
  text: string,
  line: number,
  column: number
): { line: number; column: number } {
  const lines = text.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return { line: 0, column: 0 };
  }

  let currentLine = Math.max(0, Math.min(line, lines.length - 1));
  let currentColumn = Math.max(0, column);

  // Step forward one position; if at end of line, go to start of next line.
  const currLineText = lines[currentLine]!;
  if (currentColumn >= currLineText.length) {
    if (currentLine >= lines.length - 1) {
      const lastText = lines[currentLine]!;
      return { line: currentLine, column: Math.max(0, lastText.length - 1) };
    }
    currentLine++;
    currentColumn = 0;
  } else {
    currentColumn++;
  }

  // Skip whitespace forward, possibly across lines.
  while (currentLine < lines.length) {
    const lineText = lines[currentLine]!;
    while (currentColumn < lineText.length && isWhitespace(lineText[currentColumn]!)) {
      currentColumn++;
    }
    if (currentColumn < lineText.length) break;
    currentLine++;
    currentColumn = 0;
  }

  if (currentLine >= lines.length) {
    const lastLine = lines.length - 1;
    return { line: lastLine, column: Math.max(0, (lines[lastLine]?.length ?? 1) - 1) };
  }

  // Now skip non-whitespace to land on the LAST char of the WORD.
  const lineText = lines[currentLine]!;
  while (currentColumn + 1 < lineText.length && !isWhitespace(lineText[currentColumn + 1]!)) {
    currentColumn++;
  }
  return { line: currentLine, column: currentColumn };
}

/**
 * Find the end of the previous word (ge command) — punctuation-aware.
 */
function findPreviousWordEnd(
  text: string,
  line: number,
  column: number
): { line: number; column: number } {
  const lines = text.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return { line: 0, column: 0 };
  }

  let currentLine = Math.max(0, Math.min(line, lines.length - 1));
  let currentColumn = Math.max(0, column);

  // Step back one position.
  if (currentColumn === 0) {
    if (currentLine === 0) return { line: 0, column: 0 };
    currentLine--;
    currentColumn = lines[currentLine]!.length;
  } else {
    currentColumn--;
  }

  // Skip non-word chars backward, possibly across lines.
  while (true) {
    const lineText = lines[currentLine]!;
    while (currentColumn > 0 && !isWordChar(lineText[currentColumn - 1]!)) {
      currentColumn--;
    }
    if (currentColumn > 0) break;
    if (currentLine === 0) return { line: 0, column: 0 };
    currentLine--;
    currentColumn = lines[currentLine]!.length;
  }

  // Land on the last char of the previous word.
  return { line: currentLine, column: currentColumn - 1 };
}

/**
 * Find the end of the previous WORD (gE command) — whitespace-only.
 */
function findPreviousWORDEnd(
  text: string,
  line: number,
  column: number
): { line: number; column: number } {
  const lines = text.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return { line: 0, column: 0 };
  }

  let currentLine = Math.max(0, Math.min(line, lines.length - 1));
  let currentColumn = Math.max(0, column);

  if (currentColumn === 0) {
    if (currentLine === 0) return { line: 0, column: 0 };
    currentLine--;
    currentColumn = lines[currentLine]!.length;
  } else {
    currentColumn--;
  }

  // Skip whitespace backward.
  while (true) {
    const lineText = lines[currentLine]!;
    while (currentColumn > 0 && isWhitespace(lineText[currentColumn - 1]!)) {
      currentColumn--;
    }
    if (currentColumn > 0) break;
    if (currentLine === 0) return { line: 0, column: 0 };
    currentLine--;
    currentColumn = lines[currentLine]!.length;
  }

  // Land on the last char of the previous WORD.
  return { line: currentLine, column: currentColumn - 1 };
}

/**
 * Find the start of the next word (w command)
 * @param text - Full text content
 * @param line - Current line
 * @param column - Current column
 * @returns Position of next word start
 */
function findNextWordStart(
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

  const lineText = lines[currentLine]!;

  // If we're in the middle of a word, skip to end of current word first
  if (currentColumn < lineText.length && isWordChar(lineText[currentColumn]!)) {
    // Skip to end of current word
    while (currentColumn < lineText.length && isWordChar(lineText[currentColumn]!)) {
      currentColumn++;
    }
  } else if (currentColumn >= lineText.length && currentLine < lines.length - 1) {
    // At end of line, move to next line
    currentLine++;
    currentColumn = 0;
  }

  // Now skip whitespace/punctuation to find next word
  while (currentLine < lines.length) {
    const currentLineText = lines[currentLine]!;

    // Skip non-word characters
    while (currentColumn < currentLineText.length && !isWordChar(currentLineText[currentColumn]!)) {
      currentColumn++;
    }

    // Check if we found a word
    if (currentColumn < currentLineText.length && isWordChar(currentLineText[currentColumn]!)) {
      return { line: currentLine, column: currentColumn };
    }

    // Move to next line
    currentLine++;
    currentColumn = 0;
  }

  // If no next word found, stay at end
  return { line: currentLine - 1, column: lines[currentLine - 1]?.length || 0 };
}

/**
 * Find the start of the previous word (b command)
 * @param text - Full text content
 * @param line - Current line
 * @param column - Current column
 * @returns Position of previous word start
 */
function findPreviousWordStart(
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

  const lineText = lines[currentLine]!;

  // If we're in the middle of a word, skip to start of current word first
  if (currentColumn > 0 && currentColumn <= lineText.length && isWordChar(lineText[Math.min(currentColumn, lineText.length - 1)]!)) {
    // Skip to start of current word
    while (currentColumn > 0 && isWordChar(lineText[currentColumn - 1]!)) {
      currentColumn--;
    }

    // Now skip any non-word characters to find previous word
    while (currentColumn > 0 && !isWordChar(lineText[currentColumn - 1]!)) {
      currentColumn--;
    }

    // Skip back through word characters
    while (currentColumn > 0 && isWordChar(lineText[currentColumn - 1]!)) {
      currentColumn--;
    }

    return { line: currentLine, column: currentColumn };
  } else if (currentColumn === 0 && currentLine > 0) {
    // At start of line, go to previous line
    currentLine--;
    const prevLineText = lines[currentLine]!;
    currentColumn = prevLineText.length;

    // Skip trailing whitespace
    while (currentColumn > 0 && !isWordChar(prevLineText[currentColumn - 1]!)) {
      currentColumn--;
    }

    // Skip back through word characters
    while (currentColumn > 0 && isWordChar(prevLineText[currentColumn - 1]!)) {
      currentColumn--;
    }

    return { line: currentLine, column: currentColumn };
  }

  // At position 0,0 - can't go back further
  return { line: 0, column: 0 };
}

/**
 * Find the end of the current word (e command)
 * @param text - Full text content
 * @param line - Current line
 * @param column - Current column
 * @returns Position of word end
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
  let currentColumn = Math.max(0, column);

  const lineText = lines[currentLine]!;

  // If we're at or after the end of a word, skip to the next word
  // First, check if we need to skip non-word characters
  if (currentColumn < lineText.length && !isWordChar(lineText[currentColumn]!)) {
    // Skip non-word characters
    while (currentColumn < lineText.length && !isWordChar(lineText[currentColumn]!)) {
      currentColumn++;
    }

    // If we reached end of line, move to next line
    if (currentColumn >= lineText.length && currentLine < lines.length - 1) {
      currentLine++;
      currentColumn = 0;
    }
  } else if (currentColumn > 0 && currentColumn <= lineText.length &&
             isWordChar(lineText[Math.min(currentColumn, lineText.length - 1)]!)) {
    // We're at a word character - if we're already at the end of a word,
    // skip to the next word
    let tempColumn = currentColumn;

    // Check if we're at the last character of a word
    if (tempColumn === lineText.length - 1 || !isWordChar(lineText[tempColumn + 1]!)) {
      // We're at the end of a word, move past it
      currentColumn++;

      // Skip whitespace
      while (currentColumn < lineText.length && !isWordChar(lineText[currentColumn]!)) {
        currentColumn++;
      }

      // If we reached end of line, move to next line
      if (currentColumn >= lineText.length && currentLine < lines.length - 1) {
        currentLine++;
        currentColumn = 0;
      }
    }
  }

  // Now find the end of the (next) word
  while (currentLine < lines.length) {
    const currentLineText = lines[currentLine]!;

    // Skip non-word characters to find word start
    while (currentColumn < currentLineText.length && !isWordChar(currentLineText[currentColumn]!)) {
      currentColumn++;
    }

    // If we reached end of line, move to next line
    if (currentColumn >= currentLineText.length) {
      currentLine++;
      currentColumn = 0;
      continue;
    }

    // Now we're at the start of a word, find its end
    while (currentColumn < currentLineText.length && isWordChar(currentLineText[currentColumn]!)) {
      currentColumn++;
    }

    if (currentColumn > 0) {
      return { line: currentLine, column: currentColumn - 1 };
    }

    // Move to next position if we didn't find anything
    currentLine++;
    currentColumn = 0;
  }

  // If we didn't find another word, return last position
  return { line: lines.length - 1, column: lines[lines.length - 1]?.length || 0 };
}

/**
 * Create word navigation API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getCursorColumn - Function to get cursor column
 * @param setCursorColumn - Function to set cursor column
 * @param getMode - Function to get current editor mode
 * @param updateVisualSelection - Optional function to update visual selection end position
 * @returns Map of word navigation function names to implementations
 */
export function createWordOps(
  access: EditorModelAccess,
  setCursorLine: (line: number) => void,
  setCursorColumn: (column: number) => void,
  getMode?: () => EditorModel["mode"],
  updateVisualSelection?: () => void
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: cursor/buffer reads flow through the State monad against
  // EditorModel (equivalent to the bridge getters). Cursor writes stay on the
  // supplied setters so window-tracking side effects are preserved.
  const getCursorLine = (): number => runModel(access, readModelField("cursorPosition")).line;
  const getCursorColumn = (): number => runModel(access, readModelField("cursorPosition")).column;
  const getCurrentBuffer = (): FunctionalTextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * Helper function to update visual selection if in visual mode
   */
  const updateVisualSelectionIfNeeded = (): void => {
    if (getMode && updateVisualSelection && getMode() === "visual") {
      updateVisualSelection();
    }
  };

  /**
   * word-next - move to start of next word (w key in Vim)
   * Usage: (word-next) or (word-next count)
   */
  api.set("word-next", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'word-next requires 0 or 1 argument: optional count',
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
      const countArg = args[0]!
      const typeValidation = validateArgType(countArg, "number", 0, "word-next");
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
    let currentLine = getCursorLine();
    let currentColumn = getCursorColumn();

    // Apply count movements
    for (let i = 0; i < count; i++) {
      const nextPos = findNextWordStart(text, currentLine, currentColumn);
      currentLine = nextPos.line;
      currentColumn = nextPos.column;
    }

    // Update cursor position
    setCursorLine(currentLine);
    setCursorColumn(currentColumn);

    // Update visual selection if in visual mode
    updateVisualSelectionIfNeeded();

    return Either.right(createNil());
  });

  /**
   * word-previous - move to start of previous word (b key in Vim)
   * Usage: (word-previous) or (word-previous count)
   */
  api.set("word-previous", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'word-previous requires 0 or 1 argument: optional count',
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
      const countArg = args[0]!
      const typeValidation = validateArgType(countArg, "number", 0, "word-previous");
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
    let currentLine = getCursorLine();
    let currentColumn = getCursorColumn();

    // Apply count movements
    for (let i = 0; i < count; i++) {
      const prevPos = findPreviousWordStart(text, currentLine, currentColumn);
      currentLine = prevPos.line;
      currentColumn = prevPos.column;
    }

    // Update cursor position
    setCursorLine(currentLine);
    setCursorColumn(currentColumn);

    // Update visual selection if in visual mode
    updateVisualSelectionIfNeeded();

    return Either.right(createNil());
  });

  /**
   * word-end - move to end of current word (e key in Vim)
   * Usage: (word-end) or (word-end count)
   */
  api.set("word-end", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Allow 0 or 1 arguments
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'word-end requires 0 or 1 argument: optional count',
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
      const countArg = args[0]!
      const typeValidation = validateArgType(countArg, "number", 0, "word-end");
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
    let currentLine = getCursorLine();
    let currentColumn = getCursorColumn();

    // Apply count movements
    for (let i = 0; i < count; i++) {
      const endPos = findWordEnd(text, currentLine, currentColumn);
      currentLine = endPos.line;
      currentColumn = endPos.column;
    }

    // Update cursor position
    setCursorLine(currentLine);
    setCursorColumn(currentColumn);

    // Update visual selection if in visual mode
    updateVisualSelectionIfNeeded();

    return Either.right(createNil());
  });

  /**
   * word-next-WORD - move to start of next WORD (W key in Vim).
   * A WORD is a whitespace-delimited token (punctuation joins the word).
   */
  api.set("word-next-WORD", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'word-next-WORD requires 0 or 1 argument: optional count',
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
      const countArg = args[0]!;
      const typeValidation = validateArgType(countArg, "number", 0, "word-next-WORD");
      if (Either.isLeft(typeValidation)) {
        return Either.left(typeValidation.left);
      }
      count = Math.max(0, countArg.value as number);
    }

    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    let currentLine = getCursorLine();
    let currentColumn = getCursorColumn();

    for (let i = 0; i < count; i++) {
      const nextPos = findNextWORDStart(text, currentLine, currentColumn);
      currentLine = nextPos.line;
      currentColumn = nextPos.column;
    }

    setCursorLine(currentLine);
    setCursorColumn(currentColumn);
    updateVisualSelectionIfNeeded();

    return Either.right(createNil());
  });

  /**
   * word-previous-WORD - move to start of previous WORD (B key in Vim).
   */
  api.set("word-previous-WORD", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'word-previous-WORD requires 0 or 1 argument: optional count',
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
      const countArg = args[0]!;
      const typeValidation = validateArgType(countArg, "number", 0, "word-previous-WORD");
      if (Either.isLeft(typeValidation)) {
        return Either.left(typeValidation.left);
      }
      count = Math.max(0, countArg.value as number);
    }

    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    let currentLine = getCursorLine();
    let currentColumn = getCursorColumn();

    for (let i = 0; i < count; i++) {
      const prevPos = findPreviousWORDStart(text, currentLine, currentColumn);
      currentLine = prevPos.line;
      currentColumn = prevPos.column;
    }

    setCursorLine(currentLine);
    setCursorColumn(currentColumn);
    updateVisualSelectionIfNeeded();

    return Either.right(createNil());
  });

  /**
   * word-end-WORD - move to end of current/next WORD (E key in Vim).
   */
  api.set("word-end-WORD", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'word-end-WORD requires 0 or 1 argument: optional count',
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
      const countArg = args[0]!;
      const typeValidation = validateArgType(countArg, "number", 0, "word-end-WORD");
      if (Either.isLeft(typeValidation)) {
        return Either.left(typeValidation.left);
      }
      count = Math.max(0, countArg.value as number);
    }

    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    let currentLine = getCursorLine();
    let currentColumn = getCursorColumn();

    for (let i = 0; i < count; i++) {
      const endPos = findWORDEnd(text, currentLine, currentColumn);
      currentLine = endPos.line;
      currentColumn = endPos.column;
    }

    setCursorLine(currentLine);
    setCursorColumn(currentColumn);
    updateVisualSelectionIfNeeded();

    return Either.right(createNil());
  });

  /**
   * word-previous-end - move to end of previous word (ge key in Vim).
   */
  api.set("word-previous-end", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'word-previous-end requires 0 or 1 argument: optional count',
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
      const countArg = args[0]!;
      const typeValidation = validateArgType(countArg, "number", 0, "word-previous-end");
      if (Either.isLeft(typeValidation)) {
        return Either.left(typeValidation.left);
      }
      count = Math.max(0, countArg.value as number);
    }

    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    let currentLine = getCursorLine();
    let currentColumn = getCursorColumn();

    for (let i = 0; i < count; i++) {
      const endPos = findPreviousWordEnd(text, currentLine, currentColumn);
      currentLine = endPos.line;
      currentColumn = endPos.column;
    }

    setCursorLine(currentLine);
    setCursorColumn(currentColumn);
    updateVisualSelectionIfNeeded();

    return Either.right(createNil());
  });

  /**
   * word-previous-end-WORD - move to end of previous WORD (gE key in Vim).
   */
  api.set("word-previous-end-WORD", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'word-previous-end-WORD requires 0 or 1 argument: optional count',
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
      const countArg = args[0]!;
      const typeValidation = validateArgType(countArg, "number", 0, "word-previous-end-WORD");
      if (Either.isLeft(typeValidation)) {
        return Either.left(typeValidation.left);
      }
      count = Math.max(0, countArg.value as number);
    }

    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    let currentLine = getCursorLine();
    let currentColumn = getCursorColumn();

    for (let i = 0; i < count; i++) {
      const endPos = findPreviousWORDEnd(text, currentLine, currentColumn);
      currentLine = endPos.line;
      currentColumn = endPos.column;
    }

    setCursorLine(currentLine);
    setCursorColumn(currentColumn);
    updateVisualSelectionIfNeeded();

    return Either.right(createNil());
  });

  return api;
}
