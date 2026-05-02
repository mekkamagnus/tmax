/**
 * @file undo-redo-ops.ts
 * @description Undo/redo operations for T-Lisp editor API (US-1.2.3)
 *
 * Implements Vim-style undo/redo:
 * - undo: undo last edit (u command)
 * - redo: redo undone edit (Ctrl+r command)
 * - Tracks edit history with cursor positions
 * - Clears redo branch on new edits
 * - Shows appropriate messages at boundaries
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNumber, createString, createNil } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import {
  createBufferError,
  createValidationError,
  AppError
} from "../../error/types.ts";

/**
 * History item representing a single edit
 */
interface HistoryItem {
  description: string;          // Description of the edit (e.g., "delete", "insert")
  buffer: FunctionalTextBuffer;  // Buffer state after the edit
  cursorLine?: number;           // Cursor line position
  cursorColumn?: number;         // Cursor column position
}

/**
 * Undo/redo state management
 */
interface UndoRedoState {
  history: HistoryItem[];        // All edits in history
  currentIndex: number;          // Current position in history (-1 = at initial state)
}

// Global undo/redo state
let state: UndoRedoState = {
  history: [],
  currentIndex: -1
};

// Initial buffer state (before any edits)
let initialBuffer: FunctionalTextBuffer | null = null;

/**
 * Reset undo/redo state (for testing)
 */
export function resetUndoRedoState(): void {
  state = {
    history: [],
    currentIndex: -1
  };
  initialBuffer = null;
}

/**
 * Get current undo/redo state
 */
export function getUndoRedoState(): UndoRedoState {
  return state;
}

/**
 * Push a new edit to history
 * @param description - Description of the edit
 * @param buffer - Buffer state after the edit
 * @param cursorLine - Optional cursor line position
 * @param cursorColumn - Optional cursor column position
 */
export function pushToHistory(
  description: string,
  buffer: FunctionalTextBuffer,
  cursorLine?: number,
  cursorColumn?: number
): void {
  // If this is the first edit, save initial buffer state
  if (state.history.length === 0 && initialBuffer === null) {
    // We need to get the initial buffer before the first edit
    // This will be set by the caller
  }

  // If we're not at the end of history, truncate future history (branch clearing)
  if (state.currentIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.currentIndex + 1);
  }

  // Add new edit to history
  const item: HistoryItem = {
    description,
    buffer,
    cursorLine,
    cursorColumn
  };

  state.history.push(item);
  state.currentIndex = state.history.length - 1;
}

/**
 * Set initial buffer state
 */
export function setInitialBuffer(buffer: FunctionalTextBuffer): void {
  initialBuffer = buffer;
}

/**
 * Undo the last edit
 * @param setCurrentBuffer - Function to set the current buffer
 * @param setCursorLine - Function to set cursor line
 * @param setCursorColumn - Function to set cursor column
 * @returns Either error or success with status message
 */
export function undo(
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  setCursorLine?: (line: number) => void,
  setCursorColumn?: (column: number) => void
): Either<AppError, TLispValue> {
  // Check if we can undo
  if (state.currentIndex < 0) {
    return Either.right(createString("Already at oldest change"));
  }

  // If we're at the first edit, restore to initial buffer
  if (state.currentIndex === 0) {
    if (initialBuffer) {
      setCurrentBuffer(initialBuffer);
    }
    const item = state.history[0]!;
    if (setCursorLine && item.cursorLine !== undefined) {
      setCursorLine(item.cursorLine);
    }
    if (setCursorColumn && item.cursorColumn !== undefined) {
      setCursorColumn(item.cursorColumn);
    }
    state.currentIndex = -1;
    return Either.right(createString("Already at oldest change"));
  }

  // Move to previous state
  state.currentIndex--;
  const item = state.history[state.currentIndex]!;

  // Restore buffer and cursor
  setCurrentBuffer(item.buffer);
  if (setCursorLine && item.cursorLine !== undefined) {
    setCursorLine(item.cursorLine);
  }
  if (setCursorColumn && item.cursorColumn !== undefined) {
    setCursorColumn(item.cursorColumn);
  }

  return Either.right(createNil());
}

/**
 * Redo the next undone edit
 * @param setCurrentBuffer - Function to set the current buffer
 * @param setCursorLine - Function to set cursor line
 * @param setCursorColumn - Function to set cursor column
 * @returns Either error or success with status message
 */
