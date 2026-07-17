/**
 * @file tlisp-api.ts
 * @description T-Lisp editor API functions that bridge TypeScript core with T-Lisp extensibility
 */

import type { TLispValue, TLispFunctionImpl } from "../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../tlisp/values.ts";
import { renameSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import type { TerminalIO, FileSystem, FunctionalTextBuffer } from "../core/types.ts";
import { FunctionalTextBufferImpl } from "../core/buffer.ts";
import { Either } from "../utils/task-either.ts";
import { capTail } from "./log-entry.ts";
import type { LogCategory, LogView } from "./log-entry.ts";
import type { LogLevel } from "./message-log.ts";
import { stateUtils } from "../utils/state.ts";
import { type EditorModel } from "./functional/model.ts";
import { runModel, type EditorModelAccess } from "./api/state-context.ts";
import { createValidationError, AppError } from "../error/types.ts";
import { createBufferOps } from "./api/buffer-ops.ts";
import { createCursorOps } from "./api/cursor-ops.ts";
import { createModeOps } from "./api/mode-ops.ts";
import { createFileOps } from "./api/file-ops.ts";
import { createBindingsOps } from "./api/bindings-ops.ts";
import { createWordOps } from "./api/word-ops.ts";
import { createLineOps } from "./api/line-ops.ts";
import { createDeleteOps } from "./api/delete-ops.ts";
import { createSearchOps } from "./api/search-ops.ts";
import { createYankOps } from "./api/yank-ops.ts";
import { createChangeOps } from "./api/change-ops.ts";
import { createUndoRedoOps } from "./api/undo-redo-ops.ts";
import { createCountOps } from "./api/count-ops.ts";
import { createVisualOps } from "./api/visual-ops.ts";
import { createTextObjectsOps } from "./api/text-objects-ops.ts";
import { createJumpOps } from "./api/jump-ops.ts";
import { createKillRingOps } from "./api/kill-ring.ts";
import { createYankPopOps } from "./api/yank-pop-ops.ts";
import { createEvilIntegrationOps } from "./api/evil-integration.ts";
import { createClipboardOps } from "./api/clipboard-ops.ts";
import { createLSPDiagnosticsOps } from "./api/lsp-diagnostics.ts";
import { createPluginOps } from "./api/plugin-ops.ts";
import { createDocumentationOps } from "./api/documentation.ts";
import { createHookOps, HookRegistry } from "./api/hook-ops.ts";
import { createSyntaxOps } from "./api/syntax-ops.ts";
import { createReplaceOps } from "./api/replace-ops.ts";
import { createIndentOps } from "./api/indent-ops.ts";
import { createMajorModeOps } from "./api/major-mode-ops.ts";
import { createDiredOps } from "./api/dired-ops.ts";
import { createRawLoadOps } from "./api/load-ops.ts";
import { createMinorModeOps } from "./api/minor-mode-ops.ts";
import { createModuleOps } from "./api/module-ops.ts";
import { ModuleRegistry } from "../tlisp/module-registry.ts";
import { createAstOps } from "./api/ast-ops.ts";
import { createNavigationOps } from "./api/navigation-ops.ts";
import type { EditorAPIContext } from "./runtime/editor-api-context.ts";
import { foldToggle, foldOpen, foldClose, foldCloseAll, foldOpenAll, foldByLevel, foldIsCollapsed, foldGetRanges, findHeadingRanges } from "./api/fold-ops.ts";
import { createBrowseUrlOps, tsOpenExternalOutcome, type BrowseUrlPrimitiveDeps } from "./api/browse-url-ops.ts";

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
 * Create T-Lisp editor API functions
 * @param ctx - typed editor API context (CHORE-44 Change 2: replaces the legacy
 *              editor-state bridge + compat projection + underscored hooks)
 * @returns Map of function names to implementations
 */
export function createEditorAPI(ctx: EditorAPIContext): Map<string, TLispFunctionImpl> {
  // Create combined API by merging all module APIs
  const api = new Map<string, TLispFunctionImpl>();

  // CHORE-44 Change 2: the typed EditorAPIContext supplies the model access,
  // per-editor session, and per-editor caches directly — no legacy compat
  // projection, no underscored hooks. Factories migrated to State<EditorModel>
  // receive `modelAccess`; the others receive `session` / `caches` slices.
  const modelAccess: EditorModelAccess = ctx.access;
  const session = ctx.session;
  const caches = ctx.caches;
  // Genuine State-monad read of the current mode (used by factories that still
  // take a getMode callback, e.g. cursor-ops). Runs stateUtils.getProperty
  // against EditorModel and commits the (unchanged) snapshot.
  const getModeViaState = (): EditorModel["mode"] =>
    runModel(modelAccess, stateUtils.getProperty<EditorModel, "mode">("mode"));

  // Add buffer operations
  const setCursorLine = (line: number) => {
    ctx.cursorLine = line;
    // Auto-expand fold if cursor lands inside a collapsed region
    if (ctx.foldRanges && ctx.foldRanges.size > 0) {
      for (const [foldStart, foldEnd] of ctx.foldRanges) {
        if (line > foldStart && line <= foldEnd) {
          ctx.foldRanges.delete(foldStart);
          break;
        }
      }
    }
  };

  const bufferOps = createBufferOps(
    modelAccess,
    ctx.buffers,
    (buffer) => { ctx.currentBuffer = buffer; },
    setCursorLine,
    (column) => { ctx.cursorColumn = column; },
    (path: string) => { ctx.currentFilename = path; },
    (modified: boolean) => ctx.setBufferModified?.(modified),
    new Set(['*Messages*', '*daemon*', '*Shell Output*', '*Async Output*', '*Tests*']),
  );
  for (const [key, value] of bufferOps.entries()) {
    api.set(key, value);
  }

  // Add cursor operations with visual selection update support (US-1.7.1)
  const cursorOps = createCursorOps(
    modelAccess,
    setCursorLine,
    (column) => { ctx.cursorColumn = column; },
    getModeViaState, // getMode - State-monad read (cursor-ops reads cursor/buffer via access)
    () => { // updateVisualSelection callback
      const selection = session.visual.get();
      if (selection) {
        selection.end = { line: ctx.cursorLine, column: ctx.cursorColumn };
      }
    }
  );
  for (const [key, value] of cursorOps.entries()) {
    api.set(key, value);
  }

  // Add mode operations
  const modeOps = createModeOps(
    modelAccess,
    () => ctx.statusMessage,
    (msg) => { ctx.statusMessage = msg; },
    () => ctx.commandLine,
    (cmd) => { ctx.commandLine = cmd; },
    (pressed) => { ctx.spacePressed = pressed; },
    () => ctx.cursorFocus,
    (focus) => { ctx.cursorFocus = focus; }
  );
  for (const [key, value] of modeOps.entries()) {
    api.set(key, value);
  }

  // Add file operations
  const fileOps = createFileOps(
    ctx.operations,
    (msg) => { ctx.statusMessage = msg; },
    undefined,
    undefined,
    modelAccess,
  );
  for (const [key, value] of fileOps.entries()) {
    api.set(key, value);
  }

  // Add search operations (before bindings so :nohl can call into search state)
  const searchOps = createSearchOps(
    modelAccess,
    (line) => { ctx.cursorLine = line; },
    (column) => { ctx.cursorColumn = column; },
    (message) => { ctx.statusMessage = message; },
    (ranges) => { ctx.searchMatches = ranges; }
  );
  for (const [key, value] of searchOps.entries()) {
    api.set(key, value);
  }

  // Add bindings operations
  const clearSearchHighlights = () => {
    ctx.searchMatches = [];
    const fn = searchOps.get("search-clear-highlights");
    if (fn) fn([]);
  };
  const bindingsOps = createBindingsOps(
    modelAccess,
    () => ctx.operations,
    (msg) => { ctx.statusMessage = msg; },
    (cmd) => { ctx.commandLine = cmd; },
    () => ctx.mode,
    (mode) => { ctx.mode = mode; },
    (focus) => { ctx.cursorFocus = focus; },
    clearSearchHighlights,
    ctx.evalTlisp,
    (msg: string, level?: string) => { ctx.logMessage?.(msg, level); }
  );
  for (const [key, value] of bindingsOps.entries()) {
    api.set(key, value);
  }

  // Add word navigation operations
  const wordOps = createWordOps(
    modelAccess,
    (line) => { ctx.cursorLine = line; },
    (column) => { ctx.cursorColumn = column; },
    () => ctx.mode, // getMode
    () => { // updateVisualSelection
      const selection = session.visual.get();
      if (selection) {
        selection.end = { line: ctx.cursorLine, column: ctx.cursorColumn };
      }
    }
  );
  for (const [key, value] of wordOps.entries()) {
    api.set(key, value);
  }

  // Add line navigation operations
  const lineOps = createLineOps(
    modelAccess,
    (line) => { ctx.cursorLine = line; },
    (column) => { ctx.cursorColumn = column; }
  );
  for (const [key, value] of lineOps.entries()) {
    api.set(key, value);
  }

  // Add delete operator operations
  const deleteOps = createDeleteOps(
    modelAccess,
    session,
    (buffer) => { ctx.currentBuffer = buffer; },
    (line) => { ctx.cursorLine = line; },
    (column) => { ctx.cursorColumn = column; }
  );
  for (const [key, value] of deleteOps.entries()) {
    api.set(key, value);
  }

  // Add yank operator operations
  const yankOps = createYankOps(
    modelAccess,
    session,
    (buffer) => { ctx.currentBuffer = buffer; },
    (line) => { ctx.cursorLine = line; },
    (column) => { ctx.cursorColumn = column; }
  );
  for (const [key, value] of yankOps.entries()) {
    api.set(key, value);
  }

  // Add change operator operations
  const changeOps = createChangeOps(
    modelAccess,
    (buffer) => { ctx.currentBuffer = buffer; },
    (line) => { ctx.cursorLine = line; },
    (column) => { ctx.cursorColumn = column; },
    (mode) => { ctx.mode = mode; },
    session
  );
  for (const [key, value] of changeOps.entries()) {
    api.set(key, value);
  }

  // Add undo/redo operations
  const undoRedoOps = createUndoRedoOps(
    modelAccess.getModel().session.undoRedo,
    () => ctx.currentBuffer,
    (buffer) => { ctx.currentBuffer = buffer; },
    () => ctx.cursorLine,
    (line) => { ctx.cursorLine = line; },
    () => ctx.cursorColumn,
    (column) => { ctx.cursorColumn = column; },
    () => ctx.statusMessage,
    (msg) => { ctx.statusMessage = msg; }
  );
  for (const [key, value] of undoRedoOps.api.entries()) {
    api.set(key, value);
  }

  // Add count prefix operations
  // Note: These are integrated differently as they need editor instance access
  // The actual registration happens in editor.ts's initializeAPI method

  // Add visual mode operations
  const visualOps = createVisualOps(
    modelAccess,
    session,
    (buffer) => { ctx.currentBuffer = buffer; },
    (line) => { ctx.cursorLine = line; },
    (column) => { ctx.cursorColumn = column; },
    (mode) => { ctx.mode = mode; },
    (msg) => { ctx.statusMessage = msg; }
  );
  for (const [key, value] of visualOps.entries()) {
    api.set(key, value);
  }

  // Add text object operations
  const textObjectsOps = createTextObjectsOps(
    modelAccess,
    session,
    (buffer) => { ctx.currentBuffer = buffer; },
    (mode) => { ctx.mode = mode; }
  );
  for (const [key, value] of textObjectsOps.entries()) {
    api.set(key, value);
  }

  // Add jump operations (US-1.6.1)
  const jumpOps = createJumpOps(
    modelAccess,
    (line) => { ctx.cursorLine = line; },
    (column) => { ctx.cursorColumn = column; },
    (top) => { ctx.viewportTop = top; },
    () => ctx.terminal.getSize().height,
    (left: number) => { ctx.viewportLeft = left; },
    () => ctx.terminal.getSize().width,
  );
  for (const [key, value] of jumpOps.entries()) {
    api.set(key, value);
  }

  // Add kill ring operations (US-1.9.1)
  const killRingOps = createKillRingOps(session.killRing);
  for (const [key, value] of killRingOps.entries()) {
    api.set(key, value);
  }

  // Add evil integration operations (US-1.9.3)
  const evilIntegrationOps = createEvilIntegrationOps(session.registers);
  for (const [key, value] of evilIntegrationOps.entries()) {
    api.set(key, value);
  }

  // Add OS clipboard primitives (SPEC-044 Phase 2.4)
  const clipboardOps = createClipboardOps();
  for (const [key, value] of clipboardOps.entries()) {
    api.set(key, value);
  }

  // Add yank-pop operations (US-1.9.2)
  const yankPopOps = createYankPopOps(
    modelAccess,
    session.yankPop,
    (buffer) => { ctx.currentBuffer = buffer; }
  );
  for (const [key, value] of yankPopOps.entries()) {
    api.set(key, value);
  }

  // Add LSP diagnostics operations (US-3.1.2)
  const lspDiagnosticsOps = createLSPDiagnosticsOps(modelAccess);
  for (const [key, value] of lspDiagnosticsOps.entries()) {
    api.set(key, value);
  }

  // Add plugin repository operations (US-4.1.1)
  const pluginOps = createPluginOps(
    ctx.filesystem,
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
  const documentationOps = createDocumentationOps(null); // Interpreter not needed for current implementation
  for (const [key, value] of documentationOps.entries()) {
    api.set(key, value);
  }

  // Add hook operations
  const hooks: HookRegistry = new Map();
  const hookOps = createHookOps(hooks, (name: string) => {
    const fn = ctx.evalTlisp;
    return fn ? fn(`(${name})`) : Either.right(createNil());
  }, (value: TLispValue) => {
    if (value.type === "function") {
      const fn = value.value as TLispFunctionImpl;
      return fn([]);
    }
    if (value.type === "symbol") {
      const fn = ctx.evalTlisp;
      return fn ? fn(`(${value.value as string})`) : Either.right(createNil());
    }
    return Either.right(value);
  });
  for (const [key, value] of hookOps.entries()) {
    api.set(key, value);
  }

  // Add syntax highlighting operations
  const syntaxOps = createSyntaxOps(
    modelAccess,
    () => {
      const buf = ctx.currentBuffer;
      if (!buf) return 0;
      const result = buf.getLineCount();
      return Either.isLeft(result) ? 0 : result.right;
    },
    (line: number) => {
      const buf = ctx.currentBuffer;
      if (!buf) return '';
      const result = buf.getLine(line);
      return Either.isLeft(result) ? '' : result.right;
    }
  );
  for (const [key, value] of syntaxOps.entries()) {
    api.set(key, value);
  }

  // Add replace operations
  const replaceOps = createReplaceOps(
    modelAccess,
    (buffer) => { ctx.currentBuffer = buffer; },
    (line) => { ctx.cursorLine = line; }
  );
  for (const [key, value] of replaceOps.entries()) {
    api.set(key, value);
  }

  // Add indent operations
  const indentOps = createIndentOps(
    modelAccess,
    (buffer) => { ctx.currentBuffer = buffer; },
    (line) => { ctx.cursorLine = line; },
    () => 4 // tabSize default; TODO: read from config
  );
  for (const [key, value] of indentOps.entries()) {
    api.set(key, value);
  }

  // Add major mode operations
  const majorModeOps = createMajorModeOps(
    modelAccess,
    (expr: string) => {
      // Real eval callback will be wired from editor.ts via setInterpreter
      const fn = ctx.evalTlisp;
      return fn ? fn(expr) : Either.right(createNil());
    },
    () => {
      const fn = ctx.getCurrentMajorMode;
      return fn ? fn() : "fundamental";
    },
    (mode: string) => {
      const fn = ctx.setCurrentMajorMode;
      if (fn) fn(mode);
    },
  );
  for (const [key, value] of majorModeOps.entries()) {
    api.set(key, value);
  }

  // Add dired operations
  const diredOps = createDiredOps(
    modelAccess,
    (buffer) => { ctx.currentBuffer = buffer; },
    ctx.buffers
  );
  for (const [key, value] of diredOps.entries()) {
    api.set(key, value);
  }

  // Add raw file loading operations. Feature loading is handled by require-module.
  const loadOps = createRawLoadOps(
    modelAccess,
    (expr: string) => {
      const fn = ctx.evalTlisp;
      return fn ? fn(expr) : Either.right(createNil());
    },
    async (_path: string) => false,
  );
  for (const [key, value] of loadOps.entries()) {
    api.set(key, value);
  }

  // Add module introspection operations
  const moduleOps = createModuleOps(
    modelAccess,
    () => {
      const fn = ctx.getModuleRegistry;
      return fn ? fn() : new ModuleRegistry();
    },
  );
  for (const [key, value] of moduleOps.entries()) {
    api.set(key, value);
  }

  // Add minor mode operations
  const minorModeOps = createMinorModeOps(
    () => {
      const fn = ctx.getMinorModeRegistry;
      return fn ? fn() : new Map();
    },
    () => {
      const fn = ctx.getBufferModeStates;
      return fn ? fn() : new Map();
    },
    () => {
      const fn = ctx.getCurrentBufferKey;
      return fn ? fn() : "*scratch*";
    },
    () => {
      const fn = ctx.getGlobalizedMinorModes;
      return fn ? fn() : new Set<string>();
    },
    (expr: string) => {
      const fn = ctx.evalTlisp;
      return fn ? fn(expr) : Either.right(createNil());
    },
    {
      getConfig: () => ctx.config ?? {
        theme: "default",
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        relativeLineNumbers: false,
        wordWrap: false,
      },
      setConfig: (config) => { ctx.config = config; },
    },
    modelAccess,
  );
  for (const [key, value] of minorModeOps.entries()) {
    api.set(key, value);
  }

  // Add AST structural editing operations
  // CHORE-44 Change 1: one per-editor cache instance shared by ast + navigation
  // ops, so two concurrent editors do not share AST/parse caches (AC1.4).
  // (CHORE-44 Change 2: `caches` now comes from ctx.caches above.)
  const astOps = createAstOps({
    access: modelAccess,
    caches,
    getBufferName: () => ctx.currentFilename ?? "*scratch*",
    getBufferText: () => {
      const buf = ctx.currentBuffer;
      if (!buf) return "";
      const content = buf.getContent();
      return Either.isLeft(content) ? "" : content.right;
    },
    getCursorLine: () => ctx.cursorLine,
    getCursorColumn: () => ctx.cursorColumn,
    getCursorOffset: () => {
      const buf = ctx.currentBuffer;
      if (!buf) return 0;
      // Compute offset from line + column
      const content = buf.getContent();
      if (Either.isLeft(content)) return 0;
      const text = content.right;
      let offset = 0;
      for (let i = 0; i < ctx.cursorLine; i++) {
        const nl = text.indexOf("\n", offset);
        if (nl < 0) break;
        offset = nl + 1;
      }
      return offset + ctx.cursorColumn;
    },
    setStatusMessage: (msg) => { ctx.statusMessage = msg; },
  });
  for (const [key, value] of astOps.entries()) {
    api.set(key, value);
  }

  // Add code navigation operations
  const navigationOps = createNavigationOps({
    access: modelAccess,
    caches,
    getBufferName: () => ctx.currentFilename ?? "*scratch*",
    getBufferText: () => {
      const buf = ctx.currentBuffer;
      if (!buf) return "";
      const content = buf.getContent();
      return Either.isLeft(content) ? "" : content.right;
    },
    getCursorLine: () => ctx.cursorLine,
    getCursorColumn: () => ctx.cursorColumn,
    getCursorOffset: () => {
      const buf = ctx.currentBuffer;
      if (!buf) return 0;
      const content = buf.getContent();
      if (Either.isLeft(content)) return 0;
      const text = content.right;
      let offset = 0;
      for (let i = 0; i < ctx.cursorLine; i++) {
        const nl = text.indexOf("\n", offset);
        if (nl < 0) break;
        offset = nl + 1;
      }
      return offset + ctx.cursorColumn;
    },
    gotoPosition: (line, column) => {
      ctx.cursorLine = line;
      ctx.cursorColumn = column;
    },
    setStatusMessage: (msg) => { ctx.statusMessage = msg; },
  });
  for (const [key, value] of navigationOps.entries()) {
    api.set(key, value);
  }

  // Add messages operations
  api.set('messages-buffer', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const buf = ctx.buffers.get('*Messages*');
    if (!buf) return Either.right(createString(''));
    const content = buf.getContent();
    if (content._tag === 'Left') return Either.right(createString(''));
    return Either.right(createString(content.right));
  });

  // SPEC-047: return the *daemon* lifecycle event log text (mirrors
  // messages-buffer). Lets users/agents read daemon connection events without
  // buffer switching.
  api.set('daemon-buffer', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const buf = ctx.buffers.get('*daemon*');
    if (!buf) return Either.right(createString(''));
    const content = buf.getContent();
    if (content._tag === 'Left') return Either.right(createString(''));
    return Either.right(createString(content.right));
  });

  // Format-string helper: %s -> string, %d -> integer, %% -> literal %
  function formatMessage(fmt: string, fmtArgs: TLispValue[]): string {
    if (!/%[sd%]/.test(fmt)) return fmt;
    let i = 0;
    return fmt.replace(/%([sd%])/g, (_match: string, spec: string): string => {
      if (spec === '%') return '%';
      const arg = fmtArgs[i++];
      if (!arg) return '';
      if (spec === 'd') return String(Math.floor(Number(arg.type === 'number' ? arg.value : 0)));
      return arg.type === 'string' ? String(arg.value) : arg.type === 'number' ? String(arg.value) : String(arg.value);
    });
  }

  api.set('message', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length === 0) return Either.left(createValidationError('FormatError', 'requires at least 1 argument'));
    let text: string;
    if (args[0]!.type === 'string' && /%[sd%]/.test(String(args[0]!.value))) {
      text = formatMessage(String(args[0]!.value), args.slice(1));
    } else {
      text = args.map(a => {
        switch (a.type) {
          case 'string': return String(a.value);
          case 'number': return String(a.value);
          case 'boolean': return String(a.value);
          default: return '';
        }
      }).join(' ');
    }
    ctx.statusMessage = text;
    if (ctx.logMessage) ctx.logMessage(text);
    return Either.right(createString(text));
  });

  // ── echo: set the status line WITHOUT logging (SPEC-055 two-tier split) ──
  // Use for deliberately-transient messages (which-key hints, prompts). The
  // message is NOT recorded in *Messages* — contrast with (message).
  api.set('echo', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length === 0) return Either.left(createValidationError('FormatError', 'echo requires at least 1 argument'));
    const text = args.map(a => {
      switch (a.type) {
        case 'string': return String(a.value);
        case 'number': return String(a.value);
        case 'boolean': return String(a.value);
        default: return '';
      }
    }).join(' ');
    ctx.statusMessage = text;
    // Deliberately do NOT call logMessage — echo-only by design.
    return Either.right(createString(text));
  });

  // ── log-program-run: record a structured program/test run (SPEC-055) ────
  // (log-program-run :category "test" :level "error" :text "..." [:exit N]
  //                   [:duration D] [:tail "..."] [:pid P] [:frame "id"])
  // OR positional: (log-program-run "test" "error" "text" [exit] [duration] [tail])
  // The positional form exists because T-Lisp's reader treats bare :keywords as
  // undefined symbols in arg position — so T-Lisp callers (e.g. trt-commands)
  // must use the positional form. Routes to the category buffer and mirrors
  // warn/error into *Messages*.
  api.set('log-program-run', (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Detect positional form: first arg is a string (not a :keyword symbol).
    const first = args[0];
    const isPositional = first && first.type === 'string';
    let category: string, level: string, text: string;
    let exitCode: number | undefined, durationMs: number | undefined, outputTail: string | undefined;
    let pid: number | undefined, frameId: string | undefined;

    if (isPositional) {
      // Positional: category level text [exit] [duration] [tail]
      category = String(first!.value);
      level = args[1]?.type === 'string' ? String(args[1]!.value).replace(/^:/, '') : 'info';
      text = args[2]?.type === 'string' ? String(args[2]!.value) : '';
      if (args[3]?.type === 'number') exitCode = Number(args[3]!.value);
      if (args[4]?.type === 'number') durationMs = Number(args[4]!.value);
      if (args[5]?.type === 'string') outputTail = String(args[5]!.value);
    } else {
      // Kwarg form (for TS/programmatic callers that can pass :keywords).
      const kwargs: Record<string, TLispValue> = {};
      for (let i = 0; i < args.length - 1; i += 2) {
        const key = args[i];
        if (key && key.type === 'symbol' && String(key.value).startsWith(':')) {
          kwargs[String(key.value).slice(1)] = args[i + 1]!;
        }
      }
      category = kwargs['category'] ? String(kwargs['category'].value) : 'test';
      level = kwargs['level'] ? String(kwargs['level'].value).replace(/^:/, '') : 'info';
      text = kwargs['text'] ? String(kwargs['text'].value) : '';
      if (kwargs['exit']?.type === 'number') exitCode = Number(kwargs['exit'].value);
      if (kwargs['duration']?.type === 'number') durationMs = Number(kwargs['duration'].value);
      if (kwargs['tail']?.type === 'string') outputTail = String(kwargs['tail'].value);
      if (kwargs['pid']?.type === 'number') pid = Number(kwargs['pid'].value);
      if (kwargs['frame']?.type === 'string') frameId = String(kwargs['frame'].value);
    }

    const validCats = ['shell', 'process', 'test', 'autosave'];
    if (!validCats.includes(category)) {
      return Either.left(createValidationError('FormatError', `log-program-run: invalid category ${category}`));
    }
    if (!text) return Either.left(createValidationError('FormatError', 'log-program-run requires text'));
    const entry: any = { level, text };
    if (exitCode !== undefined) entry.exitCode = exitCode;
    if (durationMs !== undefined) entry.durationMs = durationMs;
    if (outputTail !== undefined) entry.outputTail = outputTail;
    if (pid !== undefined) entry.pid = pid;
    if (frameId !== undefined) entry.frameId = frameId;
    ctx.logProgram?.(category as "shell" | "process" | "test" | "autosave", entry);
    return Either.right(createString(text));
  });

  api.set('log-message', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2) return Either.left(createValidationError('FormatError', 'log-message requires LEVEL and TEXT'));
    const levelArg = args[0]!;
    const rawLevel: string = levelArg.type === 'symbol' ? String(levelArg.value).replace(/^:/, '') : (levelArg.type === 'string' ? String(levelArg.value) : 'info');
    const text = args.slice(1).map(a => a.type === 'string' ? String(a.value) : String(a.value)).join(' ');
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLevels.includes(rawLevel)) return Either.left(createValidationError('FormatError', `Invalid log level: ${rawLevel}`));
    if (ctx.logMessage) ctx.logMessage(text, rawLevel);
    if (['info', 'warn', 'error'].includes(rawLevel)) ctx.statusMessage = text;
    return Either.right(createString(text));
  });

  api.set('message-log-level', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const log = ctx.getMessageLog?.();
    return Either.right(createString(log?.minLevel ?? 'info'));
  });

  api.set('set-message-log-level', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'requires a log level'));
    const levelArg = args[0]!;
    const level: string = levelArg.type === 'symbol' ? String(levelArg.value).replace(/^:/, '') : (levelArg.type === 'string' ? String(levelArg.value) : 'info');
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLevels.includes(level)) return Either.left(createValidationError('FormatError', `Invalid log level: ${level}`));
    const log = ctx.getMessageLog?.();
    if (log) log.minLevel = level as LogLevel;
    return Either.right(createString(level));
  });

  api.set('message-log-max', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const log = ctx.getMessageLog?.();
    return Either.right(createNumber(log?.maxSize ?? 1000));
  });

  api.set('set-message-log-max', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'requires a number'));
    const n: number = args[0]!.type === 'number' ? Number(args[0]!.value) : 0;
    const log = ctx.getMessageLog?.();
    if (log) log.maxSize = n;
    return Either.right(createNumber(n));
  });

  api.set('clear-messages', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const log = ctx.getMessageLog?.();
    if (log) {
      log.clear();
      ctx.buffers.set('*Messages*', FunctionalTextBufferImpl.create(''));
    }
    return Either.right(createNil());
  });

  // ── log-query: structured query across all categories (SPEC-055) ──────
  // (log-query [:category "shell"] [:view "messages"] [:level "error"] [:last 10])
  // Returns a list of plists: ((text "..." level "error" category "shell" ts N ...))
  api.set('log-query', (args: TLispValue[]): Either<AppError, TLispValue> => {
    const kwargs: Record<string, TLispValue> = {};
    for (let i = 0; i < args.length - 1; i += 2) {
      const key = args[i];
      if (key && key.type === 'symbol' && String(key.value).startsWith(':')) {
        kwargs[String(key.value).slice(1)] = args[i + 1]!;
      }
    }
    const store = ctx.getUnifiedLog?.();
    if (!store) return Either.right(createList([]));
    const entries = store.getEntries({
      category: kwargs['category'] ? String(kwargs['category'].value) as LogCategory : undefined,
      view: kwargs['view'] ? String(kwargs['view'].value) as LogView : undefined,
      level: kwargs['level'] ? String(kwargs['level'].value).replace(/^:/, '') as LogLevel : undefined,
      last: kwargs['last'] && kwargs['last'].type === 'number' ? Number(kwargs['last'].value) : undefined,
    });
    const plists = entries.map((e: any) => {
      const pairs: TLispValue[] = [
        createString('text'), createString(e.text),
        createString('level'), createString(e.level),
        createString('category'), createString(e.category),
        createString('ts'), createNumber(e.ts),
      ];
      if (e.exitCode !== undefined) { pairs.push(createString('exitCode'), createNumber(e.exitCode)); }
      if (e.durationMs !== undefined) { pairs.push(createString('durationMs'), createNumber(e.durationMs)); }
      if (e.command) pairs.push(createString('command'), createString(e.command));
      if (e.frameId) pairs.push(createString('frameId'), createString(e.frameId));
      return createList(pairs);
    });
    return Either.right(createList(plists));
  });

  // ── observability-buffer: switch to a category buffer by name (SPEC-055) ─
  // (observability-buffer "shell") → *Shell Output*; "process" → *Async Output*;
  // "test" → *Tests*; "daemon" → *daemon*; "messages" → *Messages*.
  api.set('observability-buffer', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1 || args[0]!.type !== 'string') {
      return Either.left(createValidationError('FormatError', 'observability-buffer requires a category name string'));
    }
    const cat = String(args[0]!.value);
    const map: Record<string, string> = {
      messages: '*Messages*', daemon: '*daemon*',
      shell: '*Shell Output*', process: '*Async Output*', test: '*Tests*',
    };
    const bufName = map[cat];
    if (!bufName) return Either.left(createValidationError('FormatError', `observability-buffer: unknown category ${cat}`));
    const switcher = api.get('buffer-switch');
    if (switcher) return switcher([createString(bufName)]);
    return Either.right(createString(bufName));
  });

  api.set('last-command', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    return Either.right(createString(ctx.lastCommand ?? ''));
  });

  // Fold operations
  const getBufferLine = (line: number): string => {
    const buf = ctx.currentBuffer;
    if (!buf) return '';
    const result = buf.getLine(line);
    return Either.isLeft(result) ? '' : result.right;
  };
  const getBufferLineCount = (): number => {
    const buf = ctx.currentBuffer;
    if (!buf) return 0;
    const result = buf.getLineCount();
    return Either.isLeft(result) ? 0 : result.right;
  };

  api.set('fold-toggle', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'fold-toggle requires a line number'));
    const line = Number(args[0]!.value);
    const headingRanges = findHeadingRanges(getBufferLine, getBufferLineCount());
    const editorState = { foldRanges: ctx.foldRanges };
    const result = foldToggle(editorState, line, headingRanges);
    ctx.foldRanges = result.foldRanges ? new Map(result.foldRanges) : undefined;
    return Either.right(createNil());
  });

  api.set('fold-open', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'fold-open requires a line number'));
    const line = Number(args[0]!.value);
    const editorState = { foldRanges: ctx.foldRanges };
    const result = foldOpen(editorState, line);
    ctx.foldRanges = result.foldRanges ? new Map(result.foldRanges) : undefined;
    return Either.right(createNil());
  });

  api.set('fold-close', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2) return Either.left(createValidationError('FormatError', 'fold-close requires start and end line numbers'));
    const startLine = Number(args[0]!.value);
    const endLine = Number(args[1]!.value);
    const editorState = { foldRanges: ctx.foldRanges };
    const result = foldClose(editorState, startLine, endLine);
    ctx.foldRanges = result.foldRanges ? new Map(result.foldRanges) : undefined;
    return Either.right(createNil());
  });

  api.set('fold-close-all', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const headingRanges = findHeadingRanges(getBufferLine, getBufferLineCount());
    const editorState = { foldRanges: ctx.foldRanges };
    const result = foldCloseAll(editorState, headingRanges);
    ctx.foldRanges = result.foldRanges ? new Map(result.foldRanges) : undefined;
    return Either.right(createNil());
  });

  api.set('fold-open-all', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const editorState = { foldRanges: ctx.foldRanges };
    const result = foldOpenAll(editorState);
    ctx.foldRanges = result.foldRanges ? new Map(result.foldRanges) : undefined;
    return Either.right(createNil());
  });

  api.set('fold-by-level', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'fold-by-level requires a max level'));
    const maxLevel = Number(args[0]!.value);
    const headingRanges = findHeadingRanges(getBufferLine, getBufferLineCount());
    const editorState = { foldRanges: ctx.foldRanges };
    const result = foldByLevel(editorState, maxLevel, headingRanges);
    ctx.foldRanges = result.foldRanges ? new Map(result.foldRanges) : undefined;
    return Either.right(createNil());
  });

  api.set('fold-is-collapsed', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'fold-is-collapsed requires a line number'));
    const line = Number(args[0]!.value);
    const editorState = { foldRanges: ctx.foldRanges };
    return Either.right(createBoolean(foldIsCollapsed(editorState, line)));
  });

  api.set('fold-get-ranges', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const editorState = { foldRanges: ctx.foldRanges };
    const ranges = foldGetRanges(editorState);
    return Either.right(createList(ranges.map(r =>
      createList([createNumber(r.start), createNumber(r.end)])
    )));
  });

  api.set('find-heading-ranges', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const headingRanges = findHeadingRanges(getBufferLine, getBufferLineCount());
    return Either.right(createList(headingRanges.map(r =>
      createList([createNumber(r.start), createNumber(r.end), createNumber(r.level)])
    )));
  });

  // ── Regex match data storage ──────────────────────────────────────────
  // Module-level state for the last string-match result.
  let lastMatchResult: RegExpExecArray | null = null;
  let lastMatchString: string | null = null;

  // string-match: (regex string) -> match index or nil
  api.set('string-match', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2) return Either.left(createValidationError('FormatError', 'string-match requires 2 arguments: regex, string'));
    if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'string-match regex must be a string'));
    if (args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'string-match string must be a string'));

    const pattern = String(args[0]!.value);
    const str = String(args[1]!.value);
    try {
      const re = new RegExp(pattern);
      const m = re.exec(str);
      if (!m) {
        lastMatchResult = null;
        lastMatchString = null;
        return Either.right(createNil());
      }
      lastMatchResult = m;
      lastMatchString = str;
      return Either.right(createNumber(m.index));
    } catch (e) {
      return Either.left(createValidationError('FormatError', `Invalid regex: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  // match-string: (n string?) -> Nth capture group from last match
  api.set('match-string', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'match-string requires at least 1 argument: n'));
    if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'match-string n must be a number'));

    const n = Number(args[0]!.value);
    if (!lastMatchResult) return Either.right(createNil());

    const group = lastMatchResult[n];
    if (group === undefined) return Either.right(createNil());
    return Either.right(createString(group));
  });

  // match-beginning: (n) -> start position of Nth capture group
  api.set('match-beginning', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'match-beginning requires 1 argument: n'));
    if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'match-beginning n must be a number'));

    const n = Number(args[0]!.value);
    if (!lastMatchResult) return Either.right(createNil());
    // index is the match-beginning of group 0; for groups, use .index of the group
    if (n === 0) return Either.right(createNumber(lastMatchResult.index));
    // For capture groups, compute offset from the full match
    const fullMatch = lastMatchResult[0];
    if (!fullMatch) return Either.right(createNil());
    const group = lastMatchResult[n];
    if (group === undefined) return Either.right(createNil());
    const groupIndex = lastMatchResult.index + fullMatch.indexOf(group, [...lastMatchResult.slice(1, n)].reduce((acc, g) => acc + (g?.length ?? 0), 0));
    return Either.right(createNumber(groupIndex));
  });

  // match-end: (n) -> end position of Nth capture group
  api.set('match-end', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'match-end requires 1 argument: n'));
    if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'match-end n must be a number'));

    const n = Number(args[0]!.value);
    if (!lastMatchResult) return Either.right(createNil());
    if (n === 0) return Either.right(createNumber(lastMatchResult.index + lastMatchResult[0].length));
    const group = lastMatchResult[n];
    if (group === undefined) return Either.right(createNil());
    // Compute end from match-beginning of this group + group length
    const fullMatch = lastMatchResult[0];
    if (!fullMatch) return Either.right(createNil());
    const groupOffset = [...lastMatchResult.slice(1, n)].reduce((acc, g) => acc + (g?.length ?? 0), 0);
    const groupStart = lastMatchResult.index + fullMatch.indexOf(group, groupOffset);
    return Either.right(createNumber(groupStart + group.length));
  });

  // ── Alias: buffer-get-line → buffer-line ──────────────────────────────
  api.set('buffer-get-line', api.get('buffer-line')!);

  // ── format: (fmt args...) ─────────────────────────────────────────────
  api.set('format', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'format requires at least 1 argument'));
    if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'format first argument must be a string'));
    const fmt = String(args[0]!.value);
    const fmtArgs = args.slice(1);
    const result = formatMessage(fmt, fmtArgs);
    return Either.right(createString(result));
  });

  // ── make-string: (n char) ─────────────────────────────────────────────
  api.set('make-string', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2) return Either.left(createValidationError('FormatError', 'make-string requires 2 arguments: n, char'));
    if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'make-string n must be a number'));

    const n = Math.max(0, Math.floor(Number(args[0]!.value)));
    const charArg = args[1]!;
    let ch = ' ';
    if (charArg.type === 'string') {
      ch = String(charArg.value).slice(0, 1) || ' ';
    } else if (charArg.type === 'number') {
      ch = String.fromCharCode(Number(charArg.value));
    }
    return Either.right(createString(ch.repeat(n)));
  });

  // ── make-vector: (n val) ──────────────────────────────────────────────
  api.set('make-vector', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2) return Either.left(createValidationError('FormatError', 'make-vector requires 2 arguments: n, val'));
    if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'make-vector n must be a number'));

    const n = Math.max(0, Math.floor(Number(args[0]!.value)));
    const val = args[1]!;
    return Either.right(createList(Array(n).fill(val)));
  });

  // ── aref: (array n) ───────────────────────────────────────────────────
  api.set('aref', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2) return Either.left(createValidationError('FormatError', 'aref requires 2 arguments: array, n'));
    const arr = args[0]!;
    if (args[1]!.type !== 'number') return Either.left(createValidationError('TypeError', 'aref index must be a number'));

    const idx = Math.floor(Number(args[1]!.value));
    if (arr.type === 'list') {
      const items = arr.value as TLispValue[];
      if (idx < 0 || idx >= items.length) return Either.right(createNil());
      return Either.right(items[idx]!);
    }
    if (arr.type === 'string') {
      const str = String(arr.value);
      if (idx < 0 || idx >= str.length) return Either.right(createNil());
      return Either.right(createString(str[idx]!));
    }
    return Either.left(createValidationError('TypeError', 'aref first argument must be a list or string'));
  });

  // ── aset: (array n val) ───────────────────────────────────────────────
  api.set('aset', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 3) return Either.left(createValidationError('FormatError', 'aset requires 3 arguments: array, n, val'));
    const arr = args[0]!;
    if (args[1]!.type !== 'number') return Either.left(createValidationError('TypeError', 'aset index must be a number'));

    const idx = Math.floor(Number(args[1]!.value));
    const val = args[2]!;
    if (arr.type === 'list') {
      const items = arr.value as TLispValue[];
      if (idx < 0 || idx >= items.length) return Either.left(createValidationError('RangeError', `aset index ${idx} out of range`));
      items[idx] = val;
      return Either.right(val);
    }
    return Either.left(createValidationError('TypeError', 'aset first argument must be a list'));
  });

  // ── downcase: alias for string-downcase ────────────────────────────────
  api.set('downcase', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'downcase requires 1 argument'));
    if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'downcase requires a string'));
    return Either.right(createString(String(args[0]!.value).toLowerCase()));
  });

  // ── replace-regexp-in-string: (regex replacement string) ──────────────
  api.set('replace-regexp-in-string', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 3) return Either.left(createValidationError('FormatError', 'replace-regexp-in-string requires 3 arguments: regex, replacement, string'));
    if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'regex must be a string'));
    if (args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'replacement must be a string'));
    if (args[2]!.type !== 'string') return Either.left(createValidationError('TypeError', 'string must be a string'));

    const pattern = String(args[0]!.value);
    const replacement = String(args[1]!.value);
    const str = String(args[2]!.value);
    try {
      const re = new RegExp(pattern, 'g');
      return Either.right(createString(str.replace(re, replacement)));
    } catch (e) {
      return Either.left(createValidationError('FormatError', `Invalid regex: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  // ── read-string: alias for entering minibuffer prompt ──────────────────
  api.set('read-string', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'read-string requires 1 argument: prompt'));
    if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'read-string prompt must be a string'));
    // For now, return empty string. Full implementation requires async minibuffer support.
    ctx.statusMessage = String(args[0]!.value);
    return Either.right(createString(''));
  });

  // ── shell-command: execute a shell command ─────────────────────────────
  api.set('shell-command', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'shell-command requires 1 argument: command'));
    if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'shell-command requires a string'));
    try {
      const cmd = String(args[0]!.value);
      const t0 = Date.now();
      const output = Bun.spawnSync(['sh', '-c', cmd], { stdout: 'pipe', stderr: 'pipe', timeout: 30_000 });
      const stdout = output.stdout ? new TextDecoder().decode(output.stdout) : '';
      // SPEC-055: shell-command used to discard stderr + exit code. Capture
      // them for the observability log even though the return value stays
      // stdout-only for backward compatibility.
      const stderr = output.stderr ? new TextDecoder().decode(output.stderr) : '';
      const exitCode = output.exitCode ?? 0;
      ctx.logProgram?.('shell', {
        level: exitCode === 0 ? 'info' : 'error',
        text: cmd,
        exitCode,
        durationMs: Date.now() - t0,
        outputTail: capTail(`${stdout}\n${stderr}`),
      });
      return Either.right(createString(stdout));
    } catch (e) {
      return Either.left(createValidationError('FormatError', `shell-command failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  // ── shell-exec: execute command, return structured result ───────────
  api.set('shell-exec', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'shell-exec requires 1 argument: command'));
    if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'shell-exec requires a string'));
    try {
      const cmd = String(args[0]!.value);
      const t0 = Date.now();
      const output = Bun.spawnSync(['sh', '-c', cmd], { stdout: 'pipe', stderr: 'pipe', timeout: 30_000 });
      const stdout = output.stdout ? new TextDecoder().decode(output.stdout).trim() : '';
      const stderr = output.stderr ? new TextDecoder().decode(output.stderr).trim() : '';
      const exitCode = output.exitCode ?? 1;
      ctx.logProgram?.('shell', {
        level: exitCode === 0 ? 'info' : 'error',
        text: cmd,
        exitCode,
        durationMs: Date.now() - t0,
        outputTail: capTail(`${stdout}\n${stderr}`),
      });
      return Either.right(createList([
        createString(stdout),
        createString(stderr),
        createNumber(exitCode),
      ]));
    } catch (e) {
      return Either.left(createValidationError('FormatError', `shell-exec failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  // ── file-glob: list files matching glob pattern ──────────────────────
  api.set('file-glob', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'file-glob requires 1 argument: pattern'));
    if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'pattern must be string'));
    try {
      const pattern = String(args[0]!.value);
      const glob = new Bun.Glob(pattern);
      const files = [...glob.scanSync({ dot: false })];
      return Either.right(createList(files.map(f => createString(f))));
    } catch (e) {
      return Either.left(createValidationError('FormatError', `file-glob failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  // ── file-rename: rename a file ──────────────────────────────────────
  api.set('file-rename', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2) return Either.left(createValidationError('FormatError', 'file-rename requires 2 arguments: old, new'));
    if (args[0]!.type !== 'string' || args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'both arguments must be strings'));
    try {
      renameSync(String(args[0]!.value), String(args[1]!.value));
      return Either.right(createNil());
    } catch (e) {
      return Either.left(createValidationError('FormatError', `file-rename failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  // ── cache-get / cache-set: persistent K/V store ──────────────────────
  const kvCache: Map<string, string> = new Map();

  api.set('cache-get', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'cache-get requires 1 argument: key'));
    if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'key must be string'));
    const val = kvCache.get(String(args[0]!.value));
    return Either.right(val !== undefined ? createString(val) : createNil());
  });

  api.set('cache-set', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2) return Either.left(createValidationError('FormatError', 'cache-set requires 2 arguments: key, value'));
    if (args[0]!.type !== 'string' || args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'both arguments must be strings'));
    kvCache.set(String(args[0]!.value), String(args[1]!.value));
    return Either.right(createNil());
  });

  // ── cache-save / cache-load: persist the K/V cache to disk ──────────
  const cacheFilePath = `${process.env.HOME ?? '~'}/.config/tmax/backlink-cache.json`;

  api.set('cache-save', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    try {
      const obj: Record<string, string> = {};
      kvCache.forEach((v, k) => { obj[k] = v; });
      writeFileSync(cacheFilePath, JSON.stringify(obj, null, 2));
      return Either.right(createString('saved'));
    } catch (e) {
      return Either.left(createValidationError('FormatError', `cache-save failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  api.set('cache-load', (_args: TLispValue[]): Either<AppError, TLispValue> => {
    try {
      if (!existsSync(cacheFilePath)) return Either.right(createString('no-cache'));
      const data = JSON.parse(readFileSync(cacheFilePath, 'utf-8')) as Record<string, string>;
      Object.entries(data).forEach(([k, v]) => kvCache.set(k, v));
      return Either.right(createString('loaded'));
    } catch (e) {
      return Either.left(createValidationError('FormatError', `cache-load failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  // ── make-process: spawn subprocess with streaming output ─────────────
  const processTable: Map<number, { process: any; stdin: any }> = new Map();
  let nextProcessId = 1;

  api.set('make-process', (args: TLispValue[]): Either<AppError, TLispValue> => {
    // Args: keyword pairs — :command '("echo" "hello") :filter 'my-filter :sentinel 'my-sentinel
    const kwargs: Record<string, TLispValue> = {};
    for (let i = 0; i < args.length - 1; i += 2) {
      const key = args[i];
      if (key && key.type === 'symbol' && String(key.value).startsWith(':')) {
        kwargs[String(key.value).slice(1)] = args[i + 1]!;
      }
    }

    const commandArg = kwargs['command'];
    const filterFn = kwargs['filter'];
    const sentinelFn = kwargs['sentinel'];

    if (!commandArg) return Either.left(createValidationError('FormatError', 'make-process requires :command argument'));

    let command: string[];
    if (commandArg.type === 'list') {
      command = (commandArg.value as TLispValue[]).map(a => String(a.value));
    } else if (commandArg.type === 'string') {
      command = ['/bin/sh', '-c', String(commandArg.value)];
    } else {
      return Either.left(createValidationError('TypeError', ':command must be a list or string'));
    }

    try {
      const proc = Bun.spawn(command, {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'pipe',
      });

      const pid = nextProcessId++;
      processTable.set(pid, { process: proc, stdin: proc.stdin });

      const filterName = filterFn ? String(filterFn.value) : null;
      const sentinelName = sentinelFn ? String(sentinelFn.value) : null;
      const spawnTime = Date.now();
      const cmdSummary = command.join(' ');
      // SPEC-055: record process spawn. outputTail is best-effort — stdout is
      // owned by the caller's :filter; we accumulate a capped tail for the log.
      let tailBuf = '';
      ctx.logProgram?.('process', {
        level: 'info', text: `▶ pid ${pid} started: ${cmdSummary}`, pid,
      });

      // Stream stdout to filter function (and accumulate a tail for the log)
      const readable = proc.stdout;
      (async () => {
        const decoder = new TextDecoder();
        const reader = readable.getReader();
        // SPEC-055: also read stderr (previously piped but never read — a bug).
        const errReader = proc.stderr?.getReader();
        const errLoop = (async () => {
          if (!errReader) return;
          try {
            while (true) {
              const { done, value } = await errReader.read();
              if (done) break;
              tailBuf += decoder.decode(value, { stream: true });
            }
          } catch { /* stderr closed */ }
        })();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            tailBuf += text;
            if (filterName && ctx.evalTlisp) {
              ctx.evalTlisp(`(${filterName} ${pid} ${JSON.stringify(text)})`);
            }
          }
        } catch { /* stream closed */ }
        await errLoop;

        await proc.exited;
        const exitCode = proc.exitCode ?? 0;
        // SPEC-055: record process exit (error level on non-zero → mirrors).
        ctx.logProgram?.('process', {
          level: exitCode === 0 ? 'info' : 'error',
          text: `◀ pid ${pid} exited: ${exitCode}`,
          pid, exitCode, durationMs: Date.now() - spawnTime,
          outputTail: capTail(tailBuf),
        });
        if (sentinelName && ctx.evalTlisp) {
          ctx.evalTlisp(`(${sentinelName} ${pid} ${exitCode})`);
        }
        processTable.delete(pid);
      })();

      return Either.right(createNumber(pid));
    } catch (e) {
      return Either.left(createValidationError('FormatError', `make-process failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  // ── process-write: write to subprocess stdin ────────────────────────
  api.set('process-write', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2) return Either.left(createValidationError('FormatError', 'process-write requires 2 arguments: pid, data'));
    if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'pid must be a number'));
    if (args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'data must be a string'));

    const pid = Number(args[0]!.value);
    const entry = processTable.get(pid);
    if (!entry) return Either.left(createValidationError('FormatError', `No process with pid ${pid}`));

    try {
      entry.stdin.write(String(args[1]!.value));
      return Either.right(createNil());
    } catch (e) {
      return Either.left(createValidationError('FormatError', `process-write failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  // ── signal: send signal to running process ──────────────────────────
  api.set('signal', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2) return Either.left(createValidationError('FormatError', 'signal requires 2 arguments: pid, signal-name'));
    if (args[0]!.type !== 'number') return Either.left(createValidationError('TypeError', 'pid must be a number'));
    if (args[1]!.type !== 'string') return Either.left(createValidationError('TypeError', 'signal-name must be a string'));

    const pid = Number(args[0]!.value);
    const sigName = String(args[1]!.value);
    const entry = processTable.get(pid);
    if (!entry) return Either.left(createValidationError('FormatError', `No process with pid ${pid}`));

    try {
      entry.process.kill(sigName as NodeJS.Signals);
      return Either.right(createNil());
    } catch (e) {
      return Either.left(createValidationError('FormatError', `signal failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  // ── http-request: async HTTP with streaming response ────────────────
  api.set('http-request', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'http-request requires at least 1 argument: url'));
    if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'url must be a string'));

    const url = String(args[0]!.value);
    const kwargs: Record<string, TLispValue> = {};
    for (let i = 1; i < args.length - 1; i += 2) {
      const key = args[i];
      if (key && key.type === 'symbol' && String(key.value).startsWith(':')) {
        kwargs[String(key.value).slice(1)] = args[i + 1]!;
      }
    }

    const method = kwargs['method'] ? String(kwargs['method'].value) : 'GET';
    const body = kwargs['body'] ? String(kwargs['body'].value) : undefined;
    const filterFn = kwargs['filter'] ? String(kwargs['filter'].value) : null;
    const headersVal = kwargs['headers'];

    const headers: Record<string, string> = {};
    if (headersVal && headersVal.type === 'list') {
      for (const pair of (headersVal.value as TLispValue[])) {
        if (pair.type === 'list') {
          const elems = pair.value as TLispValue[];
          if (elems.length === 2) {
            headers[String(elems[0]!.value)] = String(elems[1]!.value);
          }
        }
      }
    }

    const requestId = nextProcessId++; // reuse counter for unique IDs

    (async () => {
      try {
        const response = await fetch(url, { method, body, headers });
        const status = response.status;
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { responseHeaders[k] = v; });

        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            if (filterFn && ctx.evalTlisp) {
              ctx.evalTlisp(`(${filterFn} ${requestId} ${JSON.stringify(chunk)})`);
            }
          }
        }

        // Return final status/headers
        if (ctx.evalTlisp) {
          const headersStr = JSON.stringify(responseHeaders);
          ctx.evalTlisp(`(fikra-http-complete ${requestId} ${status} ${JSON.stringify(headersStr)})`);
        }
      } catch (e) {
        if (ctx.evalTlisp) {
          ctx.evalTlisp(`(fikra-http-complete ${requestId} 0 ${JSON.stringify(e instanceof Error ? e.message : String(e))})`);
        }
      }
    })();

    return Either.right(createNumber(requestId));
  });

  // ── json-read-from-string: parse JSON into T-Lisp data ──────────────
  api.set('json-read-from-string', (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1) return Either.left(createValidationError('FormatError', 'json-read-from-string requires 1 argument: string'));
    if (args[0]!.type !== 'string') return Either.left(createValidationError('TypeError', 'argument must be a string'));

    function toTlisp(val: any): TLispValue {
      if (val === null || val === undefined) return createNil();
      if (typeof val === 'boolean') return createBoolean(val);
      if (typeof val === 'number') return createNumber(val);
      if (typeof val === 'string') return createString(val);
      if (Array.isArray(val)) return createList(val.map(toTlisp));
      if (typeof val === 'object') {
        // Convert object to alist: list of (key . value) pairs
        const pairs = Object.entries(val).map(([k, v]) => {
          return createList([createString(k), toTlisp(v)]);
        });
        return createList(pairs);
      }
      return createNil();
    }

    try {
      const parsed = JSON.parse(String(args[0]!.value));
      return Either.right(toTlisp(parsed));
    } catch {
      return Either.right(createNil());
    }
  });

  // ── SPEC-056: browse-url primitives ──────────────────────────────────
  // ts-open-external: argv-array browser dispatch (injection-safe).
  // Buffer scanning helpers + fs/git context resolvers live alongside.
  const browseUrlDeps: BrowseUrlPrimitiveDeps = {
    access: modelAccess,
    getCurrentBuffer: () => ctx.currentBuffer,
    getCurrentBufferName: () => ctx.currentFilename ?? "*scratch*",
    getCurrentBufferPath: () => ctx.currentFilename,
    spawn: (argv: string[]) => {
      try {
        const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
        return { pid: proc.pid };
      } catch (e) {
        return { error: e instanceof Error ? e : new Error(String(e)) };
      }
    },
  };
  for (const [key, value] of createBrowseUrlOps(browseUrlDeps).entries()) {
    api.set(key, value);
  }
  api.set("ts-open-external", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError("ConstraintViolation", "ts-open-external requires 1 argument: url"));
    }
    if (args[0]!.type !== "string") {
      return Either.left(createValidationError("TypeError", "ts-open-external requires a string url"));
    }
    return tsOpenExternalOutcome(String(args[0]!.value), browseUrlDeps);
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
  const access: EditorModelAccess = {
    getModel: () => editor.getModel(),
    applyModel: (m) => { editor.applyModel(m); },
  };
  return createCountOps(access);
}
