/**
 * @file visual-ops.ts
 * @description Visual mode selection operations for T-Lisp editor API (US-1.7.1)
 *
 * Implements Vim-style visual mode with:
 * - v (character-wise selection)
 * - V (line-wise selection)
 * - Ctrl+v (block-wise selection)
 * - Selection state management
 * - Text manipulation (d, y, u, U)
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNumber, createString, createNil } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer, Position } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType
} from "../../utils/validation.ts";
import {
  createValidationError,
  createBufferError,
  AppError
} from "../../error/types.ts";
import { setDeleteRegister } from "./delete-ops.ts";
import { setYankRegister } from "./yank-ops.ts";

/**
 * Visual mode selection type
 */
export type VisualSelectionMode = 'char' | 'line' | 'block';

/**
 * Visual mode selection state
 */
export interface VisualSelection {
  start: Position;
  end: Position;
  mode: VisualSelectionMode;
}

/**
 * Visual mode state (module-level)
 */
let visualSelection: VisualSelection | null = null;

/**
 * Get the current visual selection
 */
export function getVisualSelection(): VisualSelection | null {
  return visualSelection;
}

/**
 * Set the visual selection
 */
export function setVisualSelection(selection: VisualSelection | null): void {
  visualSelection = selection;
}

/**
 * Clear the visual selection
 */
export function clearVisualSelection(): void {
  visualSelection = null;
}

/**
 * Create visual mode operations API functions
 * @param getBuffer - Function to get current buffer
 * @param getCursorLine - Function to get current cursor line
 * @param getCursorColumn - Function to get current cursor column
 * @param setCursorLine - Function to set cursor line
 * @param setCursorColumn - Function to set cursor column
 * @param getMode - Function to get current editor mode
 * @param setMode - Function to set current editor mode
 * @param setStatusMessage - Function to set status message
 * @returns Map of visual mode function names to implementations
 */
