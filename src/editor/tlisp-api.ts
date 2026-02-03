/**
 * @file tlisp-api.ts
 * @description T-Lisp editor API functions that bridge TypeScript core with T-Lisp extensibility
 */

import type { TLispValue, TLispFunctionImpl } from "../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../tlisp/values.ts";
import type { TerminalIO, FileSystem, FunctionalTextBuffer } from "../core/types.ts";
import { Either } from "../utils/task-either.ts";
import { createValidationError, AppError } from "../error/types.ts";
import { createBufferOps } from "./api/buffer-ops.ts";
import { createCursorOps } from "./api/cursor-ops.ts";
import { createModeOps } from "./api/mode-ops.ts";
import { createFileOps } from "./api/file-ops.ts";
import { createBindingsOps } from "./api/bindings-ops.ts";
import { createWordOps } from "./api/word-ops.ts";
import { createLineOps } from "./api/line-ops.ts";
import { createDeleteOps, setDeleteRegister } from "./api/delete-ops.ts";
import { createSearchOps } from "./api/search-ops.ts";
import { createYankOps } from "./api/yank-ops.ts";
import { createChangeOps } from "./api/change-ops.ts";
import { createUndoRedoOps } from "./api/undo-redo-ops.ts";
import { createCountOps } from "./api/count-ops.ts";
import { createVisualOps, getVisualSelection, setVisualSelection, clearVisualSelection } from "./api/visual-ops.ts";
import { createTextObjectsOps } from "./api/text-objects-ops.ts";
import { createMinibufferOps } from "./api/minibuffer-ops.ts";
import { createJumpOps } from "./api/jump-ops.ts";

/**
 * T-Lisp function implementation that returns Either for error handling
 */
export type TLispFunctionWithEither = (args: TLispValue[]) => Either<AppError, TLispValue>;

/**
 * Editor operations that can be called from T-Lisp
 */
export interface EditorOperations {
  saveFile: () => Promise<void>;
  openFile: (filename: string) => Promise<void>;
}

/**
 * Editor state that can be accessed from T-Lisp
 * Note: This is a bridge interface for T-Lisp API, different from core EditorState
 */
export interface TlispEditorState {
  currentBuffer: FunctionalTextBuffer | null;
  buffers: Map<string, FunctionalTextBuffer>;
  cursorLine: number;
  cursorColumn: number;
  terminal: TerminalIO;
  filesystem: FileSystem;
  mode: "normal" | "insert" | "visual" | "command" | "mx";
  lastCommand: string;
  statusMessage: string;
  viewportTop: number;  // First line visible in viewport
  commandLine: string;  // Command line input in command mode
  spacePressed: boolean;  // Track if space was just pressed for SPC ; sequence
  mxCommand: string;  // M-x command input
  cursorFocus: 'buffer' | 'command';  // Track where cursor focus should be
  operations?: EditorOperations;  // Optional operations reference
}

/**
 * Create T-Lisp editor API functions
 * @param state - T-Lisp editor state bridge
 * @returns Map of function names to implementations
 */
