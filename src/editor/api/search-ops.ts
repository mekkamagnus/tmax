/**
 * @file search-ops.ts
 * @description Search operations for T-Lisp editor API (US-1.5.1, US-1.5.2)
 *
 * Implements Vim-style search:
 * - search-forward: move to next match (/pattern)
 * - search-backward: move to previous match (?pattern)
 * - search-next: repeat search in same direction (n)
 * - search-previous: repeat search in opposite direction (N)
 * - word-under-cursor-next: search for next occurrence of word under cursor (*)
 * - word-under-cursor-previous: search for previous occurrence of word under cursor (#)
 * - search-pattern-get: get current search pattern
 * - search-direction-get: get current search direction
 * - search-clear: clear search state
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createString, createNil, createSymbol } from "../../tlisp/values.ts";
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
 * Search state tracking
 */
let lastSearchPattern: string = "";
let lastSearchDirection: "forward" | "backward" = "forward";

/**
 * Find the next occurrence of a pattern in forward direction
 * @param text - Full text content
 * @param pattern - Pattern to search for
 * @param startLine - Starting line
 * @param startColumn - Starting column
 * @returns Position of next match or null if not found
 */
function findNextMatch(
  text: string,
  pattern: string,
  startLine: number,
  startColumn: number
): { line: number; column: number } | null {
  const lines = text.split('\n');

  // Start searching from current position + 1 to find next occurrence
  let currentLine = startLine;
  let currentColumn = startColumn + 1;

  // Check if there's a match at the current position
  const currentLineText = lines[currentLine];
  if (currentLineText && currentLineText.indexOf(pattern) === startColumn) {
    // Skip past this match
    currentColumn = startColumn + pattern.length;
  }

  // Search forward through the buffer
  while (currentLine < lines.length) {
    const lineText = lines[currentLine]!;
    
    // Find pattern in current line starting from currentColumn
    const index = lineText.indexOf(pattern, currentColumn);
    
    if (index !== -1) {
      return { line: currentLine, column: index };
    }

    // Move to next line
    currentLine++;
    currentColumn = 0;
  }

  // Wrap around to beginning
  for (let wrapLine = 0; wrapLine <= startLine; wrapLine++) {
    const lineText = lines[wrapLine]!;
    const index = lineText.indexOf(pattern, 0);
    
    if (index !== -1) {
      return { line: wrapLine, column: index };
    }
  }

  return null;
}

/**
 * Find the previous occurrence of a pattern in backward direction
 * @param text - Full text content
 * @param pattern - Pattern to search for
 * @param startLine - Starting line
 * @param startColumn - Starting column
 * @returns Position of previous match or null if not found
 */
function findPreviousMatch(
  text: string,
  pattern: string,
  startLine: number,
  startColumn: number
): { line: number; column: number } | null {
  const lines = text.split('\n');

  // Start searching from current position - 1 (to avoid matching current position)
  let currentLine = startLine;
  let currentColumn = startColumn - 1;

  // Search backward through the buffer
  while (currentLine >= 0) {
    const lineText = lines[currentLine]!;
    
    // Find last occurrence of pattern before currentColumn
    let index = -1;
    for (let i = 0; i < currentColumn; i++) {
      const foundIndex = lineText.indexOf(pattern, i);
      if (foundIndex !== -1 && foundIndex < currentColumn) {
        index = foundIndex;
        i = foundIndex; // Skip ahead
      } else {
        break;
      }
    }
    
    // Better approach: find all matches and take the last one before currentColumn
    const allMatches: number[] = [];
    let searchFrom = 0;
    while (true) {
      const matchIndex = lineText.indexOf(pattern, searchFrom);
      if (matchIndex === -1 || matchIndex >= currentColumn) break;
      allMatches.push(matchIndex);
      searchFrom = matchIndex + 1;
    }
    
    if (allMatches.length > 0) {
      return { line: currentLine, column: allMatches[allMatches.length - 1] };
    }

    // Move to previous line
    currentLine--;
    if (currentLine >= 0) {
      currentColumn = lines[currentLine]!.length;
    }
  }

  // Wrap around to end
  for (let wrapLine = lines.length - 1; wrapLine >= startLine; wrapLine--) {
    const lineText = lines[wrapLine]!;
    const index = lineText.lastIndexOf(pattern);
    
    if (index !== -1) {
      return { line: wrapLine, column: index };
    }
  }

  return null;
}

