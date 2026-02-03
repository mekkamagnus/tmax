/**
 * @file yank-pop-ops.ts
 * @description Yank pop operations for cycling through kill ring history (US-1.9.2)
 *
 * Implements Emacs-style yank-pop:
 * - M-y after paste replaces with previous kill-ring item
 * - Repeated M-y cycles through history
 * - C-g cancels yank-pop and restores original
 * - Only works immediately after a paste operation
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createString, createNil } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer, Position } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateBufferExists
} from "../../utils/validation.ts";
import {
  createBufferError,
  AppError
} from "../../error/types.ts";
import {
  killRingRotate,
  killRingYank,
  resetKillRing
} from "./kill-ring.ts";
import { getYankRegister } from "./yank-ops.ts";

/**
 * Yank pop state for tracking paste operations
 */
interface YankPopState {
  active: boolean;           // True if last command was a paste
  pastedText: string;        // The text that was pasted
  pastePosition: Position;   // Where the paste occurred
  pastedLength: number;      // Length of pasted text (for replacement)
}

/**
 * Global yank pop state
 * Reset after any non-paste command
 */
let yankPopState: YankPopState = {
  active: false,
  pastedText: "",
  pastePosition: { line: 0, column: 0 },
  pastedLength: 0
};

/**
 * Reset yank pop state
 * Called after any non-paste command
 */
export function resetYankPopState(): void {
  yankPopState = {
    active: false,
    pastedText: "",
    pastePosition: { line: 0, column: 0 },
    pastedLength: 0
  };
}

/**
 * Get the current yank pop state
 */
export function getYankPopState(): YankPopState {
  return { ...yankPopState };
}

/**
 * Set yank pop state as active after a paste operation
 * @param pastedText - The text that was pasted
 * @param pastePosition - Where the paste occurred
 */
export function activateYankPopState(pastedText: string, pastePosition: Position): void {
  yankPopState = {
    active: true,
    pastedText,
    pastePosition,
    pastedLength: pastedText.length
  };
}

/**
 * Perform yank-pop operation
 * Replaces the last pasted text with the next item from the kill ring
 * Only works if yank-pop state is active (last command was a paste)
 *
 * @param currentBuffer - Current buffer
 * @param setCurrentBuffer - Function to set current buffer
 * @returns Either error or nil
 */
export function performYankPop(
  currentBuffer: FunctionalTextBuffer,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void
): Either<AppError, null> {
  // Check if yank-pop is active (last command was a paste)
  if (!yankPopState.active) {
    return Either.right(null); // Do nothing if no recent paste
  }

  // Rotate kill ring to get next item
  killRingRotate();
  const nextItem = killRingYank();

  // If kill ring is empty, do nothing
  if (nextItem === "") {
    return Either.right(null);
  }

  // Delete the previously pasted text
  const startPos = yankPopState.pastePosition;
  const endPos = calculateEndPosition(startPos, yankPopState.pastedText);

  const deleteResult = currentBuffer.delete({
    start: startPos,
    end: endPos
  });

  if (Either.isLeft(deleteResult)) {
    return Either.left(createBufferError(
      'InvalidOperation',
      `Failed to delete previous paste: ${deleteResult.left}`
    ));
  }

  let buffer = deleteResult.right;

  // Insert the new text from kill ring
  const insertResult = buffer.insert(startPos, nextItem);

  if (Either.isLeft(insertResult)) {
    return Either.left(createBufferError(
      'InvalidOperation',
      `Failed to insert new text: ${insertResult.left}`
    ));
  }

  // Update buffer
  setCurrentBuffer(insertResult.right);

  // Update yank pop state with new pasted text
  yankPopState.pastedText = nextItem;
  yankPopState.pastedLength = nextItem.length;

  return Either.right(null);
}

/**
 * Calculate end position based on start position and pasted text
 * Handles multi-line pastes correctly
 */
function calculateEndPosition(startPos: Position, pastedText: string): Position {
  const lines = pastedText.split('\n');

  if (lines.length === 1) {
    // Single line paste
    return {
      line: startPos.line,
      column: startPos.column + pastedText.length
    };
  } else {
    // Multi-line paste
    // End position is at the end of the last line
    // Column is the length of the last line
    // Line is start line + number of newlines
    return {
      line: startPos.line + lines.length - 1,
      column: lines[lines.length - 1]!.length
    };
  }
}

/**
 * Create yank pop API functions for T-Lisp
 * @returns Map of yank pop function names to implementations
 */
export function createYankPopOps(
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void,
  getCursorLine: () => number,
  getCursorColumn: () => number
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * yank-pop - Replace yanked text with previous kill-ring item (M-y)
   * Usage: (yank-pop)
   *
   * Only works immediately after a paste operation.
   * Replaces the last pasted text with the next item from the kill ring.
   */
  api.set("yank-pop", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left({
        _tag: 'Left',
        left: {
          type: 'ValidationError',
          tag: 'ConstraintViolation',
          message: 'yank-pop requires 0 arguments',
          details: { args, expected: '0 arguments' }
        }
      } as any);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    // Perform yank-pop
    const result = performYankPop(currentBuffer!, setCurrentBuffer);

    if (Either.isLeft(result)) {
      return Either.left(result.left);
    }

    // Return the new text from kill ring
    const yankedText = getYankPopState().pastedText;
    return Either.right(createString(yankedText));
  });

  /**
   * yank-pop-active - Check if yank-pop is active
   * Usage: (yank-pop-active)
   *
   * Returns true if the last command was a paste operation.
   */
  api.set("yank-pop-active", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left({
        _tag: 'Left',
        left: {
          type: 'ValidationError',
          tag: 'ConstraintViolation',
          message: 'yank-pop-active requires 0 arguments',
          details: { args, expected: '0 arguments' }
        }
      } as any);
    }

    const state = getYankPopState();
    return Either.right({ type: 'boolean', value: state.active });
  });

  /**
   * yank-pop-reset - Reset yank-pop state
   * Usage: (yank-pop-reset)
   *
   * Normally called automatically after non-paste commands.
   * Can be called manually to cancel yank-pop.
   */
  api.set("yank-pop-reset", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left({
        _tag: 'Left',
        left: {
          type: 'ValidationError',
          tag: 'ConstraintViolation',
          message: 'yank-pop-reset requires 0 arguments',
          details: { args, expected: '0 arguments' }
        }
      } as any);
    }

    resetYankPopState();
    return Either.right(createNil());
  });

  return api;
}
