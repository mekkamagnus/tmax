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
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateBufferExists
} from "../../utils/validation.ts";
import {
  createBufferError,
  createValidationError,
  AppError
} from "../../error/types.ts";
import type { KillRingOps } from "./kill-ring.ts";

/**
 * Yank pop state for tracking paste operations
 */
export interface YankPopState {
  active: boolean;           // True if last command was a paste
  pastedText: string;        // The text that was pasted
  pastePosition: Position;   // Where the paste occurred
  pastedLength: number;      // Length of pasted text (for replacement)
}

/**
 * Construct a fresh, independent yank-pop state.
 */
export function createYankPopState(): YankPopState {
  return {
    active: false,
    pastedText: "",
    pastePosition: { line: 0, column: 0 },
    pastedLength: 0,
  };
}

/**
 * Bound yank-pop operations over one (per-editor) state instance, wired to the
 * same editor's kill ring.
 */
export interface YankPopOps {
  activate(pastedText: string, pastePosition: Position): void;
  reset(): void;
  isActive(): boolean;
  pastedText(): string;
  perform(currentBuffer: FunctionalTextBuffer, setCurrentBuffer: (buffer: FunctionalTextBuffer) => void): Either<AppError, null>;
}

/**
 * Calculate end position based on start position and pasted text.
 * Handles multi-line pastes correctly.
 */
function calculateEndPosition(startPos: Position, pastedText: string): Position {
  const lines = pastedText.split('\n');
  if (lines.length === 1) {
    return { line: startPos.line, column: startPos.column + pastedText.length };
  }
  return {
    line: startPos.line + lines.length - 1,
    column: lines[lines.length - 1]!.length,
  };
}

export function bindYankPop(state: YankPopState, killRing: KillRingOps): YankPopOps {
  return {
    activate: (pastedText: string, pastePosition: Position): void => {
      state.active = true;
      state.pastedText = pastedText;
      state.pastePosition = pastePosition;
      state.pastedLength = pastedText.length;
    },
    reset: (): void => {
      state.active = false;
      state.pastedText = "";
      state.pastePosition = { line: 0, column: 0 };
      state.pastedLength = 0;
    },
    isActive: (): boolean => state.active,
    pastedText: (): string => state.pastedText,
    perform: (
      currentBuffer: FunctionalTextBuffer,
      setCurrentBuffer: (buffer: FunctionalTextBuffer) => void
    ): Either<AppError, null> => {
      if (!state.active) {
        return Either.right(null);
      }
      killRing.rotate();
      const nextItem = killRing.yank();
      if (nextItem === "") {
        return Either.right(null);
      }
      const startPos = state.pastePosition;
      const endPos = calculateEndPosition(startPos, state.pastedText);
      const deleteResult = currentBuffer.delete({ start: startPos, end: endPos });
      if (Either.isLeft(deleteResult)) {
        return Either.left(createBufferError('InvalidOperation', `Failed to delete previous paste: ${deleteResult.left}`));
      }
      const buffer = deleteResult.right;
      const insertResult = buffer.insert(startPos, nextItem);
      if (Either.isLeft(insertResult)) {
        return Either.left(createBufferError('InvalidOperation', `Failed to insert new text: ${insertResult.left}`));
      }
      setCurrentBuffer(insertResult.right);
      state.pastedText = nextItem;
      state.pastedLength = nextItem.length;
      return Either.right(null);
    },
  };
}

/**
 * Create yank pop API functions for T-Lisp, bound to one editor's yank-pop state.
 */
export function createYankPopOps(
  access: EditorModelAccess,
  ops: YankPopOps,
  setCurrentBuffer: (buffer: FunctionalTextBuffer) => void
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: current-buffer read flows through the State monad against
  // EditorModel; writes stay on the supplied setter to preserve side effects.
  const getCurrentBuffer = (): FunctionalTextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const api = new Map<string, TLispFunctionImpl>();

  api.set("yank-pop", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError('ConstraintViolation', 'yank-pop requires 0 arguments', 'args', args, '0 arguments'));
    }
    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }
    const result = ops.perform(currentBuffer!, setCurrentBuffer);
    if (Either.isLeft(result)) {
      return Either.left(result.left);
    }
    return Either.right(createString(ops.pastedText()));
  });

  api.set("yank-pop-active", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError('ConstraintViolation', 'yank-pop-active requires 0 arguments', 'args', args, '0 arguments'));
    }
    return Either.right({ type: 'boolean', value: ops.isActive() });
  });

  api.set("yank-pop-reset", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError('ConstraintViolation', 'yank-pop-reset requires 0 arguments', 'args', args, '0 arguments'));
    }
    ops.reset();
    return Either.right(createNil());
  });

  return api;
}