export function createVisualOps(
  getBuffer: () => FunctionalTextBuffer | null,
  getCursorLine: () => number,
  getCursorColumn: () => number,
  setCursorLine: (line: number) => void,
  setCursorColumn: (column: number) => void,
  getMode: () => "normal" | "insert" | "visual" | "command" | "mx",
  setMode: (mode: "normal" | "insert" | "visual" | "command" | "mx") => void,
  setStatusMessage: (message: string) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * Enter character-wise visual mode (v)
   */
  api.set("visual-enter-char-mode", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "visual-enter-char-mode");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    // Set visual mode with character-wise selection
    setMode("visual");
    visualSelection = {
      start: { line: getCursorLine(), column: getCursorColumn() },
      end: { line: getCursorLine(), column: getCursorColumn() },
      mode: 'char'
    };

    setStatusMessage("-- VISUAL --");

    return Either.right(createString("visual"));
  });

  /**
   * Enter line-wise visual mode (V)
   */
  api.set("visual-enter-line-mode", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "visual-enter-line-mode");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    // Set visual mode with line-wise selection
    setMode("visual");

    // For line-wise mode, start at beginning of current line
    const currentLine = getCursorLine();
    visualSelection = {
      start: { line: currentLine, column: 0 },
      end: { line: currentLine, column: 0 },
      mode: 'line'
    };

    setStatusMessage("-- VISUAL LINE --");

    return Either.right(createString("visual"));
  });

  /**
   * Enter block-wise visual mode (Ctrl+v)
   */
  api.set("visual-enter-block-mode", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "visual-enter-block-mode");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    // Set visual mode with block-wise selection
    setMode("visual");
    visualSelection = {
      start: { line: getCursorLine(), column: getCursorColumn() },
      end: { line: getCursorLine(), column: getCursorColumn() },
      mode: 'block'
    };

    setStatusMessage("-- VISUAL BLOCK --");

    return Either.right(createString("visual"));
  });

  /**
   * Exit visual mode and clear selection
   */
  api.set("visual-exit", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "visual-exit");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    // Clear selection and return to normal mode
    visualSelection = null;
    setMode("normal");
    setStatusMessage("");

    return Either.right(createString("normal"));
  });

  /**
   * Get current visual selection
   */
  api.set("visual-get-selection", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "visual-get-selection");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (!visualSelection) {
      return Either.right(createNil());
    }

    // Return selection as a list: (start-line start-col end-line end-col mode)
    const result = [
      createNumber(visualSelection.start.line),
      createNumber(visualSelection.start.column),
      createNumber(visualSelection.end.line),
      createNumber(visualSelection.end.column),
      createString(visualSelection.mode)
    ];

    return Either.right(createList(result));
  });

  /**
   * Update visual selection end position
   * Called when cursor moves in visual mode
   */
  api.set("visual-update-end", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "visual-update-end");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    // Only update if in visual mode and selection exists
    if (getMode() !== "visual" || !visualSelection) {
      return Either.right(createNil());
    }

    // Update end position to current cursor position
    visualSelection.end = {
      line: getCursorLine(),
      column: getCursorColumn()
    };

    return Either.right(createNil());
  });

  /**
   * Delete selected text (d in visual mode)
   */
  api.set("visual-delete", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "visual-delete");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const buffer = getBuffer();
    if (!buffer) {
      return Either.left(createBufferError(
        'NoBuffer',
        'No current buffer',
        'buffer'
      ));
    }

    if (!visualSelection) {
      return Either.left(createValidationError(
        'InvalidState',
        'Not in visual mode',
        'mode',
        getMode(),
        'visual'
      ));
    }

    // Normalize selection (ensure start <= end)
    const start = visualSelection.start.line < visualSelection.end.line ||
      (visualSelection.start.line === visualSelection.end.line &&
       visualSelection.start.column <= visualSelection.end.column)
      ? visualSelection.start
      : visualSelection.end;
    const end = visualSelection.start.line < visualSelection.end.line ||
      (visualSelection.start.line === visualSelection.end.line &&
       visualSelection.start.column <= visualSelection.end.column)
      ? visualSelection.end
      : visualSelection.start;

    // Get selected text and store in delete register
    const selectedText = buffer.getText({ start, end });
    if (Either.isLeft(selectedText)) {
      return Either.left(selectedText.left);
    }

    // Store in delete register
    setDeleteRegister(selectedText.right);

    // Delete the selected text
    const deleteResult = buffer.delete({ start, end });
    if (Either.isLeft(deleteResult)) {
      return Either.left(deleteResult.left);
    }

    // Update buffer and exit visual mode
    // Note: Buffer is immutable, so we need to update the reference
    visualSelection = null;
    setMode("normal");
    setStatusMessage("");

    return Either.right(createNil());
  });

  /**
   * Yank selected text (y in visual mode)
   */
  api.set("visual-yank", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "visual-yank");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const buffer = getBuffer();
    if (!buffer) {
      return Either.left(createBufferError(
        'NoBuffer',
        'No current buffer',
        'buffer'
      ));
    }

    if (!visualSelection) {
      return Either.left(createValidationError(
        'InvalidState',
        'Not in visual mode',
        'mode',
        getMode(),
        'visual'
      ));
    }

    // Normalize selection
    const start = visualSelection.start.line < visualSelection.end.line ||
      (visualSelection.start.line === visualSelection.end.line &&
       visualSelection.start.column <= visualSelection.end.column)
      ? visualSelection.start
      : visualSelection.end;
    const end = visualSelection.start.line < visualSelection.end.line ||
      (visualSelection.start.line === visualSelection.end.line &&
       visualSelection.start.column <= visualSelection.end.column)
      ? visualSelection.end
      : visualSelection.start;

    // Get selected text and store in yank register
    const selectedText = buffer.getText({ start, end });
    if (Either.isLeft(selectedText)) {
      return Either.left(selectedText.left);
    }

    // Store in yank register
    setYankRegister(selectedText.right);

    // Exit visual mode (without deleting)
    visualSelection = null;
    setMode("normal");
    setStatusMessage("");

    return Either.right(createNil());
  });

  /**
   * Lowercase selected text (u in visual mode)
   */
  api.set("visual-lowercase", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "visual-lowercase");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const buffer = getBuffer();
    if (!buffer) {
      return Either.left(createBufferError(
        'NoBuffer',
        'No current buffer',
        'buffer'
      ));
    }

    if (!visualSelection) {
      return Either.left(createValidationError(
        'InvalidState',
        'Not in visual mode',
        'mode',
        getMode(),
        'visual'
      ));
    }

    // Normalize selection
    const start = visualSelection.start.line < visualSelection.end.line ||
      (visualSelection.start.line === visualSelection.end.line &&
       visualSelection.start.column <= visualSelection.end.column)
      ? visualSelection.start
      : visualSelection.end;
    const end = visualSelection.start.line < visualSelection.end.line ||
      (visualSelection.start.line === visualSelection.end.line &&
       visualSelection.start.column <= visualSelection.end.column)
      ? visualSelection.end
      : visualSelection.start;

    // Get selected text
    const selectedText = buffer.getText({ start, end });
    if (Either.isLeft(selectedText)) {
      return Either.left(selectedText.left);
    }

    // Convert to lowercase and replace
    const lowercased = selectedText.right.toLowerCase();
    const replaceResult = buffer.replace({ start, end }, lowercased);
    if (Either.isLeft(replaceResult)) {
      return Either.left(replaceResult.left);
    }

    // Exit visual mode
    visualSelection = null;
    setMode("normal");
    setStatusMessage("");

    return Either.right(createNil());
  });

  /**
   * Uppercase selected text (U in visual mode)
   */
  api.set("visual-uppercase", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "visual-uppercase");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const buffer = getBuffer();
    if (!buffer) {
      return Either.left(createBufferError(
        'NoBuffer',
        'No current buffer',
        'buffer'
      ));
    }

    if (!visualSelection) {
      return Either.left(createValidationError(
        'InvalidState',
        'Not in visual mode',
        'mode',
        getMode(),
        'visual'
      ));
    }

    // Normalize selection
    const start = visualSelection.start.line < visualSelection.end.line ||
      (visualSelection.start.line === visualSelection.end.line &&
       visualSelection.start.column <= visualSelection.end.column)
      ? visualSelection.start
      : visualSelection.end;
    const end = visualSelection.start.line < visualSelection.end.line ||
      (visualSelection.start.line === visualSelection.end.line &&
       visualSelection.start.column <= visualSelection.end.column)
      ? visualSelection.end
      : visualSelection.start;

    // Get selected text
    const selectedText = buffer.getText({ start, end });
    if (Either.isLeft(selectedText)) {
      return Either.left(selectedText.left);
    }

    // Convert to uppercase and replace
    const uppercased = selectedText.right.toUpperCase();
    const replaceResult = buffer.replace({ start, end }, uppercased);
    if (Either.isLeft(replaceResult)) {
      return Either.left(replaceResult.left);
    }

    // Exit visual mode
    visualSelection = null;
    setMode("normal");
    setStatusMessage("");

    return Either.right(createNil());
  });

  return api;
}