export function redo(
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  setCursorLine?: (line: number) => void,
  setCursorColumn?: (column: number) => void
): Either<AppError, TLispValue> {
  // Check if we can redo
  if (state.currentIndex >= state.history.length - 1) {
    return Either.right(createString("Already at newest change"));
  }

  // Move to next state
  state.currentIndex++;
  const item = state.history[state.currentIndex]!;

  // Restore buffer and cursor
  setCurrentBuffer(item.buffer);
  if (setCursorLine && item.cursorLine !== undefined) {
    setCursorLine(item.cursorLine);
  }
  if (setCursorColumn && item.cursorColumn !== undefined) {
    setCursorColumn(item.cursorColumn);
  }

  return Either.right(createNil());
}

/**
 * Create undo/redo API functions
 * @param getCurrentBuffer - Function to get current buffer
 * @param setCurrentBuffer - Function to set current buffer
 * @param getCursorLine - Function to get cursor line
 * @param setCursorLine - Function to set cursor line
 * @param getCursorColumn - Function to get cursor column
 * @param setCursorColumn - Function to set cursor column
 * @returns Map of undo/redo function names to implementations
 */
export function createUndoRedoOps(
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  getCursorLine: () => number,
  setCursorLine: (line: number) => void,
  getCursorColumn: () => number,
  setCursorColumn: (column: number) => void,
  getStatusMessage: () => string,
  setStatusMessage: (msg: string) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * undo - undo last edit (u command in Vim)
   * Usage: (undo)
   */
  api.set("undo", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    const result = undo(setCurrentBuffer, setCursorLine, setCursorColumn);

    // Set status message if there's one
    if (Either.isRight(result) && result.right.type === 'string') {
      setStatusMessage(result.right.value);
    }

    return result;
  });

  /**
   * redo - redo undone edit (Ctrl+r command in Vim)
   * Usage: (redo)
   */
  api.set("redo", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'redo requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    const result = redo(setCurrentBuffer, setCursorLine, setCursorColumn);

    // Set status message if there's one
    if (Either.isRight(result) && result.right.type === 'string') {
      setStatusMessage(result.right.value);
    }

    return result;
  });

  /**
   * undo-history-push - push a new edit to history
   * Usage: (undo-history-push description buffer [cursor-line] [cursor-column])
   * This is called internally by edit operations
   */
  api.set("undo-history-push", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Requires at least 2 arguments (description, buffer)
    if (args.length < 2) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-history-push requires at least 2 arguments: description, buffer, [cursor-line], [cursor-column]',
        'args',
        args,
        '2-4 arguments'
      ));
    }

    const descArg = args[0];
    if (descArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'undo-history-push description must be a string',
        'args[0]',
        descArg,
        'string'
      ));
    }

    // For the buffer argument, we expect it to be passed directly as a FunctionalTextBuffer
    // This is an internal API, so we'll extract it from the special value
    const bufferArg = args[1];
    if (typeof bufferArg !== 'object' || !('buffer' in bufferArg)) {
      return Either.left(createValidationError(
        'TypeError',
        'undo-history-push buffer must be a FunctionalTextBuffer',
        'args[1]',
        bufferArg,
        'FunctionalTextBuffer'
      ));
    }

    const buffer = (bufferArg as any).buffer as FunctionalTextBuffer;

    // Optional cursor positions
    let cursorLine: number | undefined = undefined;
    let cursorColumn: number | undefined = undefined;

    if (args.length >= 3 && args[2]!.type === 'number') {
      cursorLine = args[2]!.value as number;
    }

    if (args.length >= 4 && args[3]!.type === 'number') {
      cursorColumn = args[3]!.value as number;
    }

    pushToHistory(descArg.value, buffer, cursorLine, cursorColumn);
    return Either.right(createNil());
  });

  /**
   * undo-history-clear - clear undo history
   * Usage: (undo-history-clear)
   */
  api.set("undo-history-clear", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-history-clear requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    resetUndoRedoState();
    return Either.right(createNil());
  });

  /**
   * undo-history-count - get number of items in history
   * Usage: (undo-history-count)
   */
  api.set("undo-history-count", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-history-count requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    return Either.right(createNumber(state.history.length));
  });

  /**
   * undo-get-status - get current status message
   * Usage: (undo-get-status)
   */
  api.set("undo-get-status", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // No arguments allowed
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-get-status requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    const message = getStatusMessage();
    return Either.right(createString(message));
  });

  return api;
}
