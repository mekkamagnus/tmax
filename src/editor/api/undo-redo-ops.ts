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
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import { Either } from "../../utils/task-either.ts";
import { stateUtils } from "../../utils/state.ts";
import {
  createBufferError,
  createValidationError,
  AppError
} from "../../error/types.ts";

/**
 * History item representing a single edit. Exported so the model-held
 * {@link UndoRedoDomainState} (see `functional/domain-state.ts`) can name
 * the same shape.
 */
export interface HistoryItem {
  description: string;          // Description of the edit (e.g., "delete", "insert")
  buffer: TextBuffer;  // Buffer undoState after the edit
  cursorLine?: number;           // Cursor line position after the edit
  cursorColumn?: number;         // Cursor column position after the edit
  preCursorLine?: number;        // Cursor line immediately before the edit
  preCursorColumn?: number;      // Cursor column immediately before the edit
}

/**
 * Undo/redo undoState management. Exported for the same reason as
 * {@link HistoryItem}.
 */
export interface UndoRedoState {
  history: HistoryItem[];        // All edits in history
  currentIndex: number;          // Current position in history (-1 = at initial undoState)
}

/**
 * Full per-editor undo/redo state group (CHORE-44 Change 1). Bundles
 * {@link UndoRedoState} with the loose initial/pending buffer+cursor scalars
 * the factory previously held as separate `let`s. Lives at
 * `model.session.undoRedo` and is mutated in place by the ops below.
 */
export interface UndoRedoDomainState {
  history: HistoryItem[];
  currentIndex: number;
  initialBuffer: TextBuffer | null;
  initialCursorLine: number | undefined;
  initialCursorColumn: number | undefined;
  pendingBuffer: TextBuffer | null;
  pendingCursorLine: number | undefined;
  pendingCursorColumn: number | undefined;
}

/**
 * Construct a fresh, independent undo/redo state group. Used by
 * `createEditorSessionState()` and by direct tests of the undo factory.
 */
export function createUndoRedoDomainState(): UndoRedoDomainState {
  return {
    history: [],
    currentIndex: -1,
    initialBuffer: null,
    initialCursorLine: undefined,
    initialCursorColumn: undefined,
    pendingBuffer: null,
    pendingCursorLine: undefined,
    pendingCursorColumn: undefined,
  };
}

