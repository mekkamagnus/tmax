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
 * - search-find-all-matches: find all match positions (SPEC-035 isearch)
 * - search-set-highlight-ranges: set highlight ranges for matches (SPEC-035)
 * - search-incremental-start: start incremental search (SPEC-035)
 * - search-incremental-update: update incremental search pattern (SPEC-035)
 * - search-incremental-backspace: remove last char from isearch (SPEC-035)
 * - search-incremental-finish: accept current match (SPEC-035)
 * - search-incremental-cancel: cancel and restore position (SPEC-035)
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createString, createNil, createSymbol, createNumber, createList, createBoolean } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer, Range } from "../../core/types.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";
import { isWordChar } from "./text-utils.ts";
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
    
    // Find the last occurrence of pattern before currentColumn
    const allMatches: number[] = [];
    let searchFrom = 0;
    while (true) {
      const matchIndex = lineText.indexOf(pattern, searchFrom);
      if (matchIndex === -1 || matchIndex >= currentColumn) break;
      allMatches.push(matchIndex);
      searchFrom = matchIndex + 1;
    }
    
    if (allMatches.length > 0) {
      return { line: currentLine, column: allMatches[allMatches.length - 1]! };
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
  access: EditorModelAccess,
  setCursorLine: (line: number) => void,
  setCursorColumn: (column: number) => void,
  setStatusMessage: (message: string) => void,
  setSearchMatches?: (ranges: Range[]) => void
): Map<string, TLispFunctionImpl> {
  // CHORE-44 Change 1: per-editor search state (was module-global).
  let lastSearchPattern: string = "";
  let lastSearchDirection: "forward" | "backward" = "forward";
  let isearchActive: boolean = false;
  let isearchPattern: string = "";
  let isearchDirection: "forward" | "backward" = "forward";
  let isearchOriginLine: number = 0;
  let isearchOriginColumn: number = 0;
  let isearchHighlightRanges: Range[] = [];

  // CHORE-39 Phase 4: cursor/buffer reads flow through the State monad against
  // EditorModel; writes stay on the supplied setters to preserve side effects.
  const getCursorLine = (): number => runModel(access, readModelField("cursorPosition")).line;
  const getCursorColumn = (): number => runModel(access, readModelField("cursorPosition")).column;
  const getCurrentBuffer = (): FunctionalTextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
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
    if (args[0]!.type === "string") {
      pattern = args[0]!.value as string;
    }

    // Reuse previous pattern if empty
    if (pattern === "" && lastSearchPattern !== "") {
      pattern = lastSearchPattern;
    } else if (pattern !== "") {
      lastSearchPattern = pattern;
      lastSearchDirection = "forward";
    } else {
      return Either.left(createValidationError(
        'ConstraintViolation',
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
      return Either.left(createBufferError('OutOfBounds', `Pattern '${pattern}' not found`));
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
    if (args[0]!.type === "string") {
      pattern = args[0]!.value as string;
    }

    // Reuse previous pattern if empty
    if (pattern === "" && lastSearchPattern !== "") {
      pattern = lastSearchPattern;
    } else if (pattern !== "") {
      lastSearchPattern = pattern;
      lastSearchDirection = "backward";
    } else {
      return Either.left(createValidationError(
        'ConstraintViolation',
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
      return Either.left(createBufferError('OutOfBounds', `Pattern '${pattern}' not found`));
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
        'ConstraintViolation',
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
        'ConstraintViolation',
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
   * search-clear-highlights - clear visible search highlights only.
   * Spec: SPEC-044 Phase 1.E. Unlike search-clear, this preserves the last
   * search pattern and direction so `n`/`N` still jump after :nohl.
   * Usage: (search-clear-highlights)
   */
  api.set("search-clear-highlights", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'search-clear-highlights requires 0 arguments',
        'args',
        args.length,
        '0 arguments'
      ));
    }

    isearchHighlightRanges = [];
    if (setSearchMatches) setSearchMatches([]);

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
      return Either.left(createBufferError('OutOfBounds', `Word '${word}' not found`));
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
      return Either.left(createBufferError('OutOfBounds', `Word '${word}' not found`));
    }

    // Update cursor position
    setCursorLine(match.line);
    setCursorColumn(match.column);

    setStatusMessage(`Found: ${word}`);
    return Either.right(createNil());
  });

  // ==========================================================================
  // Incremental search primitives (SPEC-035)
  // ==========================================================================

  /**
   * search-find-all-matches - find all occurrences of pattern
   * Usage: (search-find-all-matches "pattern")
   * Returns list of (line column) pairs
   */
  api.set("search-find-all-matches", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "search-find-all-matches");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const patternArg = args[0]!
    if (patternArg.type !== "string") {
      return Either.left(createValidationError('TypeError', 'Pattern must be a string', 'pattern', patternArg, 'string'));
    }

    const pattern = patternArg.value as string;
    if (pattern === "") return Either.right(createList([]));

    const buf = getCurrentBuffer();
    const bufVal = validateBufferExists(buf);
    if (Either.isLeft(bufVal)) return Either.left(bufVal.left);

    const contentResult = buf!.getContent();
    if (Either.isLeft(contentResult)) return Either.left(createBufferError('Underflow', 'Failed to read buffer'));

    const lines = contentResult.right.split('\n');
    const matches: TLispValue[] = [];

    for (let i = 0; i < lines.length; i++) {
      let col = 0;
      while (true) {
        const idx = lines[i]!.indexOf(pattern, col);
        if (idx === -1) break;
        matches.push(createList([createNumber(i), createNumber(idx)]));
        col = idx + 1;
      }
    }

    return Either.right(createList(matches));
  });

  /**
   * search-set-highlight-ranges - set search match highlight ranges
   * Usage: (search-set-highlight-ranges ((line col len) ...))
   */
  api.set("search-set-highlight-ranges", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError('ConstraintViolation', 'search-set-highlight-ranges requires 1 argument', 'args', args.length, '1'));
    }

    const ranges: Range[] = [];
    const listArg = args[0]!
    if (listArg.type === "list") {
      for (const item of listArg.value as TLispValue[]) {
        if (item.type === "list") {
          const parts = item.value as TLispValue[];
          if (parts.length >= 3 && parts[0]!.type === "number" && parts[1]!.type === "number" && parts[2]!.type === "number") {
            ranges.push({
              start: { line: parts[0]!.value as number, column: parts[1]!.value as number },
              end: { line: parts[0]!.value as number, column: (parts[1]!.value as number) + (parts[2]!.value as number) }
            });
          }
        }
      }
    }

    isearchHighlightRanges = ranges;
    if (setSearchMatches) setSearchMatches(ranges);

    return Either.right(createNil());
  });

  /**
   * search-incremental-start - begin incremental search
   * Usage: (search-incremental-start "forward")
   */
  api.set("search-incremental-start", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const dir = args.length > 0 && args[0]!.type === "string" ? args[0]!.value as string : "forward";
    isearchActive = true;
    isearchPattern = "";
    isearchDirection = dir === "backward" ? "backward" : "forward";
    isearchOriginLine = getCursorLine();
    isearchOriginColumn = getCursorColumn();
    isearchHighlightRanges = [];
    if (setSearchMatches) setSearchMatches([]);
    setStatusMessage(`I-search${dir === "backward" ? " backward" : ""}: `);
    return Either.right(createNil());
  });

  /**
   * search-incremental-update - append char to isearch pattern
   * Usage: (search-incremental-update "c")
   */
  api.set("search-incremental-update", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (!isearchActive) {
      return Either.left(createValidationError('ConstraintViolation', 'No active incremental search', 'isearch', null, 'active search'));
    }

    const argsValidation = validateArgsCount(args, 1, "search-incremental-update");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    if (args[0]!.type !== "string") {
      return Either.left(createValidationError('TypeError', 'Character must be a string', 'char', args[0]!, 'string'));
    }

    isearchPattern += args[0]!.value as string;

    const buf = getCurrentBuffer();
    const bufVal = validateBufferExists(buf);
    if (Either.isLeft(bufVal)) return Either.left(bufVal.left);

    const contentResult = buf!.getContent();
    if (Either.isLeft(contentResult)) return Either.left(createBufferError('Underflow', 'Failed to read buffer'));

    const text = contentResult.right;
    const match = isearchDirection === "forward"
      ? findNextMatch(text, isearchPattern, isearchOriginLine, isearchOriginColumn)
      : findPreviousMatch(text, isearchPattern, isearchOriginLine, isearchOriginColumn);

    // Build highlight ranges for all matches
    const lines = text.split('\n');
    const ranges: Range[] = [];
    for (let i = 0; i < lines.length; i++) {
      let col = 0;
      while (true) {
        const idx = lines[i]!.indexOf(isearchPattern, col);
        if (idx === -1) break;
        ranges.push({
          start: { line: i, column: idx },
          end: { line: i, column: idx + isearchPattern.length }
        });
        col = idx + 1;
      }
    }
    isearchHighlightRanges = ranges;
    if (setSearchMatches) setSearchMatches(ranges);

    if (match) {
      setCursorLine(match.line);
      setCursorColumn(match.column);
      setStatusMessage(`I-search${isearchDirection === "backward" ? " backward" : ""}: ${isearchPattern}`);
    } else {
      setStatusMessage(`Failing I-search${isearchDirection === "backward" ? " backward" : ""}: ${isearchPattern}`);
    }

    return Either.right(createBoolean(match !== null));
  });

  /**
   * search-incremental-backspace - remove last char from isearch pattern
   * Usage: (search-incremental-backspace)
   */
  api.set("search-incremental-backspace", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    if (!isearchActive) {
      return Either.left(createValidationError('ConstraintViolation', 'No active incremental search', 'isearch', null, 'active search'));
    }

    if (isearchPattern.length === 0) {
      return Either.right(createString(""));
    }

    isearchPattern = isearchPattern.slice(0, -1);

    if (isearchPattern.length === 0) {
      setCursorLine(isearchOriginLine);
      setCursorColumn(isearchOriginColumn);
      isearchHighlightRanges = [];
      if (setSearchMatches) setSearchMatches([]);
      setStatusMessage(`I-search${isearchDirection === "backward" ? " backward" : ""}: `);
      return Either.right(createString(""));
    }

    const buf = getCurrentBuffer();
    const bufVal = validateBufferExists(buf);
    if (Either.isLeft(bufVal)) return Either.left(bufVal.left);

    const contentResult = buf!.getContent();
    if (Either.isLeft(contentResult)) return Either.left(createBufferError('Underflow', 'Failed to read buffer'));

    const text = contentResult.right;
    const match = isearchDirection === "forward"
      ? findNextMatch(text, isearchPattern, isearchOriginLine, isearchOriginColumn)
      : findPreviousMatch(text, isearchPattern, isearchOriginLine, isearchOriginColumn);

    const lines = text.split('\n');
    const ranges: Range[] = [];
    for (let i = 0; i < lines.length; i++) {
      let col = 0;
      while (true) {
        const idx = lines[i]!.indexOf(isearchPattern, col);
        if (idx === -1) break;
        ranges.push({ start: { line: i, column: idx }, end: { line: i, column: idx + isearchPattern.length } });
        col = idx + 1;
      }
    }
    isearchHighlightRanges = ranges;
    if (setSearchMatches) setSearchMatches(ranges);

    if (match) {
      setCursorLine(match.line);
      setCursorColumn(match.column);
    }
    setStatusMessage(`I-search${isearchDirection === "backward" ? " backward" : ""}: ${isearchPattern}`);

    return Either.right(createString(isearchPattern));
  });

  /**
   * search-incremental-finish - accept current match and exit isearch
   * Usage: (search-incremental-finish)
   */
  api.set("search-incremental-finish", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    if (!isearchActive) return Either.right(createNil());
    isearchActive = false;
    lastSearchPattern = isearchPattern;
    lastSearchDirection = isearchDirection;
    isearchHighlightRanges = [];
    if (setSearchMatches) setSearchMatches([]);
    setStatusMessage(isearchPattern ? `Found: ${isearchPattern}` : "Search ended");
    return Either.right(createNil());
  });

  /**
   * search-incremental-cancel - cancel isearch, restore original position
   * Usage: (search-incremental-cancel)
   */
  api.set("search-incremental-cancel", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    if (!isearchActive) return Either.right(createNil());
    setCursorLine(isearchOriginLine);
    setCursorColumn(isearchOriginColumn);
    isearchActive = false;
    isearchPattern = "";
    isearchHighlightRanges = [];
    if (setSearchMatches) setSearchMatches([]);
    setStatusMessage("Quit");
    return Either.right(createNil());
  });

  return api;
}