export function createEditorAPI(state: TlispEditorState): Map<string, TLispFunctionImpl> {
  // Create combined API by merging all module APIs
  const api = new Map<string, TLispFunctionImpl>();

  // Add buffer operations
  const bufferOps = createBufferOps(
    state.buffers,
    () => state.currentBuffer,
    (buffer) => { state.currentBuffer = buffer; },
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => state.cursorColumn,
    (column) => { state.cursorColumn = column; }
  );
  for (const [key, value] of bufferOps.entries()) {
    api.set(key, value);
  }

  // Add cursor operations (without visual update callback initially)
  const cursorOps = createCursorOps(
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => state.cursorColumn,
    (column) => { state.cursorColumn = column; },
    () => state.currentBuffer
  );
  for (const [key, value] of cursorOps.entries()) {
    api.set(key, value);
  }

  // Add mode operations
  const modeOps = createModeOps(
    () => state.mode,
    (mode) => { state.mode = mode; },
    () => state.statusMessage,
    (msg) => { state.statusMessage = msg; },
    () => state.commandLine,
    (cmd) => { state.commandLine = cmd; },
    () => state.spacePressed,
    (pressed) => { state.spacePressed = pressed; },
    () => state.mxCommand,
    (cmd) => { state.mxCommand = cmd; },
    () => state.cursorFocus,
    (focus) => { state.cursorFocus = focus; }
  );
  for (const [key, value] of modeOps.entries()) {
    api.set(key, value);
  }

  // Add file operations
  const fileOps = createFileOps(
    state.operations,
    (msg) => { state.statusMessage = msg; }
  );
  for (const [key, value] of fileOps.entries()) {
    api.set(key, value);
  }

  // Add bindings operations
  const bindingsOps = createBindingsOps(
    () => state.operations,
    (msg) => { state.statusMessage = msg; },
    () => state.commandLine,
    (cmd) => { state.commandLine = cmd; },
    () => state.mode,
    (mode) => { state.mode = mode; },
    () => state.mxCommand,
    (cmd) => { state.mxCommand = cmd; },
    (focus) => { state.cursorFocus = focus; }
  );
  for (const [key, value] of bindingsOps.entries()) {
    api.set(key, value);
  }

  // Add word navigation operations
  const wordOps = createWordOps(
    () => state.currentBuffer,
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => state.cursorColumn,
    (column) => { state.cursorColumn = column; }
  );
  for (const [key, value] of wordOps.entries()) {
    api.set(key, value);
  }

  // Add line navigation operations
  const lineOps = createLineOps(
    () => state.currentBuffer,
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => state.cursorColumn,
    (column) => { state.cursorColumn = column; }
  );
  for (const [key, value] of lineOps.entries()) {
    api.set(key, value);
  }

  // Add delete operator operations
  const deleteOps = createDeleteOps(
    () => state.currentBuffer,
    (buffer) => { state.currentBuffer = buffer; },
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => state.cursorColumn,
    (column) => { state.cursorColumn = column; }
  );
  for (const [key, value] of deleteOps.entries()) {
    api.set(key, value);
  }

  // Add yank operator operations
  const yankOps = createYankOps(
    () => state.currentBuffer,
    (buffer) => { state.currentBuffer = buffer; },
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => state.cursorColumn,
    (column) => { state.cursorColumn = column; }
  );
  for (const [key, value] of yankOps.entries()) {
    api.set(key, value);
  }

  // Add change operator operations
  const changeOps = createChangeOps(
    () => state.currentBuffer,
    (buffer) => { state.currentBuffer = buffer; },
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => state.cursorColumn,
    (column) => { state.cursorColumn = column; },
    (mode) => { state.mode = mode; },
    setDeleteRegister
  );
  for (const [key, value] of changeOps.entries()) {
    api.set(key, value);
  }

  // Add undo/redo operations
  const undoRedoOps = createUndoRedoOps(
    () => state.currentBuffer,
    (buffer) => { state.currentBuffer = buffer; },
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => state.cursorColumn,
    (column) => { state.cursorColumn = column; },
    () => state.statusMessage,
    (msg) => { state.statusMessage = msg; }
  );
  for (const [key, value] of undoRedoOps.entries()) {
    api.set(key, value);
  }

  // Add search operations
  const searchOps = createSearchOps(
    () => state.currentBuffer,
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => state.cursorColumn,
    (column) => { state.cursorColumn = column; },
    (message) => { state.statusMessage = message; }
  );
  for (const [key, value] of searchOps.entries()) {
    api.set(key, value);
  }

  // Add count prefix operations
  // Note: These are integrated differently as they need editor instance access
  // The actual registration happens in editor.ts's initializeAPI method

  // Add visual mode operations
  const visualOps = createVisualOps(
    () => state.currentBuffer,
    () => state.cursorLine,
    () => state.cursorColumn,
    (line) => { state.cursorLine = line; },
    (column) => { state.cursorColumn = column; },
    () => state.mode,
    (mode) => { state.mode = mode; },
    (msg) => { state.statusMessage = msg; }
  );
  for (const [key, value] of visualOps.entries()) {
    api.set(key, value);
  }

  // Add text object operations
  const textObjectsOps = createTextObjectsOps(
    () => state.currentBuffer,
    (buffer) => { state.currentBuffer = buffer; },
    () => state.cursorLine,
    () => state.cursorColumn,
    (mode) => { state.mode = mode; }
  );
  for (const [key, value] of textObjectsOps.entries()) {
    api.set(key, value);
  }

  // Add jump operations (US-1.6.1)
  const jumpOps = createJumpOps(
    () => state.currentBuffer,
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => state.cursorColumn,
    (column) => { state.cursorColumn = column; }
  );
  for (const [key, value] of jumpOps.entries()) {
    api.set(key, value);
  }

  return api;
}

/**
 * Create count prefix operations for T-Lisp API
 * This is a separate function that requires editor instance access
 * @param editor - Editor instance with count management
 * @returns Map of count operation functions
 */
export function createCountAPI(editor: any): Map<string, TLispFunctionImpl> {
  return createCountOps(
    () => editor.getCount(),
    (count: number) => editor.setCount(count),
    () => editor.resetCount()
  );
}