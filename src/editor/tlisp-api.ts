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
import { createKillRingOps } from "./api/kill-ring.ts";
import { createYankPopOps } from "./api/yank-pop-ops.ts";
import { createEvilIntegrationOps } from "./api/evil-integration.ts";
import { createLSPDiagnosticsOps } from "./api/lsp-diagnostics.ts";
import { createPluginOps } from "./api/plugin-ops.ts";
import { createDocumentationOps } from "./api/documentation.ts";
import { createHookOps, HookRegistry } from "./api/hook-ops.ts";
import { createSyntaxOps } from "./api/syntax-ops.ts";
import { createReplaceOps } from "./api/replace-ops.ts";
import { createIndentOps } from "./api/indent-ops.ts";
import { createMajorModeOps } from "./api/major-mode-ops.ts";
import { createDiredOps } from "./api/dired-ops.ts";
import { createLoadOps } from "./api/load-ops.ts";
import { createMinorModeOps } from "./api/minor-mode-ops.ts";

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
  lspDiagnostics?: import("../core/types.ts").LSPDiagnostic[];  // LSP diagnostics (US-3.1.2)
  logMessage?: (msg: string) => void;  // Log to *Messages* buffer
  currentFilename?: string;  // Current buffer's filename (SPEC-035 Phase 0a)
  config?: import("../core/types.ts").EditorConfig;
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
    (column) => { state.cursorColumn = column; },
    () => state.currentFilename,
    (path: string) => { state.currentFilename = path; }
  );
  for (const [key, value] of bufferOps.entries()) {
    api.set(key, value);
  }

  // Add cursor operations with visual selection update support (US-1.7.1)
  const cursorOps = createCursorOps(
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => state.cursorColumn,
    (column) => { state.cursorColumn = column; },
    () => state.currentBuffer,
    () => state.mode, // getMode - for visual selection updates
    () => { // updateVisualSelection callback
      const selection = getVisualSelection();
      if (selection) {
        selection.end = { line: state.cursorLine, column: state.cursorColumn };
      }
    }
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
    (column) => { state.cursorColumn = column; },
    () => state.mode, // getMode
    () => { // updateVisualSelection
      const selection = getVisualSelection();
      if (selection) {
        selection.end = { line: state.cursorLine, column: state.cursorColumn };
      }
    }
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
    (buffer) => { state.currentBuffer = buffer; },
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

  // Add kill ring operations (US-1.9.1)
  const killRingOps = createKillRingOps();
  for (const [key, value] of killRingOps.entries()) {
    api.set(key, value);
  }

  // Add evil integration operations (US-1.9.3)
  const evilIntegrationOps = createEvilIntegrationOps();
  for (const [key, value] of evilIntegrationOps.entries()) {
    api.set(key, value);
  }

  // Add yank-pop operations (US-1.9.2)
  const yankPopOps = createYankPopOps(
    () => state.currentBuffer,
    (buffer) => { state.currentBuffer = buffer; },
    () => state.cursorLine,
    () => state.cursorColumn
  );
  for (const [key, value] of yankPopOps.entries()) {
    api.set(key, value);
  }

  // Add LSP diagnostics operations (US-3.1.2)
  const lspDiagnosticsOps = createLSPDiagnosticsOps(
    () => ({ state })
  );
  for (const [key, value] of lspDiagnosticsOps.entries()) {
    api.set(key, value);
  }

  // Add plugin repository operations (US-4.1.1)
  const pluginOps = createPluginOps(
    state.filesystem,
    () => {
      // Get TLPA directory from environment or use default
      const homeDir = process.env.HOME || '/tmp';
      return `${homeDir}/.config/tmax/tlpa`;
    }
  );
  for (const [key, value] of pluginOps.entries()) {
    api.set(key, value);
  }

  // Add documentation operations (US-4.2.1)
  const documentationOps = createDocumentationOps(null as any); // Interpreter not needed for current implementation
  for (const [key, value] of documentationOps.entries()) {
    api.set(key, value);
  }

  // Add hook operations (SPEC-003: real eval + callable hooks)
  const hooks: HookRegistry = new Map();
  const hookOps = createHookOps(hooks, (name: string) => {
    const fn = (state as any)._evalTlisp;
    return fn ? fn(`(${name})`) : Either.right(createNil());
  }, (value: TLispValue) => {
    if (value.type === "function") {
      const fn = value.value as TLispFunctionImpl;
      return fn([]);
    }
    if (value.type === "symbol") {
      const fn = (state as any)._evalTlisp;
      return fn ? fn(`(${value.value as string})`) : Either.right(createNil());
    }
    return Either.right(value);
  });
  for (const [key, value] of hookOps.entries()) {
    api.set(key, value);
  }

  // Add syntax highlighting operations (SPEC-035)
  const syntaxOps = createSyntaxOps(
    () => state.currentBuffer,
    () => {
      const buf = state.currentBuffer;
      if (!buf) return 0;
      const result = buf.getLineCount();
      return Either.isLeft(result) ? 0 : result.right;
    },
    (line: number) => {
      const buf = state.currentBuffer;
      if (!buf) return '';
      const result = buf.getLine(line);
      return Either.isLeft(result) ? '' : result.right;
    }
  );
  for (const [key, value] of syntaxOps.entries()) {
    api.set(key, value);
  }

  // Add replace operations (SPEC-035)
  const replaceOps = createReplaceOps(
    () => state.currentBuffer,
    (buffer) => { state.currentBuffer = buffer; },
    () => state.cursorLine,
    (line) => { state.cursorLine = line; }
  );
  for (const [key, value] of replaceOps.entries()) {
    api.set(key, value);
  }

  // Add indent operations (SPEC-035)
  const indentOps = createIndentOps(
    () => state.currentBuffer,
    (buffer) => { state.currentBuffer = buffer; },
    () => state.cursorLine,
    (line) => { state.cursorLine = line; },
    () => 4 // tabSize default; TODO: read from config
  );
  for (const [key, value] of indentOps.entries()) {
    api.set(key, value);
  }

  // Add major mode operations (SPEC-003: buffer-local state + real eval)
  const majorModeOps = createMajorModeOps(
    () => state.currentBuffer,
    () => state.currentFilename,
    () => false, // bufferModified; TODO: wire to real state
    (expr: string) => {
      // Real eval callback will be wired from editor.ts via setInterpreter
      const fn = (state as any)._evalTlisp;
      return fn ? fn(expr) : Either.right(createNil());
    },
    () => {
      const fn = (state as any)._getCurrentMajorMode;
      return fn ? fn() : "fundamental";
    },
    (mode: string) => {
      const fn = (state as any)._setCurrentMajorMode;
      if (fn) fn(mode);
    },
  );
  for (const [key, value] of majorModeOps.entries()) {
    api.set(key, value);
  }

  // Add dired operations (SPEC-035)
  const diredOps = createDiredOps(
    () => state.currentBuffer,
    (buffer) => { state.currentBuffer = buffer; },
    () => state.cursorLine,
    state.buffers
  );
  for (const [key, value] of diredOps.entries()) {
    api.set(key, value);
  }

  // Add load/provide/require operations (SPEC-003)
  const loadOps = createLoadOps(
    () => {
      const fn = (state as any)._getLoadedFeatures;
      return fn ? fn() : new Set<string>();
    },
    () => {
      const fn = (state as any)._getLoadPaths;
      return fn ? fn() : ['src/tlisp/core'];
    },
    (expr: string) => {
      const fn = (state as any)._evalTlisp;
      return fn ? fn(expr) : Either.right(createNil());
    },
    async (_path: string) => false,
  );
  for (const [key, value] of loadOps.entries()) {
    api.set(key, value);
  }

  // Add minor mode operations (SPEC-003)
  const minorModeOps = createMinorModeOps(
    () => {
      const fn = (state as any)._getMinorModeRegistry;
      return fn ? fn() : new Map();
    },
    () => {
      const fn = (state as any)._getBufferModeStates;
      return fn ? fn() : new Map();
    },
    () => {
      const fn = (state as any)._getCurrentBufferKey;
      return fn ? fn() : "*scratch*";
    },
    () => {
      const fn = (state as any)._getGlobalizedMinorModes;
      return fn ? fn() : new Set<string>();
    },
    (expr: string) => {
      const fn = (state as any)._evalTlisp;
      return fn ? fn(expr) : Either.right(createNil());
    },
    {
      getConfig: () => state.config ?? {
        theme: "default",
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        wordWrap: false,
      },
      setConfig: (config) => { state.config = config; },
    },
  );
  for (const [key, value] of minorModeOps.entries()) {
    api.set(key, value);
  }

  // Add messages operations
  const messagesBuf = state.buffers.get('*Messages*');
  api.set('messages-buffer', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const buf = state.buffers.get('*Messages*');
    if (!buf) return Either.right(createString(''));
    const content = buf.getContent();
    if (content._tag === 'Left') return Either.right(createString(''));
    return Either.right(createString(content.right));
  });

  api.set('message', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length === 0) return Either.left(createValidationError('message', 'requires at least 1 argument'));
    const text = args.map(a => {
      switch (a.type) {
        case 'string': return a.value;
        case 'number': return String(a.value);
        case 'boolean': return String(a.value);
        default: return '';
      }
    }).join(' ');
    state.statusMessage = text;
    if (state.logMessage) state.logMessage(text);
    return Either.right(createString(text));
  });

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