export function createUndoRedoOps(
  undoState: UndoRedoDomainState,
  getCurrentBuffer: () => TextBuffer | null,
  setCurrentBuffer: (buffer: TextBuffer) => void,
  getCursorLine: () => number,
  setCursorLine: (line: number) => void,
  getCursorColumn: () => number,
  setCursorColumn: (column: number) => void,
  getStatusMessage: () => string,
  setStatusMessage: (msg: string) => void
): { api: Map<string, TLispFunctionImpl>; reset: () => void; setInitialBuffer: (buffer: TextBuffer) => void } {
  // CHORE-44 Change 1: per-editor undo/redo state lives on the model-held
  // `undoState` parameter (model.session.undoRedo). The history helpers below
  // close over and mutate that object in place; no module-global state.

/**
 * Reset undo/redo undoState (for testing)
 */
function resetUndoRedoState(): void {
  // CHORE-39 Phase 4: reset the history singleton via State-monad immutable
  // updates (stateUtils.updateProperty) — commits a fresh UndoRedoState.
  const resetHistory = stateUtils.updateProperty<UndoRedoState, "history">("history", []);
  const resetIndex = stateUtils.updateProperty<UndoRedoState, "currentIndex">("currentIndex", -1);
  const [, afterHistory] = resetHistory.run({ history: undoState.history, currentIndex: undoState.currentIndex });
  const [, next] = resetIndex.run(afterHistory);
  undoState.history = next.history;
  undoState.currentIndex = next.currentIndex;
  undoState.initialBuffer = null;
  undoState.initialCursorLine = undefined;
  undoState.initialCursorColumn = undefined;
  undoState.pendingBuffer = null;
  undoState.pendingCursorLine = undefined;
  undoState.pendingCursorColumn = undefined;
}

/**
 * Get current undo/redo undoState
 */
function getUndoRedoState(): UndoRedoState {
  return { history: undoState.history, currentIndex: undoState.currentIndex };
}

/**
 * Push a new edit to history
 * @param description - Description of the edit
 * @param buffer - Buffer undoState after the edit
 * @param cursorLine - Optional cursor line position after the edit
 * @param cursorColumn - Optional cursor column position after the edit
 * @param preCursorLine - Optional cursor line immediately before the edit
 * @param preCursorColumn - Optional cursor column immediately before the edit
 */
function pushToHistory(
  description: string,
  buffer: TextBuffer,
  cursorLine?: number,
  cursorColumn?: number,
  preCursorLine?: number,
  preCursorColumn?: number
): void {
  // If this is the first edit, save initial buffer undoState
  if (undoState.history.length === 0 && undoState.initialBuffer === null) {
    // We need to get the initial buffer before the first edit
    // This will be set by the caller
  }

  // If we're not at the end of history, truncate future history (branch clearing)
  if (undoState.currentIndex < undoState.history.length - 1) {
    undoState.history = undoState.history.slice(0, undoState.currentIndex + 1);
  }

  // Add new edit to history
  const item: HistoryItem = {
    description,
    buffer,
    cursorLine,
    cursorColumn,
    preCursorLine,
    preCursorColumn
  };

  undoState.history.push(item);
  undoState.currentIndex = undoState.history.length - 1;
}

/**
 * Set initial buffer undoState
 */
function setInitialBuffer(buffer: TextBuffer): void {
  undoState.initialBuffer = buffer;
}

/**
 * Undo the last edit
 * @param setCurrentBuffer - Function to set the current buffer
 * @param setCursorLine - Function to set cursor line
 * @param setCursorColumn - Function to set cursor column
 * @returns Either error or success with status message
 */
function undo(
  setCurrentBuffer: (buffer: TextBuffer) => void,
  setCursorLine?: (line: number) => void,
  setCursorColumn?: (column: number) => void
): Either<AppError, TLispValue> {
  // Check if we can undo
  if (undoState.currentIndex < 0) {
    return Either.right(createString("Already at oldest change"));
  }

  // Snapshot the item being undone before mutating undoState. Its pre-edit cursor
  // is where the user was when they triggered the change; that's the cursor
  // we want to restore on undo.
  const undoneItem = undoState.history[undoState.currentIndex]!;

  // If we're at the first edit, restore to initial buffer + initial cursor.
  // Prefer the undone item's pre-edit cursor over `initialCursorLine`:
  // `initialCursorLine` is seeded only on the first ever commit, so after an
  // undo→cursor-move→new-edit cycle it points at a undoState that no longer
  // corresponds to "before this edit". The undone item's pre-edit cursor is
  // always the position immediately before this edit was applied.
  if (undoState.currentIndex === 0) {
    if (undoState.initialBuffer) {
      setCurrentBuffer(undoState.initialBuffer);
    }
    const restoreLine = undoneItem.preCursorLine ?? undoState.initialCursorLine ?? undoneItem.cursorLine;
    const restoreColumn = undoneItem.preCursorColumn ?? undoState.initialCursorColumn ?? undoneItem.cursorColumn;
    if (setCursorLine && restoreLine !== undefined && restoreLine !== null) {
      setCursorLine(restoreLine);
    }
    if (setCursorColumn && restoreColumn !== undefined && restoreColumn !== null) {
      setCursorColumn(restoreColumn);
    }
    undoState.currentIndex = -1;
    return Either.right(createString("Already at oldest change"));
  }

  // Move to previous undoState for the buffer; but restore the cursor from
  // the undone item's pre-edit position (where the user was before the edit).
  undoState.currentIndex--;
  const item = undoState.history[undoState.currentIndex]!;

  setCurrentBuffer(item.buffer);
  const restoreLine = undoneItem.preCursorLine ?? undoneItem.cursorLine;
  const restoreColumn = undoneItem.preCursorColumn ?? undoneItem.cursorColumn;
  if (setCursorLine && restoreLine !== undefined) {
    setCursorLine(restoreLine);
  }
  if (setCursorColumn && restoreColumn !== undefined) {
    setCursorColumn(restoreColumn);
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
function redo(
  setCurrentBuffer: (buffer: TextBuffer) => void,
  setCursorLine?: (line: number) => void,
  setCursorColumn?: (column: number) => void
): Either<AppError, TLispValue> {
  // Check if we can redo
  if (undoState.currentIndex >= undoState.history.length - 1) {
    return Either.right(createString("Already at newest change"));
  }

  // Move to next undoState
  undoState.currentIndex++;
  const item = undoState.history[undoState.currentIndex]!;

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
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * Begin an undoable T-Lisp edit by capturing the current immutable buffer.
   */
  api.set("undo-begin", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length > 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-begin requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    undoState.pendingBuffer = getCurrentBuffer();
    undoState.pendingCursorLine = getCursorLine();
    undoState.pendingCursorColumn = getCursorColumn();
    return Either.right(createNil());
  });

  /**
   * Commit an undoable T-Lisp edit when the immutable buffer changed.
   */
  api.set("undo-commit", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1 || args[0]!.type !== 'string') {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-commit requires 1 string argument: description',
        'args',
        args,
        '1 string argument'
      ));
    }

    const currentBuffer = getCurrentBuffer();
    if (undoState.pendingBuffer && currentBuffer && undoState.pendingBuffer !== currentBuffer) {
      if (undoState.history.length === 0) {
        setInitialBuffer(undoState.pendingBuffer);
        undoState.initialCursorLine = undoState.pendingCursorLine;
        undoState.initialCursorColumn = undoState.pendingCursorColumn;
      }
      pushToHistory(
        args[0]!.value as string,
        currentBuffer,
        getCursorLine(),
        getCursorColumn(),
        undoState.pendingCursorLine ?? undefined,
        undoState.pendingCursorColumn ?? undefined
      );
    }
    undoState.pendingBuffer = null;
    undoState.pendingCursorLine = undefined;
    undoState.pendingCursorColumn = undefined;

    return Either.right(createNil());
  });

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
      setStatusMessage(result.right.value as string);
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
      setStatusMessage(result.right.value as string);
    }

    return result;
  });

  /**
   * undo-history-push - push a new edit to history
   * Usage: (undo-history-push description buffer [cursor-line] [cursor-column] [pre-cursor-line] [pre-cursor-column])
   * This is called internally by edit operations
   */
  api.set("undo-history-push", (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Requires at least 2 arguments (description, buffer)
    if (args.length < 2) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'undo-history-push requires at least 2 arguments: description, buffer, [cursor-line], [cursor-column], [pre-cursor-line], [pre-cursor-column]',
        'args',
        args,
        '2-6 arguments'
      ));
    }

    const descArg = args[0]!
    if (descArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'undo-history-push description must be a string',
        'args[0]',
        descArg,
        'string'
      ));
    }

    // For the buffer argument, we expect it to be passed directly as a TextBuffer
    // This is an internal API, so we'll extract it from the special value
    const bufferArg = args[1]!
    if (typeof bufferArg !== 'object' || !('buffer' in bufferArg)) {
      return Either.left(createValidationError(
        'TypeError',
        'undo-history-push buffer must be a TextBuffer',
        'args[1]',
        bufferArg,
        'TextBuffer'
      ));
    }

    const buffer = (bufferArg as { buffer: TextBuffer }).buffer;

    // Optional cursor positions (post-edit and pre-edit)
    let cursorLine: number | undefined = undefined;
    let cursorColumn: number | undefined = undefined;
    let preCursorLine: number | undefined = undefined;
    let preCursorColumn: number | undefined = undefined;

    if (args.length >= 3 && args[2]!.type === 'number') {
      cursorLine = args[2]!.value as number;
    }

    if (args.length >= 4 && args[3]!.type === 'number') {
      cursorColumn = args[3]!.value as number;
    }

    if (args.length >= 5 && args[4]!.type === 'number') {
      preCursorLine = args[4]!.value as number;
    }

    if (args.length >= 6 && args[5]!.type === 'number') {
      preCursorColumn = args[5]!.value as number;
    }

    pushToHistory(descArg.value as string, buffer, cursorLine, cursorColumn, preCursorLine, preCursorColumn);
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

    return Either.right(createNumber(undoState.history.length));
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

  return { api, reset: resetUndoRedoState, setInitialBuffer };
}