/**
 * Create search operations API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getCursorColumn - Function to get cursor column
 * @param setCursorColumn - Function to set cursor column
 * @param setStatusMessage - Function to set status message
 * @returns Map of search function names to implementations
 */
export function createSearchOps(
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  getCursorLine: () => number,
  setCursorLine: (line: number) => void,
  getCursorColumn: () => number,
  setCursorColumn: (column: number) => void,
  setStatusMessage: (message: string) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * search-forward - search for pattern forward (/pattern)
   * Usage: (search-forward "pattern")
   */
  api.set("search-forward", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'search-forward requires 1 argument: pattern',
        'args',
        args,
        '1 argument'
      ));
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    // Get pattern (empty string reuses previous pattern)
    let pattern = "";
    if (args[0].type === "string") {
      pattern = args[0].value as string;
    }

    // Reuse previous pattern if empty
    if (pattern === "" && lastSearchPattern !== "") {
      pattern = lastSearchPattern;
    } else if (pattern !== "") {
      lastSearchPattern = pattern;
      lastSearchDirection = "forward";
    } else {
      return Either.left(createValidationError(
        'InvalidOperation',
        'No previous search pattern',
        'pattern',
        pattern,
        'non-empty string or previous search'
      ));
    }

    // Get buffer content
    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    const currentLine = getCursorLine();
    const currentColumn = getCursorColumn();

    // Find next match
    const match = findNextMatch(text, pattern, currentLine, currentColumn);
    
    if (!match) {
      setStatusMessage(`Pattern '${pattern}' not found`);
      return Either.left(createBufferError('NotFound', `Pattern '${pattern}' not found`));
    }

    // Update cursor position
    setCursorLine(match.line);
    setCursorColumn(match.column);

    setStatusMessage(`Found: ${pattern}`);
    return Either.right(createNil());
  });

  /**
   * search-backward - search for pattern backward (?pattern)
   * Usage: (search-backward "pattern")
   */
  api.set("search-backward", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'search-backward requires 1 argument: pattern',
        'args',
        args,
        '1 argument'
      ));
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    // Get pattern (empty string reuses previous pattern)
    let pattern = "";
    if (args[0].type === "string") {
      pattern = args[0].value as string;
    }

    // Reuse previous pattern if empty
    if (pattern === "" && lastSearchPattern !== "") {
      pattern = lastSearchPattern;
    } else if (pattern !== "") {
      lastSearchPattern = pattern;
      lastSearchDirection = "backward";
    } else {
      return Either.left(createValidationError(
        'InvalidOperation',
        'No previous search pattern',
        'pattern',
        pattern,
        'non-empty string or previous search'
      ));
    }

    // Get buffer content
    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const text = contentResult.right;
    const currentLine = getCursorLine();
    const currentColumn = getCursorColumn();

    // Find previous match
    const match = findPreviousMatch(text, pattern, currentLine, currentColumn);
    
    if (!match) {
      setStatusMessage(`Pattern '${pattern}' not found`);
      return Either.left(createBufferError('NotFound', `Pattern '${pattern}' not found`));
    }

    // Update cursor position
    setCursorLine(match.line);
    setCursorColumn(match.column);

    setStatusMessage(`Found: ${pattern}`);
    return Either.right(createNil());
  });

  /**
   * search-next - repeat search in same direction (n)
   * Usage: (search-next)
   */
  api.set("search-next", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'search-next requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    if (lastSearchPattern === "") {
      return Either.left(createValidationError(
        'InvalidOperation',
        'No previous search pattern',
        'pattern',
        '',
        'previous search required'
      ));
    }

    // Repeat search in same direction
    if (lastSearchDirection === "forward") {
      return api.get("search-forward")!([createString(lastSearchPattern)]);
    } else {
      return api.get("search-backward")!([createString(lastSearchPattern)]);
    }
  });

  /**
   * search-previous - repeat search in opposite direction (N)
   * Usage: (search-previous)
   */
  api.set("search-previous", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'search-previous requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    if (lastSearchPattern === "") {
      return Either.left(createValidationError(
        'InvalidOperation',
        'No previous search pattern',
        'pattern',
        '',
        'previous search required'
      ));
    }

    // Repeat search in opposite direction
    if (lastSearchDirection === "forward") {
      return api.get("search-backward")!([createString(lastSearchPattern)]);
    } else {
      return api.get("search-forward")!([createString(lastSearchPattern)]);
    }
  });

  /**
   * search-pattern-get - get current search pattern
   * Usage: (search-pattern-get)
   */
  api.set("search-pattern-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'search-pattern-get requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    return Either.right(createString(lastSearchPattern));
  });

  /**
   * search-direction-get - get current search direction
   * Usage: (search-direction-get)
   */
  api.set("search-direction-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'search-direction-get requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    return Either.right(createSymbol(lastSearchDirection));
  });

  /**
   * search-clear - clear search state
   * Usage: (search-clear)
   */
  api.set("search-clear", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'search-clear requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    lastSearchPattern = "";
    lastSearchDirection = "forward";
    setStatusMessage("Search cleared");

    return Either.right(createNil());
  });

  /**
   * Extract word under cursor
   * @param text - Full text content
   * @param line - Current line
   * @param column - Current column
   * @returns Word under cursor or empty string if not on a word
   */
  function extractWordUnderCursor(
    text: string,
    line: number,
    column: number
  ): string {
    const lines = text.split('\n');

    // Validate position
    if (line < 0 || line >= lines.length) {
      return "";
    }

    const lineText = lines[line]!;
    if (column < 0 || column >= lineText.length) {
      return "";
    }

    // Check if current character is a word character
    const currentChar = lineText[column]!;
    if (!isWordChar(currentChar)) {
      return "";
    }

    // Find start of word
    let start = column;
    while (start > 0 && isWordChar(lineText[start - 1]!)) {
      start--;
    }

    // Find end of word
    let end = column;
    while (end < lineText.length && isWordChar(lineText[end]!)) {
      end++;
    }

    return lineText.substring(start, end);
  }

  /**
   * Check if character is a word character (alphanumeric or underscore)
   * @param char - Character to check
   * @returns true if character is a word character
   */
  function isWordChar(char: string): boolean {
    return /[a-zA-Z0-9_]/.test(char);
  }

  /**
   * word-under-cursor-next - search for next occurrence of word under cursor (*)
   * Usage: (word-under-cursor-next)
   */
  api.set("word-under-cursor-next", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'word-under-cursor-next requires 0 arguments',
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

    // Extract word under cursor
    const word = extractWordUnderCursor(text, currentLine, currentColumn);

    if (word === "") {
      setStatusMessage("No word under cursor");
      return Either.left(createBufferError('InvalidOperation', 'No word under cursor'));
    }

    // Set search pattern and direction
    lastSearchPattern = word;
    lastSearchDirection = "forward";

    // Find next match
    const match = findNextMatch(text, word, currentLine, currentColumn);

    if (!match) {
      setStatusMessage(`Word '${word}' not found`);
      return Either.left(createBufferError('NotFound', `Word '${word}' not found`));
    }

    // Update cursor position
    setCursorLine(match.line);
    setCursorColumn(match.column);

    setStatusMessage(`Found: ${word}`);
    return Either.right(createNil());
  });

  /**
   * word-under-cursor-previous - search for previous occurrence of word under cursor (#)
   * Usage: (word-under-cursor-previous)
   */
  api.set("word-under-cursor-previous", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'word-under-cursor-previous requires 0 arguments',
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

    // Extract word under cursor
    const word = extractWordUnderCursor(text, currentLine, currentColumn);

    if (word === "") {
      setStatusMessage("No word under cursor");
      return Either.left(createBufferError('InvalidOperation', 'No word under cursor'));
    }

    // Set search pattern and direction
    lastSearchPattern = word;
    lastSearchDirection = "backward";

    // Find previous match
    const match = findPreviousMatch(text, word, currentLine, currentColumn);

    if (!match) {
      setStatusMessage(`Word '${word}' not found`);
      return Either.left(createBufferError('NotFound', `Word '${word}' not found`));
    }

    // Update cursor position
    setCursorLine(match.line);
    setCursorColumn(match.column);

    setStatusMessage(`Found: ${word}`);
    return Either.right(createNil());
  });

  return api;
}
