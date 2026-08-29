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
import { createNumber, createString, createNil, createList } from "../../tlisp/values.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import type { Position } from "../../core/contracts/primitives.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
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
import type { EditorSession } from "../functional/domain-state.ts";

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
 * Per-editor visual selection accessor holder (CHORE-44 Change 1). The factory
 * installs get/set/clear closures over its local selection so external readers
 * (`session.visual`) observe the live per-editor value without module globals.
 */
export interface VisualOps {
  get: () => VisualSelection | null;
  set: (selection: VisualSelection | null) => void;
  clear: () => void;
}

/**
 * Construct a fresh visual accessor holder (null selection).
 */
export function createVisualState(): VisualOps {
  let selection: VisualSelection | null = null;
  return {
    get: () => selection,
    set: (s: VisualSelection | null) => { selection = s; },
    clear: () => { selection = null; },
  };
}

/**
 * Create visual mode operations API functions
 * @param getBuffer - Function to get current buffer
 * @param setBuffer - Function to set current buffer (for mutations)
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
  access: EditorModelAccess,
  session: EditorSession,
  setBuffer: (buffer: TextBuffer | null) => void,
  setCursorLine: (line: number) => void,
  setCursorColumn: (column: number) => void,
  setMode: (mode: "normal" | "insert" | "visual" | "command" | "mx" | "replace" | "terminal") => void,
  setStatusMessage: (message: string) => void
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: buffer/cursor/mode reads flow through the State monad
  // against EditorModel; writes stay on the supplied setters to preserve side
  // effects.
  const getCursorLine = (): number => runModel(access, readModelField("cursorPosition")).line;
  const getCursorColumn = (): number => runModel(access, readModelField("cursorPosition")).column;
  const getBuffer = (): TextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const getMode = (): "normal" | "insert" | "visual" | "command" | "mx" | "replace" | "terminal" =>
    runModel(access, readModelField("mode"));
  // CHORE-44 Change 1: per-editor visual selection (was module-global). The
  // factory owns the selection locally; session.visual accessors are routed
  // through it so external readers see the live value.
  let visualSelection: VisualSelection | null = session.visual.get();
  session.visual.get = () => visualSelection;
  session.visual.set = (selection: VisualSelection | null) => { visualSelection = selection; };
  session.visual.clear = () => { visualSelection = null; };
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
   * Swap the visual selection anchor and active endpoint.
   */
  api.set("visual-swap-endpoints", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "visual-swap-endpoints");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (getMode() !== "visual" || !visualSelection) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'Not in visual mode',
        'mode',
        getMode(),
        'visual'
      ));
    }

    const previousStart = visualSelection.start;
    visualSelection = {
      start: visualSelection.end,
      end: previousStart,
      mode: visualSelection.mode
    };
    setCursorLine(previousStart.line);
    setCursorColumn(previousStart.column);

    return Either.right(createList([
      createNumber(visualSelection.start.line),
      createNumber(visualSelection.start.column),
      createNumber(visualSelection.end.line),
      createNumber(visualSelection.end.column),
      createString(visualSelection.mode)
    ]));
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
        'InvalidOperation',
        'No current buffer'
      ));
    }

    if (!visualSelection) {
      return Either.left(createValidationError(
        'ConstraintViolation',
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

    // #230: line mode — operate on WHOLE LINES (Vim: V d/y/p move complete
    // lines including newlines). The span-based path below left an empty line
    // behind and produced registers without the trailing newline, so a
    // linewise paste fell back to charwise.
    if (visualSelection.mode === 'line') {
      const topLine = Math.min(visualSelection.start.line, visualSelection.end.line);
      const bottomLine = Math.max(visualSelection.start.line, visualSelection.end.line);
      const countRes = buffer.getLineCount();
      const lineCount = Either.isRight(countRes) ? countRes.right : bottomLine + 1;
      const lines: string[] = [];
      for (let L = topLine; L <= bottomLine; L++) {
        const lineRes = buffer.getLine(L);
        if (Either.isLeft(lineRes)) { lines.push(""); continue; }
        lines.push(lineRes.right);
      }
      const yanked = lines.join('\n') + '\n';
      session.deleteRegister.set(yanked);
      session.registers.del(yanked, true);
      // Remove the lines entirely: through the newline AFTER the block when a
      // following line exists, otherwise through the newline BEFORE it (tail
      // deletions keep the buffer's final line).
      let deleteResult;
      if (bottomLine + 1 < lineCount) {
        deleteResult = buffer.delete({ start: { line: topLine, column: 0 }, end: { line: bottomLine + 1, column: 0 } });
      } else if (topLine > 0) {
        const prevRes = buffer.getLine(topLine - 1);
        const prevLen = Either.isRight(prevRes) ? prevRes.right.length : 0;
        const lastRes = buffer.getLine(bottomLine);
        const lastLen = Either.isRight(lastRes) ? lastRes.right.length : 0;
        deleteResult = buffer.delete({ start: { line: topLine - 1, column: prevLen }, end: { line: bottomLine, column: lastLen } });
      } else {
        const lastRes = buffer.getLine(bottomLine);
        const lastLen = Either.isRight(lastRes) ? lastRes.right.length : 0;
        deleteResult = buffer.delete({ start: { line: 0, column: 0 }, end: { line: bottomLine, column: lastLen } });
      }
      if (Either.isLeft(deleteResult)) {
        return Either.left({ type: 'BufferError' as const, variant: 'InvalidOperation' as const, message: deleteResult.left });
      }
      setBuffer(deleteResult.right);
      const newCountRes = deleteResult.right.getLineCount();
      const newCount = Either.isRight(newCountRes) ? newCountRes.right : 1;
      setCursorLine(Math.min(topLine, Math.max(0, newCount - 1)));
      setCursorColumn(0);
      visualSelection = null;
      setMode("normal");
      setStatusMessage("");
      return Either.right(createNil());
    }

    // #145: block mode — operate on the RECTANGLE (per-line column slice), not a
    // contiguous span. Lines [topLine, bottomLine] × cols [leftCol, rightCol]
    // (inclusive, vim semantics). Each line's slice is deleted independently, so
    // line numbers never shift. Ragged lines (leftCol past EOL) contribute nothing.
    if (visualSelection.mode === 'block') {
      const topLine = Math.min(visualSelection.start.line, visualSelection.end.line);
      const bottomLine = Math.max(visualSelection.start.line, visualSelection.end.line);
      const leftCol = Math.min(visualSelection.start.column, visualSelection.end.column);
      const rightCol = Math.max(visualSelection.start.column, visualSelection.end.column);
      const segments: string[] = [];
      let current = buffer;
      for (let L = topLine; L <= bottomLine; L++) {
        const lineRes = current.getLine(L);
        if (Either.isLeft(lineRes)) { segments.push(""); continue; }
        const lineText = lineRes.right;
        if (leftCol >= lineText.length) { segments.push(""); continue; }
        const segEnd = Math.min(rightCol, lineText.length - 1);
        segments.push(lineText.slice(leftCol, segEnd + 1));
        const del = current.delete({ start: { line: L, column: leftCol }, end: { line: L, column: segEnd + 1 } });
        if (Either.isRight(del)) current = del.right;
      }
      const yanked = segments.join("\n");
      session.deleteRegister.set(yanked);
      session.registers.del(yanked, false);
      setBuffer(current);
      setCursorLine(topLine);
      setCursorColumn(leftCol);
      visualSelection = null;
      setMode("normal");
      setStatusMessage("");
      return Either.right(createNil());
    }

    // Get selected text and store in delete register
    const selectedText = buffer.getText({ start, end });
    if (Either.isLeft(selectedText)) {
      return Either.left({ type: 'BufferError' as const, variant: 'InvalidOperation' as const, message: selectedText.left });
    }

    // Store in delete register (charwise fall-through — the line and block
    // branches above returned already, so never a linewise register here).
    session.deleteRegister.set(selectedText.right);
    session.registers.del(selectedText.right, false);

    // Delete the selected text
    const deleteResult = buffer.delete({ start, end });
    if (Either.isLeft(deleteResult)) {
      return Either.left({ type: 'BufferError' as const, variant: 'InvalidOperation' as const, message: deleteResult.left });
    }

    // Update buffer with the new buffer (immutable operation)
    setBuffer(deleteResult.right);

    // Exit visual mode
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
        'InvalidOperation',
        'No current buffer'
      ));
    }

    if (!visualSelection) {
      return Either.left(createValidationError(
        'ConstraintViolation',
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

    // #230: line mode — yank WHOLE LINES with the trailing newline so a
    // linewise paste (the primitives' \n detection) pastes as lines.
    if (visualSelection.mode === 'line') {
      const topLine = Math.min(visualSelection.start.line, visualSelection.end.line);
      const bottomLine = Math.max(visualSelection.start.line, visualSelection.end.line);
      const lines: string[] = [];
      for (let L = topLine; L <= bottomLine; L++) {
        const lineRes = buffer.getLine(L);
        if (Either.isLeft(lineRes)) { lines.push(""); continue; }
        lines.push(lineRes.right);
      }
      const yanked = lines.join('\n') + '\n';
      session.yankRegister.set(yanked);
      session.registers.set('"', yanked);
      visualSelection = null;
      setMode("normal");
      setStatusMessage("");
      return Either.right(createNil());
    }

    // #145: block mode — yank the RECTANGLE (per-line column slice), joined with
    // newlines. No buffer mutation. See visual-delete for the rectangle math.
    if (visualSelection.mode === 'block') {
      const topLine = Math.min(visualSelection.start.line, visualSelection.end.line);
      const bottomLine = Math.max(visualSelection.start.line, visualSelection.end.line);
      const leftCol = Math.min(visualSelection.start.column, visualSelection.end.column);
      const rightCol = Math.max(visualSelection.start.column, visualSelection.end.column);
      const segments: string[] = [];
      for (let L = topLine; L <= bottomLine; L++) {
        const lineRes = buffer.getLine(L);
        if (Either.isLeft(lineRes)) { segments.push(""); continue; }
        const lineText = lineRes.right;
        if (leftCol >= lineText.length) { segments.push(""); continue; }
        const segEnd = Math.min(rightCol, lineText.length - 1);
        segments.push(lineText.slice(leftCol, segEnd + 1));
      }
      const yanked = segments.join("\n");
      session.yankRegister.set(yanked);
      session.registers.set('"', yanked);
      visualSelection = null;
      setMode("normal");
      setStatusMessage("");
      return Either.right(createNil());
    }

    // Get selected text and store in yank register
    const selectedText = buffer.getText({ start, end });
    if (Either.isLeft(selectedText)) {
      return Either.left({ type: 'BufferError' as const, variant: 'InvalidOperation' as const, message: selectedText.left });
    }

    // Store in yank register
    session.yankRegister.set(selectedText.right);
    // Also populate the unnamed " register so (get-register ") and paste see
    // the yanked text — mirrors visual-delete's registerDelete and vim semantics
    // (every yank updates "). Without this, visual text-object yanks (viw y)
    // were invisible to the canonical register read.
    session.registers.set('"', selectedText.right);

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
        'InvalidOperation',
        'No current buffer'
      ));
    }

    if (!visualSelection) {
      return Either.left(createValidationError(
        'ConstraintViolation',
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
      return Either.left({ type: 'BufferError' as const, variant: 'InvalidOperation' as const, message: selectedText.left });
    }

    // Convert to lowercase and replace
    const lowercased = selectedText.right.toLowerCase();
    const replaceResult = buffer.replace({ start, end }, lowercased);
    if (Either.isLeft(replaceResult)) {
      return Either.left({ type: 'BufferError' as const, variant: 'InvalidOperation' as const, message: replaceResult.left });
    }

    // Update buffer with the new buffer (immutable operation)
    setBuffer(replaceResult.right);

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
        'InvalidOperation',
        'No current buffer'
      ));
    }

    if (!visualSelection) {
      return Either.left(createValidationError(
        'ConstraintViolation',
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
      return Either.left({ type: 'BufferError' as const, variant: 'InvalidOperation' as const, message: selectedText.left });
    }

    // Convert to uppercase and replace
    const uppercased = selectedText.right.toUpperCase();
    const replaceResult = buffer.replace({ start, end }, uppercased);
    if (Either.isLeft(replaceResult)) {
      return Either.left({ type: 'BufferError' as const, variant: 'InvalidOperation' as const, message: replaceResult.left });
    }

    // Update buffer with the new buffer (immutable operation)
    setBuffer(replaceResult.right);

    // Exit visual mode
    visualSelection = null;
    setMode("normal");
    setStatusMessage("");

    return Either.right(createNil());
  });

  return api;
}
