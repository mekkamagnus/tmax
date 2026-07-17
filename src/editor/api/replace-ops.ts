/**
 * @file replace-ops.ts
 * @description Replace operation primitives for T-Lisp editor API
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createList } from "../../tlisp/values.ts";
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
 * Replace session state
 */
interface ReplaceState {
  findPattern: string;
  replaceText: string;
  matches: { line: number; startCol: number; endCol: number }[];
  currentIndex: number;
  count: number;
  active: boolean;
}

/**
 * Create replace operation API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param setCurrentBuffer - Function to set current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @returns Map of replace function names to implementations
 */
export function createReplaceOps(
  access: EditorModelAccess,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  setCursorLine: (line: number) => void
): Map<string, TLispFunctionImpl> {
  // CHORE-44 Change 1: per-editor replace session state (was module-global).
  let replaceState: ReplaceState = {
    findPattern: "",
    replaceText: "",
    matches: [],
    currentIndex: 0,
    count: 0,
    active: false
  };
  // CHORE-39 Phase 4: cursor/buffer reads flow through the State monad against
  // EditorModel; writes stay on the supplied setters to preserve side effects.
  const getCursorLine = (): number => runModel(access, readModelField("cursorPosition")).line;
  const getCurrentBuffer = (): FunctionalTextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * replace-find-matches - find all matches of a pattern in the buffer
   * Usage: (replace-find-matches PATTERN &optional START END)
   *
   * Get buffer text, split into lines, find all matches of PATTERN
   * (try as regex, fall back to string). Return list of match positions
   * as T-Lisp lists (line startCol endCol). START and END are optional
   * line range bounds.
   */
  api.set("replace-find-matches", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1 || args.length > 3) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'replace-find-matches requires 1 to 3 arguments: PATTERN &optional START END',
        'args',
        args.length,
        '1 to 3 arguments'
      ));
    }

    const patternArg = args[0]!
    const patternTypeValidation = validateArgType(patternArg, "string", 0, "replace-find-matches");
    if (Either.isLeft(patternTypeValidation)) {
      return Either.left(patternTypeValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const pattern = patternArg.value as string;

    // Optional START line
    let startLine = 0;
    if (args.length >= 2 && args[1]!.type !== "nil") {
      const startValidation = validateArgType(args[1], "number", 1, "replace-find-matches");
      if (Either.isLeft(startValidation)) {
        return Either.left(startValidation.left);
      }
      startLine = args[1]!.value as number;
    }

    // Optional END line
    const contentResult = currentBuffer!.getContent();
    if (Either.isLeft(contentResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to get buffer content: ${contentResult.left}`));
    }

    const lineCountResult = currentBuffer!.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      return Either.left(createBufferError('OutOfBounds', `Failed to get line count: ${lineCountResult.left}`));
    }

    let endLine = lineCountResult.right - 1;
    if (args.length >= 3 && args[2]!.type !== "nil") {
      const endValidation = validateArgType(args[2], "number", 2, "replace-find-matches");
      if (Either.isLeft(endValidation)) {
        return Either.left(endValidation.left);
      }
      endLine = args[2]!.value as number;
    }

    // Compile pattern — try regex first, fall back to literal string
    let regex: RegExp | null = null;
    let isLiteral = false;
    try {
      regex = new RegExp(pattern, "g");
    } catch {
      isLiteral = true;
    }

    const matches: { line: number; startCol: number; endCol: number }[] = [];

    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      const lineResult = currentBuffer!.getLine(lineNum);
      if (Either.isLeft(lineResult)) {
        continue;
      }
      const lineText = lineResult.right;

      if (isLiteral) {
        // Literal string search
        let searchFrom = 0;
        while (searchFrom < lineText.length) {
          const index = lineText.indexOf(pattern, searchFrom);
          if (index === -1) break;
          matches.push({ line: lineNum, startCol: index, endCol: index + pattern.length });
          searchFrom = index + 1;
        }
      } else {
        // Regex search
        const globalRegex = new RegExp(regex!.source, regex!.flags);
        let match;
        while ((match = globalRegex.exec(lineText)) !== null) {
          matches.push({ line: lineNum, startCol: match.index, endCol: match.index + match[0]!.length });
          // Prevent infinite loop on zero-length matches
          if (match[0]!.length === 0) {
            globalRegex.lastIndex++;
          }
        }
      }
    }

    // Convert matches to T-Lisp lists
    const matchValues = matches.map(m =>
      createList([
        createNumber(m.line),
        createNumber(m.startCol),
        createNumber(m.endCol)
      ])
    );

    return Either.right(createList(matchValues));
  });

  /**
   * buffer-replace-range - replace text in a range
   * Usage: (buffer-replace-range START-LINE START-COL END-LINE END-COL NEW-TEXT)
   *
   * Delete text in the range, insert NEW-TEXT. Return nil.
   */
  api.set("buffer-replace-range", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 5, "buffer-replace-range");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const startLineArg = args[0]!
    const startLineValidation = validateArgType(startLineArg, "number", 0, "buffer-replace-range");
    if (Either.isLeft(startLineValidation)) {
      return Either.left(startLineValidation.left);
    }

    const startColArg = args[1]!
    const startColValidation = validateArgType(startColArg, "number", 1, "buffer-replace-range");
    if (Either.isLeft(startColValidation)) {
      return Either.left(startColValidation.left);
    }

    const endLineArg = args[2]!
    const endLineValidation = validateArgType(endLineArg, "number", 2, "buffer-replace-range");
    if (Either.isLeft(endLineValidation)) {
      return Either.left(endLineValidation.left);
    }

    const endColArg = args[3]!
    const endColValidation = validateArgType(endColArg, "number", 3, "buffer-replace-range");
    if (Either.isLeft(endColValidation)) {
      return Either.left(endColValidation.left);
    }

    const newTextArg = args[4]!
    const newTextValidation = validateArgType(newTextArg, "string", 4, "buffer-replace-range");
    if (Either.isLeft(newTextValidation)) {
      return Either.left(newTextValidation.left);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const range = {
      start: {
        line: startLineArg.value as number,
        column: startColArg.value as number
      },
      end: {
        line: endLineArg.value as number,
        column: endColArg.value as number
      }
    };
    const newText = newTextArg.value as string;

    // Delete the range
    const deleteResult = currentBuffer!.delete(range);
    if (Either.isLeft(deleteResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to delete range: ${deleteResult.left}`));
    }

    // Insert new text at the start position
    const insertResult = deleteResult.right.insert(range.start, newText);
    if (Either.isLeft(insertResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to insert replacement text: ${insertResult.left}`));
    }

    setCurrentBuffer(insertResult.right);
    return Either.right(createNil());
  });

  /**
   * replace-state-init - initialize replace session state
   * Usage: (replace-state-init FIND REPLACE MATCHES)
   *
   * Store state for the current replace session. Reset currentIndex and count.
   * MATCHES is a list of (line startCol endCol) lists.
   * Return nil.
   */
  api.set("replace-state-init", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 3, "replace-state-init");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const findArg = args[0]!
    const findValidation = validateArgType(findArg, "string", 0, "replace-state-init");
    if (Either.isLeft(findValidation)) {
      return Either.left(findValidation.left);
    }

    const replaceArg = args[1]!
    const replaceValidation = validateArgType(replaceArg, "string", 1, "replace-state-init");
    if (Either.isLeft(replaceValidation)) {
      return Either.left(replaceValidation.left);
    }

    const matchesArg = args[2]!
    if (matchesArg.type !== "list") {
      return Either.left(createValidationError(
        'TypeError',
        'replace-state-init requires a list for argument at position 3',
        'arg3',
        matchesArg,
        'list'
      ));
    }

    const matchesList = matchesArg.value as TLispValue[];
    const parsedMatches: { line: number; startCol: number; endCol: number }[] = [];

    for (const matchEntry of matchesList) {
      if (matchEntry.type !== "list") {
        return Either.left(createValidationError(
          'TypeError',
          'replace-state-init: each match entry must be a list of (line startCol endCol)',
          'matches',
          matchEntry,
          'list'
        ));
      }
      const parts = matchEntry.value as TLispValue[];
      if (parts.length !== 3) {
        return Either.left(createValidationError(
          'ConstraintViolation',
          'replace-state-init: each match entry must have exactly 3 elements (line startCol endCol)',
          'matches',
          parts.length,
          '3 elements'
        ));
      }
      if (parts[0]!.type !== "number" || parts[1]!.type !== "number" || parts[2]!.type !== "number") {
        return Either.left(createValidationError(
          'TypeError',
          'replace-state-init: match entry elements must be numbers',
          'matches',
          parts,
          'numbers'
        ));
      }
      parsedMatches.push({
        line: parts[0]!.value as number,
        startCol: parts[1]!.value as number,
        endCol: parts[2]!.value as number
      });
    }

    replaceState = {
      findPattern: findArg.value as string,
      replaceText: replaceArg.value as string,
      matches: parsedMatches,
      currentIndex: 0,
      count: 0,
      active: true
    };

    return Either.right(createNil());
  });

  /**
   * replace-apply-current - replace current match and move to next
   * Usage: (replace-apply-current)
   *
   * Replace the current match (at currentIndex) with replaceText.
   * Increment count. Move to next match. Return count.
   */
  api.set("replace-apply-current", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "replace-apply-current");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (!replaceState.active || replaceState.currentIndex >= replaceState.matches.length) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'replace-apply-current: no active replace session or no current match',
        'state',
        replaceState.active,
        'active session with remaining matches'
      ));
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const match = replaceState.matches[replaceState.currentIndex]!;

    // Use buffer-replace-range logic inline
    const range = {
      start: { line: match.line, column: match.startCol },
      end: { line: match.line, column: match.endCol }
    };

    const deleteResult = currentBuffer!.delete(range);
    if (Either.isLeft(deleteResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to delete match: ${deleteResult.left}`));
    }

    const insertResult = deleteResult.right.insert(range.start, replaceState.replaceText);
    if (Either.isLeft(insertResult)) {
      return Either.left(createBufferError('InvalidOperation', `Failed to insert replacement: ${insertResult.left}`));
    }

    setCurrentBuffer(insertResult.right);

    // Calculate text length difference for adjusting subsequent matches
    const lengthDiff = replaceState.replaceText.length - (match.endCol - match.startCol);

    // Adjust remaining match positions on the same line
    for (let i = replaceState.currentIndex + 1; i < replaceState.matches.length; i++) {
      const laterMatch = replaceState.matches[i]!;
      if (laterMatch.line === match.line) {
        laterMatch.startCol += lengthDiff;
        laterMatch.endCol += lengthDiff;
      }
    }

    replaceState.count++;
    replaceState.currentIndex++;

    return Either.right(createNumber(replaceState.count));
  });

  /**
   * replace-skip - skip current match without replacing
   * Usage: (replace-skip)
   *
   * Move to next match without replacing. Return nil.
   */
  api.set("replace-skip", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "replace-skip");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (!replaceState.active) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'replace-skip: no active replace session',
        'state',
        replaceState.active,
        'active session'
      ));
    }

    replaceState.currentIndex++;

    return Either.right(createNil());
  });

  /**
   * replace-apply-all - replace all remaining matches
   * Usage: (replace-apply-all)
   *
   * Replace all remaining matches. Return total count.
   */
  api.set("replace-apply-all", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "replace-apply-all");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (!replaceState.active) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'replace-apply-all: no active replace session',
        'state',
        replaceState.active,
        'active session'
      ));
    }

    // Apply remaining matches one by one
    while (replaceState.currentIndex < replaceState.matches.length) {
      const applyResult = api.get("replace-apply-current")!([]);
      if (Either.isLeft(applyResult)) {
        return applyResult;
      }
    }

    return Either.right(createNumber(replaceState.count));
  });

  /**
   * replace-exit - clear replace state and return replacement count
   * Usage: (replace-exit)
   *
   * Clear replace state. Return the count of replacements made.
   */
  api.set("replace-exit", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "replace-exit");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const finalCount = replaceState.count;

    replaceState = {
      findPattern: "",
      replaceText: "",
      matches: [],
      currentIndex: 0,
      count: 0,
      active: false
    };

    return Either.right(createNumber(finalCount));
  });

  /**
   * replace-show-current - move cursor to current match position
   * Usage: (replace-show-current)
   *
   * Move cursor to current match position. Return nil.
   */
  api.set("replace-show-current", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "replace-show-current");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (!replaceState.active || replaceState.currentIndex >= replaceState.matches.length) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'replace-show-current: no active replace session or no current match',
        'state',
        replaceState.active,
        'active session with remaining matches'
      ));
    }

    const match = replaceState.matches[replaceState.currentIndex]!;
    setCursorLine(match.line);

    return Either.right(createNil());
  });

  return api;
}
