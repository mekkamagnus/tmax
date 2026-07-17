/**
 * @file editor.ts
 * @description Core editor implementation with T-Lisp extensibility for React UI
 * This class manages the editor state and logic but delegates rendering to React components
 */

import { TLispInterpreterImpl } from "../tlisp/interpreter.ts";
import { FileSystemImpl } from "../core/filesystem.ts";
import { createEditorAPI } from "./tlisp-api.ts";
import type { EditorAPIContext } from "./runtime/editor-api-context.ts";
import { createEditorRuntimeCaches } from "./runtime/caches.ts";
import type { EditorRuntimeCaches } from "./runtime/caches.ts";
import type { EditorState, FunctionalTextBuffer, Window, HighlightSpan, MinibufferRenderView, WorkspaceState, BufferMetadata } from "../core/types.ts";
import { createString, createList, createNil, createNumber, createBoolean, createHashmap, createPromise } from "../tlisp/values.ts";
import type { TerminalIO, FileSystem } from "../core/types.ts";
import type { TLispEnvironment, TLispValue, TLispFunctionImpl } from "../tlisp/types.ts";
import type { TLispFunction } from "../tlisp/types.ts";
import { Either } from "../utils/task-either.ts";

/**
 * Fallback visible-line count used by {@link Editor.recomputeHighlights} when
 * computing daemon-side syntax spans. The daemon does not track the client's
 * terminal height (the TUI client computes its own spans), so this default is
 * used to bound the re-tokenization window.
 */
const HIGHLIGHT_RECOMPUTE_VIEWPORT_LINES = 50;
import { renderDiagnostic } from "../tlisp/diagnostic-renderer.ts";
import { FunctionalTextBufferImpl } from "../core/buffer.ts";
import { MessageLog, type LogLevel } from "./message-log.ts";
import { Log, ViewBoundLog } from "./log-store.ts";
import { LoggingRuntime } from "./runtime/logging-runtime.ts";
import { PluginRuntime, type PluginLoadResult } from "./runtime/plugin-runtime.ts";
import { BindingRuntime } from "./runtime/binding-runtime.ts";
import { WorkspaceRuntime } from "./runtime/workspace-runtime.ts";
import { CommandRuntime, type CommandOutcome } from "./runtime/command-runtime.ts";
import type { LogEntry, LogCategory } from "./log-entry.ts";
import { handleNormalMode } from "./handlers/normal-handler.ts";
import { handleInsertMode } from "./handlers/insert-handler.ts";
import { handleVisualMode } from "./handlers/visual-handler.ts";
import { handleCommandMode } from "./handlers/command-handler.ts";
import { handleMxMode } from "./handlers/mx-handler.ts";
import { handleReplaceMode } from "./handlers/replace-handler.ts";
import { LSPClient } from "../lsp/client.ts";
import { createWindowOps } from "./api/window-ops.ts";
import { createTabOps } from "./api/tab-ops.ts";
import { log } from "../utils/logger.ts";
import { KeymapSync } from "./keymap-sync.ts";
import { createKeymapOps } from "./api/keymap-ops.ts";
import { createEditorSession, createEditorSessionState } from "./functional/domain-state.ts";
import type { EditorSession } from "./functional/domain-state.ts";
import {
  type BufferModeState,
  type MinorModeConfig,
  type AutoModeRule,
  getOrCreateModeState,
  applyGlobalMinorModes,
  normalizeExtension,
} from "./mode-state.ts";
import { cloneJsonValue, deserializeTlispValue, serializeTlispValue } from "../tlisp/serialization.ts";
import { createModuleLoader } from "../tlisp/module-loader.ts";
import type { ModuleExportRecord } from "../tlisp/module-registry.ts";
import { createWhichKeyState, DEFAULT_WHICH_KEY_TIMEOUT, type WhichKeyHandle } from "./utils/which-key-state.ts";
import type { EditorModel, Msg, Cmd, EditorRuntime } from "./functional/index.ts";
import { initialModel, modelToEditorState, editorStateToModelPatch, update } from "./functional/index.ts";
import type { AppError } from "../error/types.ts";
import { createValidationError } from "../error/types.ts";

/**
 * Key mapping for editor commands
 */
// CHORE-44 Change 6: KeyMapping + resolveMapping moved to key-resolution.ts (AC6.1).
export type { KeyMapping } from "./key-resolution.ts";
export { resolveMapping } from "./key-resolution.ts";
import type { KeyMapping } from "./key-resolution.ts";

/**
 * Core editor implementation
 */
export class Editor {
  private model: EditorModel;
  // CHORE-44 Change 1: per-editor session accessors (kill ring, registers,
  // visual, macros, …) bound over `this.model.session`. Set in the constructor
  // immediately after `this.model` is assigned so concurrent editors are
  // independent and `EditorModel` is the single state container.
  private session!: EditorSession;
  // CHORE-44 Change 1: per-editor AST/parse caches (not shared, not serialized).
  private caches: EditorRuntimeCaches = createEditorRuntimeCaches();
  private buffers: Map<string, FunctionalTextBufferImpl> = new Map();
  private interpreter: TLispInterpreterImpl;
  private keyMappings: Map<string, KeyMapping[]>;
  private running: boolean = false;
  private coreBindingsLoaded: boolean = false;
  // Notified after handleKey mutates editor state (e.g. socket-driven
  // `tmaxclient --keys`), so attached frontends that don't see the local stdin
  // key can still re-render. See main.tsx subscription.
  private stateChangeListeners: Array<() => void> = [];
  private terminal: TerminalIO;
  private filesystem: FileSystem;
  // CHORE-44 Change 3: logging (unified Log store + log path + message ring +
  // log→buffer rendering) is delegated to the LoggingRuntime collaborator.
  private logging: LoggingRuntime;
  // CHORE-44 Change 3: plugin parsing/loading + macro persistence delegated.
  private pluginRuntime: PluginRuntime = new PluginRuntime();
  // CHORE-44 Change 3: binding-file loading + core/fallback/init-file policy
  // delegated. Constructed in the constructor (needs `this` for the
  // core-bindings-loaded flag and the line-numbers post-load hook).
  private bindingRuntime!: BindingRuntime;
  // CHORE-44 Change 3: workspace serialization/reconciliation delegated.
  private workspaceRuntime: WorkspaceRuntime = new WorkspaceRuntime();
  // CHORE-44 Change 3: command queue / effect drain delegated. Constructed in
  // the constructor (needs `this.getRuntime` + `this.applyUpdate`).
  private commandRuntime!: CommandRuntime;
  spacePressed: boolean = false;  // Track space key for SPC ; sequence (US-1.10.1)
  private windowPrefixPressed: boolean = false;  // Track C-w prefix for window commands (SPEC-004)
  private lspClient: LSPClient;  // LSP client for language server integration (US-3.1.1)
  keymapSync: KeymapSync;  // Bridge layer for T-Lisp keymap integration (US-0.4.1)
  private currentInitFile: string = '';  // Path to current init file (SPEC-025)
  // Buffer-local mode state (SPEC-003)
  private bufferModeStates: Map<string, BufferModeState> = new Map();
  private minorModeRegistry: Map<string, MinorModeConfig> = new Map();
  private globalizedMinorModes: Set<string> = new Set();
  // CHORE-44 Change 1: auto-mode rules now live on `this.model.session.majorMode.autoModeRules`
  // (per-editor, killing the prior module-global leak). The getter below delegates.
  // loadPaths now lives on this.model (CHORE-39 Phase 4).
  // currentModuleName now lives on this.model (CHORE-39 Phase 4).
  private bufferMetadata: Map<string, { filename?: string; modified: boolean; recency: number }> = new Map();
  private bufferRecency: number = 0;
  private whichKeyHandle: import("./utils/which-key-state.ts").WhichKeyHandle;
  private currentWorkspace?: WorkspaceState;

  /**
   * Create a new editor instance
   * @param terminal - Terminal interface (may be unused in React UI)
   * @param filesystem - File system interface
   * @param initFilePath - Optional path to custom init file (SPEC-025)
   */
  constructor(terminal: TerminalIO, filesystem: FileSystem, initFilePath?: string) {
    const editorLog = log.module('editor').fn('constructor');
    const initId = editorLog.startOperation('editor-construction');

    editorLog.info('Initializing editor instance', { correlationId: initId });

    this.terminal = terminal;
    this.filesystem = filesystem;

    // Store init file path for later use (SPEC-025)
    if (initFilePath) {
      this.currentInitFile = initFilePath;
    }

    this.model = {
      cursorPosition: { line: 0, column: 0 },
      mode: "normal",
      statusMessage: "Welcome to tmax",
      viewportTop: 0,
      viewportLeft: 0,
      config: {
        theme: 'default',
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        relativeLineNumbers: false,
        wordWrap: false
      },
      commandLine: "",
      mxCommand: "",
      currentFilename: undefined,
      buffers: this.buffers,
      cursorFocus: 'buffer',
      // Which-key popup state (US-1.10.3)
      whichKeyActive: false,
      whichKeyPrefix: "",
      whichKeyBindings: [],
      whichKeyTimeout: 1000,
      // LSP diagnostics state (US-3.1.2)
      lspDiagnostics: [],
      // Window management (US-3.2.1)
      windows: [],
      currentWindowIndex: 0,
      tabs: [],
      currentTabIndex: 0,
      minibufferState: undefined,
      minibufferView: undefined,
      countPrefix: 0,
      loadPaths: [`${import.meta.dir}/../tlisp/core`],
      currentModuleName: undefined,
      // CHORE-44 Change 1: per-editor session state — construct first so the
      // session field is initialized before any API factory reads it. The model
      // is the single state container; the session layer is a thin accessor.
      session: createEditorSessionState(),
    };

    // CHORE-44 Change 1: bind the session accessors over the model-held state.
    // Must happen after `this.model` is assigned (above) and before
    // `initializeAPI()` (below) so the API factories close over the live
    // model-held session object.
    this.session = createEditorSession(this.model.session);

    this.whichKeyHandle = createWhichKeyState(this.model.whichKeyTimeout ?? DEFAULT_WHICH_KEY_TIMEOUT);

    editorLog.debug('Editor state initialized', {
      correlationId: initId,
      data: {
        mode: this.model.mode,
        theme: this.model.config.theme,
        tabSize: this.model.config.tabSize
      }
    });

    // Create interpreter
    editorLog.info('Creating T-Lisp interpreter', { correlationId: initId });
    this.interpreter = new TLispInterpreterImpl();
    editorLog.debug('T-Lisp interpreter created', { correlationId: initId });

    this.interpreter.setModuleLoader(createModuleLoader(this.interpreter, {
      coreRoot: `${import.meta.dir}/../tlisp/core`,
    }));

    this.keyMappings = new Map();
    this.lspClient = new LSPClient(this.terminal, this.filesystem);

    // Create *Messages* buffer
    this.buffers.set('*Messages*', FunctionalTextBufferImpl.create(''));
    this.bufferMetadata.set('*Messages*', { modified: false, recency: this.bufferRecency++ });

    // Create *daemon* buffer — daemon lifecycle event log (SPEC-047). Quiet by
    // default; observable via (switch-to-buffer "*daemon*").
    this.buffers.set('*daemon*', FunctionalTextBufferImpl.create(''));
    this.bufferMetadata.set('*daemon*', { modified: false, recency: this.bufferRecency++ });

    // Create program-run observability buffers (SPEC-055). Each is a filtered
    // view over the unified Log store; populated lazily by logProgram().
    for (const name of ['*Shell Output*', '*Async Output*', '*Tests*']) {
      this.buffers.set(name, FunctionalTextBufferImpl.create(''));
      this.bufferMetadata.set(name, { modified: false, recency: this.bufferRecency++ });
    }

    // Initialize KeymapSync for T-Lisp keymap integration (US-0.4.1)
    editorLog.info('Initializing KeymapSync', { correlationId: initId });
    this.keymapSync = new KeymapSync(this.interpreter);
    editorLog.debug('KeymapSync initialized', { correlationId: initId });

    // Initialize API
    editorLog.info('Initializing T-Lisp API', { correlationId: initId });
    this.initializeAPI();
    // CHORE-44 Change 1: register/undo state is per-editor (fresh per session),
    // so the former module-global resets at construction are no longer needed.

    // CHORE-44 Change 3: construct the logging collaborator (owns the unified
    // Log store, log path, and log→buffer rendering). Buffer side-effects come
    // back through these callbacks so buffer management stays with the Editor.
    this.logging = new LoggingRuntime({
      setBuffer: (name, text) => { this.buffers.set(name, FunctionalTextBufferImpl.create(text)); },
      updateBufferMetadata: (name, meta) => { this.updateBufferMetadata(name, meta); },
    });

    // CHORE-44 Change 3: construct the command-runtime collaborator (owns the
    // Cmd queue, drain loop, ownership waiters). commitMsg = applyUpdate, so
    // each follow-up Msg / CmdFailed commits through the reducer and fires
    // notifyStateChange exactly once (AC3.5: notification-once preserved).
    this.commandRuntime = new CommandRuntime({
      getRuntime: () => this.getRuntime(),
      commitMsg: (m) => this.applyUpdate(m),
    });

    // CHORE-44 Change 3: construct the binding-runtime collaborator with the
    // core-bindings-loaded flag + post-load hook + status callback. The
    // binding file/dir paths (computed from import.meta.dir) are passed to
    // each load call so the path computation stays with the Editor.
    this.bindingRuntime = new BindingRuntime({
      filesystem: this.filesystem,
      evalCode: (code) => this.interpreter.execute(code),
      setCoreBindingsLoaded: (v) => { this.coreBindingsLoaded = v; },
      getCoreBindingsLoaded: () => this.coreBindingsLoaded,
      onCoreBindingsLoaded: () => { this.executeCommand("(editor/modes/line-numbers/global-line-numbers-mode t)"); },
      setStatusMessage: (message) => { this.applyUpdate({ type: "SetStatusMessage", message }); },
    });

    // SPEC-055: tail-load prior-session entries from the persisted JSONL log
    // so a fresh daemon shows prior context. A corrupt/missing log never
    // blocks startup (guard). Loaded BEFORE the welcome message so the welcome
    // line is the most-recent entry.
    try {
      this.logging.loadPrior();
    } catch { /* persistence is best-effort */ }

    this.logMessage('Welcome to tmax', 'info');

    this.loadFallbackBindings();

    // Note: Key bindings are loaded lazily on first key press via ensureCoreBindingsLoaded()
    editorLog.debug('Key bindings will be loaded on first key press', {
      correlationId: initId
    });

    editorLog.completeOperation('editor-construction', initId, {
      data: {
        mode: this.model.mode,
        apiInitialized: true
      }
    });
  }

  /**
   * Initialize the T-Lisp API functions
   */
  private initializeAPI(): void {
    // Create a tlisp-api compatible state object
    const editor = this;
    const tlispState: EditorAPIContext = {
      get terminal() { return editor.terminal; },
      get filesystem() { return editor.filesystem; },
      // CHORE-44 Change 2 (AC2.6): NO mutable deterministic bridge properties.
      // Every simple-field write goes through `applyUpdate(msg)`; the four
      // side-effectful methods below preserve editor-specific invariants the
      // reducer alone cannot cover (tab/window/metadata/cursor-window sync).
      applyUpdate: (msg: Msg) => { editor.applyUpdate(msg); },
      setCurrentBuffer: (v: FunctionalTextBuffer | null) => {
        const previousName = editor.findBufferName(editor.model.currentBuffer);
        const existingName = editor.findBufferName(v ?? undefined);
        const bufferName = existingName ?? previousName;
        if (v && bufferName) editor.buffers.set(bufferName, v as FunctionalTextBufferImpl);
        if (v && editor.model.tabs && editor.model.tabs.length > 0) {
          const currentTabIndex = editor.model.currentTabIndex ?? 0;
          const currentTab = editor.model.tabs[currentTabIndex];
          if (currentTab && currentTab.label === editor.model.currentFilename) {
            editor.applyUpdate({
              type: "SetTabs",
              tabs: editor.model.tabs.map((tab, index) =>
                index === currentTabIndex ? { ...tab, buffer: v, bufferName } : tab
              ),
            });
          }
        }
        // R4-3: update current window buffer and bufferName
        if (v && bufferName) {
          const windows = editor.model.windows;
          if (windows && windows.length > 0) {
            const currentWindow = windows[editor.model.currentWindowIndex ?? 0];
            if (currentWindow) {
              currentWindow.buffer = v as FunctionalTextBufferImpl;
              currentWindow.bufferName = bufferName;
            }
          }
        }
        editor.applyUpdate({ type: "SetCurrentBuffer", buffer: v ?? undefined });
        if (bufferName) {
          editor.touchBuffer(bufferName);
          editor.applyUpdate({ type: "SetCurrentFilename", filename: editor.bufferMetadata.get(bufferName)?.filename });
        }
      },
      setCursorLine: (v: number) => {
        // Update both global and current window cursor position (US-3.2.1)
        editor.model.cursorPosition.line = v;
        const windows = editor.model.windows;
        if (windows && windows.length > 0) {
          const currentWindow = windows[editor.model.currentWindowIndex ?? 0];
          if (currentWindow) {
            currentWindow.cursorLine = v;
          }
        }
      },
      setCursorColumn: (v: number) => {
        // Update both global and current window cursor position (US-3.2.1)
        editor.model.cursorPosition.column = v;
        const windows = editor.model.windows;
        if (windows && windows.length > 0) {
          const currentWindow = windows[editor.model.currentWindowIndex ?? 0];
          if (currentWindow) {
            currentWindow.cursorColumn = v;
          }
        }
      },
      setCurrentFilename: (v: string | undefined) => {
        editor.applyUpdate({ type: "SetCurrentFilename", filename: v });
        const name = editor.findBufferName(editor.model.currentBuffer);
        if (name) editor.updateBufferMetadata(name, { filename: v });
      },
      // spacePressed is transient leader-key input state, NOT deterministic
      // EditorModel state. Exposed as a runtime-service accessor pair so it
      // does not appear as a duplicated model bridge property (AC2.6).
      getSpacePressed: () => editor.spacePressed,
      setSpacePressed: (pressed: boolean) => { editor.spacePressed = pressed; },
      get operations() {
        return {
          saveFile: (filename?: string) => editor.saveFile(filename),
          openFile: (filename: string) => editor.openFile(filename),
        };
      },
      // Mode state callbacks for SPEC-003 buffer-local mode state
      evalTlisp: (expr: string) => {
        try {
          return editor.interpreter.execute(expr);
        } catch (e) {
          return Either.left({
            message: e instanceof Error ? e.message : String(e),
            type: "EvalError",
            variant: "RuntimeError",
          });
        }
      },
      getCurrentMajorMode: () => editor.getCurrentMajorMode(),
      setCurrentMajorMode: (mode: string) => editor.setCurrentMajorMode(mode),
      getMinorModeRegistry: () => editor.getMinorModeRegistry(),
      getBufferModeStates: () => editor.getBufferModeStates(),
      getCurrentBufferKey: () => editor.getCurrentBufferKey(),
      getGlobalizedMinorModes: () => editor.getGlobalizedMinorModes(),
      getLoadPaths: () => editor.getLoadPaths(),
      getModuleRegistry: () => editor.interpreter.moduleRegistry,
      getCurrentModuleName: () => editor.getCurrentModuleName(),
      getBufferModified: () => editor.getCurrentBufferModified(),
      setBufferModified: (modified: boolean) => editor.setCurrentBufferModified(modified),
      getMessageLog: () => editor.logging.getMessageLog(),
      getUnifiedLog: () => editor.logging.getUnifiedLog(),
      logMessage: (msg: string, level?: string, command?: string, frameId?: string) => editor.logMessage(msg, (level as LogLevel) ?? 'info', command, frameId),
      setEchoOnly: (text: string) => editor.setEchoOnly(text),
      logProgram: (category: 'shell' | 'process' | 'test' | 'autosave', entry: any) => editor.logProgram(category, entry),
      access: {
        getModel: () => editor.model,
        applyModel: (m) => { editor.model = m; },
      },
      session: editor.session,
      caches: editor.caches,
    };

    const api = createEditorAPI(tlispState);

    for (const [name, fn] of api) {
      // fn already returns Either<AppError, TLispValue> (TLispFunctionImpl)
      this.interpreter.defineBuiltin(name, fn);
    }

    // Helper to define builtins that return raw TLispValues (wrapped in Either.right)
    const defineRaw = (name: string, fn: (args: TLispValue[]) => TLispValue) => {
      this.interpreter.defineBuiltin(name, (args) => {
        try {
          return Either.right(fn(args));
        } catch (e) {
          return Either.left({
            type: 'EvalError' as const,
            variant: 'RuntimeError' as const,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    };

    // Add key mapping functions
    defineRaw("key-bind", (args) => {
      if (args.length < 2 || args.length > 4) {
        throw new Error("key-bind requires 2-4 arguments: key, command, optional mode, optional major-mode");
      }

      const keyArg = args[0];
      const commandArg = args[1];
      const modeArg = args[2];
      const majorModeArg = args[3];

      if (!keyArg || keyArg.type !== "string") {
        throw new Error("key-bind requires a string key");
      }

      if (!commandArg || commandArg.type !== "string") {
        throw new Error("key-bind requires a string command");
      }

      const key = keyArg.value as string;
      const command = commandArg.value as string;
      let mode: "normal" | "insert" | "visual" | "command" | "mx" | "replace" | undefined;

      if (modeArg) {
        if (modeArg.type !== "string") {
          throw new Error("key-bind mode must be a string");
        }
        const modeStr = modeArg.value as string;
        if (!["normal", "insert", "visual", "command", "mx"].includes(modeStr)) {
          throw new Error(`Invalid mode: ${modeStr}`);
        }
        mode = modeStr as "normal" | "insert" | "visual" | "command" | "mx" | "replace";
      }

      let majorMode: string | undefined;
      if (majorModeArg) {
        if (majorModeArg.type !== "string") {
          throw new Error("key-bind major-mode must be a string");
        }
        majorMode = majorModeArg.value as string;
      }

      const mapping: KeyMapping = { key, command, mode, majorMode };

      if (!this.keyMappings.has(key)) {
        this.keyMappings.set(key, []);
      }

      // Remove any existing mappings for the same key, mode, and majorMode to handle conflicts
      const existingMappings = this.keyMappings.get(key)!;
      const filteredMappings = existingMappings.filter(existing => !(existing.mode === mode && existing.majorMode === majorMode));

      // Add the new mapping
      filteredMappings.push(mapping);
      this.keyMappings.set(key, filteredMappings);

      // Store in T-Lisp keymap only for global (non-major-mode-scoped) bindings.
      // Major-mode bindings (e.g. markdown) use a separate dispatch path since
      // the T-Lisp keymap has no major-mode filtering — registering them would
      // pollute prefix tables for all buffers.
      if (!majorMode) {
        const modeKey = mode || "normal";
        try {
          this.interpreter.execute(`(keymap-set-key ${modeKey}-keymap "${this.escapeKeyForTLisp(key)}" "${this.escapeKeyForTLisp(command)}")`);
        } catch {}
      }

      return createString(key);
    });

    // Add key unbind function
    defineRaw("key-unbind", (args) => {
      if (args.length < 1 || args.length > 2) {
        throw new Error("key-unbind requires 1 or 2 arguments: key, optional mode");
      }

      const keyArg = args[0];
      const modeArg = args[1];

      if (!keyArg || keyArg.type !== "string") {
        throw new Error("key-unbind requires a string key");
      }

      const key = keyArg.value as string;
      let mode: "normal" | "insert" | "visual" | "command" | "mx" | "replace" | undefined;

      if (modeArg) {
        if (modeArg.type !== "string") {
          throw new Error("key-unbind mode must be a string");
        }
        const modeStr = modeArg.value as string;
        if (!["normal", "insert", "visual", "command", "mx"].includes(modeStr)) {
          throw new Error(`Invalid mode: ${modeStr}`);
        }
        mode = modeStr as "normal" | "insert" | "visual" | "command" | "mx" | "replace";
      }

      if (this.keyMappings.has(key)) {
        const existingMappings = this.keyMappings.get(key)!;

        if (mode) {
          // Remove only mappings for the specific mode
          const filteredMappings = existingMappings.filter(existing => existing.mode !== mode);
          if (filteredMappings.length === 0) {
            this.keyMappings.delete(key);
          } else {
            this.keyMappings.set(key, filteredMappings);
          }
        } else {
          // Remove all mappings for the key
          this.keyMappings.delete(key);
        }
      }

      return createString(key);
    });

    // Add function to list all active bindings
    defineRaw("key-bindings", (args) => {
      if (args.length !== 0) {
        throw new Error("key-bindings takes no arguments");
      }

      // Create a list of all key mappings
      const allBindings: TLispValue[] = [];
      for (const [key, mappings] of this.keyMappings) {
        for (const mapping of mappings) {
          // Create a list representing this binding: [key, command, mode?]
          const bindingInfo: TLispValue[] = [
            createString(mapping.key),
            createString(mapping.command)
          ];

          if (mapping.mode) {
            bindingInfo.push(createString(mapping.mode));
          }

          allBindings.push(createList(bindingInfo));
        }
      }

      return createList(allBindings);
    });

    // Add function to get specific binding info
    defineRaw("key-binding", (args) => {
      if (args.length < 1 || args.length > 2) {
        throw new Error("key-binding requires 1 or 2 arguments: key, optional mode");
      }

      const keyArg = args[0];
      const modeArg = args[1];

      if (!keyArg || keyArg.type !== "string") {
        throw new Error("key-binding requires a string key");
      }

      const key = keyArg.value as string;
      let mode: "normal" | "insert" | "visual" | "command" | "mx" | "replace" | undefined;

      if (modeArg) {
        if (modeArg.type !== "string") {
          throw new Error("key-binding mode must be a string");
        }
        const modeStr = modeArg.value as string;
        if (!["normal", "insert", "visual", "command", "mx"].includes(modeStr)) {
          throw new Error(`Invalid mode: ${modeStr}`);
        }
        mode = modeStr as "normal" | "insert" | "visual" | "command" | "mx" | "replace";
      }

      const mappings = this.keyMappings.get(key);
      if (!mappings || mappings.length === 0) {
        return createNil(); // No bindings found
      }

      // If mode is specified, find the specific mode binding
      if (mode) {
        const specificMapping = mappings.find(m => m.mode === mode);
        if (specificMapping) {
          return createList([
            createString(specificMapping.command),
            createString("source"), // Could be extended to show source file
            createString(mode)
          ]);
        }
        return createNil(); // No binding found for specific mode
      } else {
        // Return the first mapping (or the one without mode if available)
        const mapping = mappings[0]!; // Return first available mapping
        return createList([
          createString(mapping.command),
          createString("source"), // Could be extended to show source file
          createString(mapping.mode || "all")
        ]);
      }
    });

    // Add command execution function
    defineRaw("execute-command", (args) => {
      if (args.length !== 1) {
        throw new Error("execute-command requires exactly 1 argument: command");
      }

      const commandArg = args[0]!;
      if (!commandArg || commandArg.type !== "string") {
        throw new Error("execute-command requires a string command");
      }

      const command = commandArg.value as string;
      return this.executeCommand(command) as TLispValue;
    });

    // Add describe-key function (US-1.11.1)
    defineRaw("describe-key", (args) => {
      if (args.length < 1 || args.length > 2) {
        throw new Error("describe-key requires 1 or 2 arguments: key, optional mode");
      }

      const keyArg = args[0]!;
      const modeArg = args[1];

      if (!keyArg || keyArg.type !== "string") {
        throw new Error("describe-key requires a string key");
      }

      const key = keyArg.value as string;
      let mode: "normal" | "insert" | "visual" | "command" | "mx" | "replace" | undefined;

      if (modeArg) {
        if (modeArg.type !== "string") {
          throw new Error("describe-key mode must be a string");
        }
        const modeStr = modeArg.value as string;
        if (!["normal", "insert", "visual", "command", "mx"].includes(modeStr)) {
          throw new Error(`Invalid mode: ${modeStr}`);
        }
        mode = modeStr as "normal" | "insert" | "visual" | "command" | "mx" | "replace";
      } else {
        // Use current mode if not specified
        mode = this.getMode() as "normal" | "insert" | "visual" | "command" | "mx" | "replace";
      }

      const mappings = this.keyMappings.get(key);
      if (!mappings || mappings.length === 0) {
        return createNil(); // Key is unbound
      }

      // Find the specific mode binding
      let mapping = mappings.find(m => m.mode === mode);
      if (!mapping && mode) {
        // Try to find a binding without a mode (global binding)
        mapping = mappings.find(m => !m.mode);
      }
      if (!mapping) {
        mapping = mappings[0]!; // Fall back to first binding
      }

      // Return structured information: [command, key, mode, documentation]
      return createList([
        createString(mapping.command),
        createString(key),
        createString(mapping.mode || mode || "all"),
        createString("No documentation available") // TODO: Implement function documentation lookup
      ]);
    });

    // Add describe-key-prompt function (US-1.11.1)
    // Interactive version that prompts user to press a key
    defineRaw("describe-key-prompt", (args) => {
      if (args.length !== 0) {
        throw new Error("describe-key-prompt requires no arguments");
      }

      // Set a flag to indicate we're waiting for a key to describe
      this.applyUpdate({ type: "SetDescribeKeyPending", pending: true });
      this.applyUpdate({ type: "SetStatusMessage", message: "Describe key: press a key" });

      return createString("waiting for key");
    });

    // Register keymap-ops API functions (US-0.4.1)
    const keymapOps = createKeymapOps(this.interpreter, this.keymapSync);
    for (const [name, fn] of keymapOps) {
      // Wrap fn that returns Either<string, TLispValue> to Either<AppError, TLispValue>
      this.interpreter.defineBuiltin(name, (args) => {
        const result = fn(args);
        if (Either.isLeft(result)) {
          return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: result.left });
        }
        return result;
      });
    }

    // Add describe-function function (US-1.11.2)
    defineRaw("describe-function", (args) => {
      if (args.length !== 1) {
        throw new Error("describe-function requires exactly 1 argument: function-name");
      }

      const nameArg = args[0];
      if (!nameArg || nameArg.type !== "string") {
        throw new Error("describe-function requires a string function name");
      }

      const functionName = nameArg.value as string;

      const resolved = this.resolveCallable(functionName);
      const func = resolved?.value;
      const moduleOrigin = resolved?.moduleName;

      if (!func) {
        return createNil(); // Function not found
      }

      if (func.type !== "function") {
        return createNil(); // Not a function
      }

      const fn = func as TLispFunction;

      // Extract function information
      const name = fn.name || functionName;
      const docstring = fn.docstring || "No documentation available";
      const parameters = fn.parameters || [];

      // Build signature
      let signature: string;
      if (moduleOrigin) {
        signature = `${name} (${parameters.join(" ")}) — from module ${moduleOrigin}`;
      } else if (parameters.length > 0) {
        signature = `${name} (${parameters.join(" ")})`;
      } else {
        signature = `${name} ()`;
      }

      // Return structured information: [name, signature, docstring, file?]
      const result: TLispValue[] = [
        createString(name),
        createString(signature),
        createString(docstring)
      ];

      if (fn.source) {
        result.push(createString(fn.source));
      }

      return createList(result);
    });

    // Add describe-function-prompt function (US-1.11.2)
    // Interactive version that prompts user for function name
    defineRaw("describe-function-prompt", (args) => {
      if (args.length !== 0) {
        throw new Error("describe-function-prompt requires no arguments");
      }

      // Set a flag to indicate we're waiting for a function name to describe
      this.applyUpdate({ type: "SetDescribeFunctionPending", pending: true });
      this.applyUpdate({ type: "SetStatusMessage", message: "Describe function: " });

      return createString("waiting for function name");
    });

    // Add describe-function-complete function (US-1.11.2)
    // Returns list of function names matching a pattern
    defineRaw("describe-function-complete", (args) => {
      if (args.length !== 1) {
        throw new Error("describe-function-complete requires exactly 1 argument: pattern");
      }

      const patternArg = args[0];
      if (!patternArg || patternArg.type !== "string") {
        throw new Error("describe-function-complete requires a string pattern");
      }

      const pattern = (patternArg.value as string).toLowerCase();

      const matchingFunctions: TLispValue[] = [];
      const seen = new Set<string>();

      for (const [name, value] of this.collectVisibleGlobalBindings()) {
        if (value.type === "function" && name.toLowerCase().includes(pattern)) {
          seen.add(name);
          matchingFunctions.push(createString(name));
        }
      }

      const moduleExports = this.interpreter.moduleRegistry.allExports();
      for (const [name, entry] of moduleExports) {
        if (!seen.has(name) && entry.value.type === "function" && (
          name.toLowerCase().includes(pattern) ||
          entry.exportName.toLowerCase().includes(pattern)
        )) {
          matchingFunctions.push(createString(name));
        }
      }

      return createList(matchingFunctions);
    });

    // Add apropos-command function (US-1.11.3)
    // Search for commands by pattern, returning name, binding, and documentation
    defineRaw("apropos-command", (args) => {
      if (args.length !== 1) {
        throw new Error("apropos-command requires exactly 1 argument: pattern");
      }

      const patternArg = args[0];
      if (!patternArg || patternArg.type !== "string") {
        throw new Error("apropos-command requires a string pattern");
      }

      const pattern = (patternArg.value as string).toLowerCase();

      // Find all matching commands
      const matchingCommands: TLispValue[] = [];
      const seen = new Set<string>();

      // Helper to check if pattern matches and build result
      const checkMatch = (name: string, value: TLispValue): void => {
        if (seen.has(name)) return;
        if (value.type !== "function") return;

        const lowerName = name.toLowerCase();
        let matches = false;
        try {
          const regex = new RegExp(pattern, "i");
          matches = regex.test(lowerName);
        } catch {
          matches = lowerName.includes(pattern);
        }

        if (matches) {
          seen.add(name);
          // Get key bindings for this command
          const bindings: string[] = [];
          for (const [key, mappings] of this.keyMappings) {
            for (const mapping of mappings) {
              if (mapping.command === name) {
                const modeStr = mapping.mode ? ` (${mapping.mode})` : "";
                bindings.push(`${key}${modeStr}`);
              }
            }
          }

          const func = value as TLispFunction;
          const docstring = func.docstring || "No documentation available";

          const result: TLispValue[] = [
            createString(name),
            bindings.length > 0 ? createString(bindings.join(", ")) : createString(""),
            createString(docstring)
          ];

          matchingCommands.push(createList(result));
        }
      };

      for (const [name, value] of this.collectVisibleGlobalBindings()) {
        checkMatch(name, value);
      }

      const moduleExports = this.interpreter.moduleRegistry.allExports();
      for (const [name, entry] of moduleExports) {
        checkMatch(name, entry.value);
      }

      return createList(matchingCommands);
    });

    // Add apropos-command-prompt function (US-1.11.3)
    // Interactive version that prompts user for search pattern
    defineRaw("apropos-command-prompt", (args) => {
      if (args.length !== 0) {
        throw new Error("apropos-command-prompt requires no arguments");
      }

      // Set a flag to indicate we're waiting for a search pattern
      this.applyUpdate({ type: "SetAproposCommandPending", pending: true });
      this.applyUpdate({ type: "SetStatusMessage", message: "Apropos command: " });

      return createString("waiting for search pattern");
    });

    // Add count prefix API functions (US-1.3.1)
    defineRaw("count-get", (args) => {
      if (args.length !== 0) {
        throw new Error("count-get requires no arguments");
      }
      return { type: "number", value: this.getCount() };
    });

    defineRaw("count-set", (args) => {
      if (args.length !== 1) {
        throw new Error("count-set requires exactly 1 argument: count");
      }
      const countArg = args[0];
      if (!countArg || countArg.type !== "number") {
        throw new Error("count-set requires a number");
      }
      const count = countArg.value as number;
      if (count < 0) {
        throw new Error("count must be >= 0");
      }
      this.setCount(count);
      return createNil();
    });

    defineRaw("count-reset", (args) => {
      if (args.length !== 0) {
        throw new Error("count-reset requires no arguments");
      }
      this.resetCount();
      return createNil();
    });

    defineRaw("count-active", (args) => {
      if (args.length !== 0) {
        throw new Error("count-active requires no arguments");
      }
      return { type: "boolean", value: this.isCountActive() };
    });

    // Emacs-compatible prefix aliases that delegate to the count system
    defineRaw("set-prefix", (args) => {
      if (args.length !== 1) throw new Error("set-prefix requires exactly 1 argument: n");
      if (args[0]?.type !== "number") throw new Error("set-prefix requires a number");
      this.setCount(Number(args[0].value));
      return createNumber(Number(args[0].value));
    });

    defineRaw("prefix-numeric-value", (_args) => {
      const count = this.getCount();
      // Return nil when no prefix is active, otherwise the count value
      return count > 0 ? createNumber(count) : createNil();
    });

    // Add file operations
    defineRaw("file-save", (args) => {
      if (args.length !== 0) {
        throw new Error("file-save requires no arguments");
      }
      
      // Use async saveFile but return synchronously for T-Lisp
      this.saveFile().catch((error) => {
        const msg = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
        this.applyUpdate({ type: "SetStatusMessage", message: msg });
        // SPEC-055: route save errors through the log so they don't vanish.
        this.logMessage(msg, 'error');
      });
      
      return createString("saving...");
    });

    // Add minibuffer API functions (US-1.10.1)
    defineRaw("minibuffer-active", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-active requires no arguments");
      }
      return { type: "boolean", value: this.model.mode === "mx" };
    });

    defineRaw("minibuffer-get", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-get requires no arguments");
      }
      return createString(this.model.mxCommand);
    });

    defineRaw("minibuffer-set", (args) => {
      if (args.length !== 1) {
        throw new Error("minibuffer-set requires exactly 1 argument: text");
      }
      const textArg = args[0];
      if (!textArg || textArg.type !== "string") {
        throw new Error("minibuffer-set requires a string");
      }
      this.applyUpdate({ type: "SetMxCommand", value: textArg.value as string });
      return createString(textArg.value as string);
    });

    defineRaw("minibuffer-clear", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-clear requires no arguments");
      }
      this.applyUpdate({ type: "ClearMxCommand" });
      return createNil();
    });

    defineRaw("minibuffer-state-get", (args) => {
      if (args.length !== 0) throw new Error("minibuffer-state-get requires no arguments");
      return deserializeTlispValue(this.model.minibufferState);
    });

    defineRaw("minibuffer-state-set", (args) => {
      if (args.length !== 1) throw new Error("minibuffer-state-set requires one argument");
      this.applyUpdate({ type: "SetMinibufferState", state: serializeTlispValue(args[0]!) });
      return args[0]!;
    });

    defineRaw("minibuffer-state-clear", (args) => {
      if (args.length !== 0) throw new Error("minibuffer-state-clear requires no arguments");
      this.applyUpdate({ type: "SetMinibufferState", state: undefined });
      return createNil();
    });

    defineRaw("minibuffer-view-publish", (args) => {
      if (args.length !== 1) throw new Error("minibuffer-view-publish requires one view");
      this.applyUpdate({ type: "SetMinibufferView", view: this.minibufferViewFromTlisp(args[0]!) });
      return args[0]!;
    });

    defineRaw("minibuffer-view-clear", (args) => {
      if (args.length !== 0) throw new Error("minibuffer-view-clear requires no arguments");
      this.applyUpdate({ type: "SetMinibufferView", view: undefined });
      return createNil();
    });

    defineRaw("editor-cursor-focus", (args) => {
      if (args.length !== 0) throw new Error("editor-cursor-focus requires no arguments");
      return createString(this.model.cursorFocus ?? "buffer");
    });

    defineRaw("editor-set-cursor-focus", (args) => {
      if (args.length !== 1 || args[0]?.type !== "string") {
        throw new Error("editor-set-cursor-focus requires a string");
      }
      const focus = args[0].value as string;
      if (focus !== "buffer" && focus !== "command") throw new Error("Invalid cursor focus");
      this.applyUpdate({ type: "SetCursorFocus", focus: focus });
      return createString(focus);
    });

    defineRaw("terminal-size", (args) => {
      if (args.length !== 0) throw new Error("terminal-size requires no arguments");
      const size = this.terminal.getSize();
      return createHashmap([
        ["width", createNumber(size.width)],
        ["height", createNumber(size.height)],
      ]);
    });

    defineRaw("buffer-list-details", (args) => {
      if (args.length !== 0) throw new Error("buffer-list-details requires no arguments");
      return createList(this.getBufferDetails().map(details => {
        return createHashmap([
          ["name", createString(details.name)],
          ["filename", details.filename ? createString(details.filename) : createNil()],
          ["major-mode", createString(details.majorMode)],
          ["modified", createBoolean(details.modified)],
          ["characters", createNumber(details.characters)],
          ["lines", createNumber(details.lines)],
          ["current", createBoolean(details.current)],
          ["special", createBoolean(details.special)],
          ["recency", createNumber(details.recency)],
        ]);
      }));
    });

    defineRaw("callable-command-details", (args) => {
      if (args.length !== 0) throw new Error("callable-command-details requires no arguments");
      const bindingsByCommand = new Map<string, string[]>();
      for (const [key, mappings] of this.keyMappings) {
        for (const mapping of mappings) {
          const match = mapping.command.match(/^\(([^\s()]+)\)$/);
          if (!match?.[1]) continue;
          bindingsByCommand.set(match[1], [...(bindingsByCommand.get(match[1]) ?? []), key]);
        }
      }
      const seen = new Set<string>();
      const results: TLispValue[] = [];

      for (const [name, value] of this.collectVisibleGlobalBindings().entries()) {
        if (value.type === "function") {
          seen.add(name);
          const fn = value as TLispFunction;
          results.push(createHashmap([
            ["name", createString(name)],
            ["documentation", createString((fn.docstring ?? "").split("\n")[0] ?? "")],
            ["bindings", createList((bindingsByCommand.get(name) ?? []).map(key => createString(key)))],
          ]));
        }
      }

      // Module exports
      const moduleExports = this.interpreter.moduleRegistry.allExports();
      for (const [name, entry] of moduleExports) {
        if (!seen.has(name) && entry.value.type === "function") {
          const fn = entry.value as TLispFunction;
          results.push(createHashmap([
            ["name", createString(name)],
            ["documentation", createString((fn.docstring ?? "").split("\n")[0] ?? "")],
            ["bindings", createList((bindingsByCommand.get(name) ?? []).map(key => createString(key)))],
            ["module", createString(entry.moduleName)],
          ]));
        }
      }

      return createList(results);
    });

    defineRaw("invoke-command", (args) => {
      if (args.length !== 1 || args[0]?.type !== "string") {
        throw new Error("invoke-command requires a command name string");
      }
      const name = args[0].value as string;
      if (!/^[A-Za-z0-9_+*/<>=!?$%&~.^:-]+$/.test(name)) {
        throw new Error("Invalid command name");
      }
      const result = this.executeCommand(`(${name})`);
      if (!result || typeof result !== "object" || !("_tag" in result)) {
        return createNil();
      }
      const eitherResult = result as Either<{ message: string }, TLispValue>;
      if (Either.isLeft(eitherResult)) throw new Error(eitherResult.left.message);
      return eitherResult.right;
    });

    defineRaw("editor-space-prefix-active-p", (args) => {
      if (args.length !== 0) throw new Error("editor-space-prefix-active-p requires no arguments");
      return createBoolean(this.spacePressed);
    });

    defineRaw("editor-reset-space-prefix", (args) => {
      if (args.length !== 0) throw new Error("editor-reset-space-prefix requires no arguments");
      this.spacePressed = false;
      return createNil();
    });

    // Window prefix handler: C-w waits for next key (s/v/w/q)
    defineRaw("editor-window-prefix", (args) => {
      if (args.length !== 0) {
        throw new Error("editor-window-prefix requires no arguments");
      }
      this.windowPrefixPressed = true;
      this.applyUpdate({ type: "SetStatusMessage", message: "C-w" });
      return createString("window-prefix");
    });

    // Which-key API functions (US-1.10.3)
    defineRaw("which-key-enable", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-enable requires no arguments");
      }
      const enableTimeout = this.model.whichKeyTimeout || 1000;
      this.applyUpdate({ type: "SetWhichKeyTimeout", timeout: enableTimeout });
      this.whichKeyHandle.reset(enableTimeout);
      return createNil();
    });

    defineRaw("which-key-disable", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-disable requires no arguments");
      }
      this.applyUpdate({ type: "SetWhichKeyTimeout", timeout: 0 });
      this.whichKeyHandle.deactivate();
      this.applyUpdate({ type: "SetWhichKeyActive", active: false });
      this.applyUpdate({ type: "SetWhichKeyPrefix", prefix: "" });
      this.applyUpdate({ type: "SetWhichKeyBindings", bindings: [] });
      return createNil();
    });

    defineRaw("which-key-timeout", (args) => {
      if (args.length !== 1) {
        throw new Error("which-key-timeout requires exactly 1 argument: milliseconds");
      }
      const timeoutArg = args[0];
      if (!timeoutArg || timeoutArg.type !== "number") {
        throw new Error("which-key-timeout requires a number");
      }
      const timeout = timeoutArg.value as number;
      if (timeout < 0) {
        throw new Error("which-key-timeout must be a positive number");
      }
      this.applyUpdate({ type: "SetWhichKeyTimeout", timeout });
      this.whichKeyHandle.reset(timeout);
      return createNumber(timeout);
    });

    defineRaw("which-key-active", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-active requires no arguments");
      }
      return { type: "boolean", value: this.model.whichKeyActive || false };
    });

    defineRaw("which-key-prefix", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-prefix requires no arguments");
      }
      return createString(this.model.whichKeyPrefix || "");
    });

    defineRaw("which-key-bindings", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-bindings requires no arguments");
      }
      const bindings = this.model.whichKeyBindings || [];
      const bindingValues = bindings.map((binding: any) => {
        const result = [
          createString(binding.key),
          createString(binding.command),
        ];

        // Include documentation if available (US-1.10.4)
        if (binding.documentation) {
          result.push(createString(binding.documentation));
        }

        return createList(result);
      });
      return createList(bindingValues);
    });

    // ============================================================================
    // COMMAND DOCUMENTATION PREVIEW FUNCTIONS (US-1.10.4)
    // ============================================================================

    // Get documentation for a command
    defineRaw("get-command-documentation", (args) => {
      if (args.length !== 1) {
        throw new Error("get-command-documentation requires exactly 1 argument: command-name");
      }

      const nameArg = args[0];
      if (!nameArg || nameArg.type !== "string") {
        throw new Error("get-command-documentation requires a string command name");
      }

      const commandName = nameArg.value as string;

      const func = this.resolveCallable(commandName)?.value;

      if (!func || func.type !== "function") {
        return createString("No documentation available");
      }

      const fnDoc = func as TLispFunction;

      // Return docstring if available
      if (fnDoc.docstring) {
        return createString(fnDoc.docstring);
      }

      return createString("No documentation available");
    });

    // Get truncated documentation for preview pane
    defineRaw("get-command-documentation-truncated", (args) => {
      if (args.length !== 2) {
        throw new Error("get-command-documentation-truncated requires exactly 2 arguments: command-name and max-length");
      }

      const nameArg = args[0];
      if (!nameArg || nameArg.type !== "string") {
        throw new Error("get-command-documentation-truncated requires a string command name");
      }

      const lengthArg = args[1];
      if (!lengthArg || lengthArg.type !== "number") {
        throw new Error("get-command-documentation-truncated requires a number for max-length");
      }

      const commandName = nameArg.value as string;
      const maxLength = lengthArg.value as number;

      const func = this.resolveCallable(commandName)?.value;

      if (!func || func.type !== "function") {
        return createString("No documentation available");
      }

      const fnTrunc = func as TLispFunction;

      // Get documentation
      const doc = fnTrunc.docstring || "No documentation available";

      // Truncate if needed
      if (doc.length <= maxLength) {
        return createString(doc);
      }

      // Truncate and add ellipsis
      return createString(doc.substring(0, maxLength - 3) + "...");
    });

    // ============================================================================
    // MACRO RECORDING FUNCTIONS (US-2.4.1)
    // ============================================================================

    // CHORE-44 Change 1: per-editor macro state (was module-global). Bind the
    // session's macro ops to the legacy local names so the wrappers below are
    // unchanged.
    const {
      start: startRecording,
      stop: stopRecording,
      record: recordKey,
      isActive: isRecording,
      currentRegister: getCurrentRegister,
      all: getMacros,
      execute: executeMacro,
      executeLast: executeLastMacro,
      lastExecuted: getLastExecutedMacro,
      clearAll: clearAllMacros,
      clear: clearMacro,
      reset: resetMacroRecordingState,
    } = this.session.macros;

    // macro-record-start: Start recording to a register
    defineRaw("macro-record-start", (args) => {
      if (args.length !== 1) {
        throw new Error("macro-record-start requires exactly 1 argument: register");
      }
      const registerArg = args[0];
      if (!registerArg || registerArg.type !== "string") {
        throw new Error("macro-record-start requires a string register");
      }
      const register = registerArg.value as string;

      const result = startRecording(register);
      if (Either.isLeft(result)) {
        throw new Error(result.left);
      }
      return createString(result.right);
    });

    // macro-record-stop: Stop recording and save macro
    defineRaw("macro-record-stop", (args) => {
      if (args.length !== 0) {
        throw new Error("macro-record-stop requires no arguments");
      }

      const result = stopRecording();
      if (Either.isLeft(result)) {
        throw new Error(result.left);
      }

      // Save macros to disk after recording stops (US-2.4.2)
      // Fire-and-forget: save in background without blocking
      editor.saveMacros().catch(error => {
        console.warn("Failed to save macros:", error);
      });

      return createString(result.right);
    });

    // macro-record-key: Record a key during recording
    defineRaw("macro-record-key", (args) => {
      if (args.length !== 1) {
        throw new Error("macro-record-key requires exactly 1 argument: key");
      }
      const keyArg = args[0];
      if (!keyArg || keyArg.type !== "string") {
        throw new Error("macro-record-key requires a string key");
      }
      const key = keyArg.value as string;

      const result = recordKey(key);
      if (Either.isLeft(result)) {
        throw new Error(result.left);
      }
      return createString(result.right);
    });

    // macro-record-active: Check if currently recording
    defineRaw("macro-record-active", (args) => {
      if (args.length !== 0) {
        throw new Error("macro-record-active requires no arguments");
      }
      return { type: "boolean", value: isRecording() };
    });

    // macro-record-register: Get current recording register
    defineRaw("macro-record-register", (args) => {
      if (args.length !== 0) {
        throw new Error("macro-record-register requires no arguments");
      }
      const register = getCurrentRegister();
      if (register === null) {
        return createNil();
      }
      return createString(register);
    });

    // macro-list: Get all recorded macros
    defineRaw("macro-list", (args) => {
      if (args.length !== 0) {
        throw new Error("macro-list requires no arguments");
      }
      const macros = getMacros();
      const macroList: TLispValue[] = [];
      for (const [register, keys] of macros) {
        const keyValues = keys.map(k => createString(k));
        macroList.push(createList([
          createString(register),
          createList(keyValues),
        ]));
      }
      return createList(macroList);
    });

    // macro-execute: Execute a recorded macro
    // SPEC-044 Phase 1.H — returns a TLispPromise so the async evaluator
    // (used by the handler's executeCommandAsync path) awaits each inner
    // handleKey in order. The previous fire-and-forget loop raced key dispatch
    // and made @a/@@ no-ops in practice.
    defineRaw("macro-execute", (args) => {
      if (args.length < 1 || args.length > 2) {
        throw new Error("macro-execute requires 1 or 2 arguments: register, optional count");
      }
      const registerArg = args[0];
      if (!registerArg || registerArg.type !== "string") {
        throw new Error("macro-execute requires a string register");
      }
      const register = registerArg.value as string;

      // Handle optional count parameter
      let count = 1;
      if (args.length === 2) {
        const countArg = args[1];
        if (!countArg || countArg.type !== "number") {
          throw new Error("macro-execute count must be a number");
        }
        count = countArg.value as number;
        if (count < 1) {
          throw new Error("macro-execute count must be >= 1");
        }
      }

      const result = executeMacro(register);
      if (Either.isLeft(result)) {
        throw new Error(result.left);
      }

      // Get the macro keys
      const macros = getMacros();
      const keys = macros.get(register);
      if (!keys) {
        throw new Error(`No macro in register ${register}`);
      }

      // Build a sequential chain that awaits each handleKey in turn. Returning
      // a TLispPromise lets executeCommandAsync await the full playback before
      // the handler returns control to the test/user.
      const promise = (async (): Promise<TLispValue> => {
        for (let i = 0; i < count; i++) {
          for (const key of keys) {
            try {
              await this.handleKey(key);
            } catch (error) {
              this.applyUpdate({ type: "SetStatusMessage", message: `Macro error: ${error instanceof Error ? error.message : String(error)}` });
            }
          }
        }
        return createString(register);
      })();

      return createPromise(promise);
    });

    // macro-execute-last: Execute the last executed macro (@@)
    defineRaw("macro-execute-last", (args) => {
      if (args.length !== 0) {
        throw new Error("macro-execute-last requires no arguments");
      }

      const result = executeLastMacro();
      if (Either.isLeft(result)) {
        throw new Error(result.left);
      }

      const register = result.right;

      // Get the macro keys
      const macros = getMacros();
      const keys = macros.get(register);
      if (!keys) {
        throw new Error(`No macro in register ${register}`);
      }

      const promise = (async (): Promise<TLispValue> => {
        for (const key of keys) {
          try {
            await this.handleKey(key);
          } catch (error) {
            this.applyUpdate({ type: "SetStatusMessage", message: `Macro error: ${error instanceof Error ? error.message : String(error)}` });
          }
        }
        return createString(register);
      })();

      return createPromise(promise);
    });

    // macro-last-executed: Get the last executed macro register
    defineRaw("macro-last-executed", (args) => {
      if (args.length !== 0) {
        throw new Error("macro-last-executed requires no arguments");
      }
      const register = getLastExecutedMacro();
      if (register === null) {
        return createNil();
      }
      return createString(register);
    });

    // macro-clear: Clear all macros
    defineRaw("macro-clear", (args) => {
      if (args.length !== 0) {
        throw new Error("macro-clear requires no arguments");
      }
      clearAllMacros();
      return createNil();
    });

    // macro-clear-register: Clear a specific macro
    defineRaw("macro-clear-register", (args) => {
      if (args.length !== 1) {
        throw new Error("macro-clear-register requires exactly 1 argument: register");
      }
      const registerArg = args[0];
      if (!registerArg || registerArg.type !== "string") {
        throw new Error("macro-clear-register requires a string register");
      }
      const register = registerArg.value as string;

      const result = clearMacro(register);
      if (Either.isLeft(result)) {
        throw new Error(result.left);
      }
      return createString(result.right);
    });

    // macro-record-reset: Reset macro recording state (for testing)
    defineRaw("macro-record-reset", (args) => {
      if (args.length !== 0) {
        throw new Error("macro-record-reset requires no arguments");
      }
      resetMacroRecordingState();
      return createNil();
    });

    // Add window management operations (US-3.2.1)
    const windowOps = createWindowOps(
      { getModel: () => this.model, applyModel: (m) => { this.applyModel(m); } },
      (windows) => { this.applyUpdate({ type: "SetWindows", windows }); },
      (index) => { this.applyUpdate({ type: "SetCurrentWindowIndex", index }); },
      () => this.terminal.getSize()
    );

    for (const [name, fn] of windowOps) {
      this.interpreter.defineBuiltin(name, fn);
    }

    // Add tab management operations (SPEC-004)
    const tabOps = createTabOps(
      { getModel: () => this.model, applyModel: (m) => { this.applyModel(m); } },
      (tabs) => { this.applyUpdate({ type: "SetTabs", tabs }); },
      (index) => { this.applyUpdate({ type: "SetCurrentTabIndex", index }); },
      (name, content) => {
        this.createBuffer(name, content);
        return this.model.currentBuffer;
      },
      (tab) => {
        this.applyUpdate({ type: "SetCurrentBuffer", buffer: tab.buffer });
        this.applyUpdate({ type: "SetCurrentFilename", filename: tab.label });
      },
    );

    for (const [name, fn] of tabOps) {
      this.interpreter.defineBuiltin(name, fn);
    }

    // Init file operations (SPEC-025)
    this.interpreter.defineBuiltin("eval-init-file", (args) => {
      this.evalInitFile();
      return Either.right(createNil());
    });

    defineRaw("init-file-path", (args) => {
      return createString(this.currentInitFile || "");
    });

    // Buffer evaluation (SPEC-025)
    defineRaw("eval-buffer", (args) => {
      return this.evalBuffer();
    });
  }

  /**
   * Load bindings from file
   * @param path - Path to the bindings file
   * @returns true if loaded successfully, false otherwise
   */
  private async loadBindingsFromFile(path: string, silent = false): Promise<boolean> {
    return this.bindingRuntime.loadBindingsFromFile(path, silent);
  }

  /**
   * Load core key bindings from T-Lisp files. CHORE-44 Change 3: the load
   * order, required-file list, fallback policy, and post-load line-numbers
   * toggle live in the binding-runtime collaborator; this is a one-line facade.
   */
  private async loadCoreBindings(): Promise<void> {
    await this.bindingRuntime.loadCoreBindings(
      `${import.meta.dir}/../tlisp/core/bindings`,
      `${import.meta.dir}/../tlisp/core/keymaps.tlisp`,
    );
  }

  /**
   * Ensure core bindings are loaded (lazy loading)
   */
  private async ensureCoreBindingsLoaded(): Promise<void> {
    await this.bindingRuntime.ensureCoreBindingsLoaded(
      `${import.meta.dir}/../tlisp/core/bindings`,
      `${import.meta.dir}/../tlisp/core/keymaps.tlisp`,
    );
  }

  /**
   * Load saved macros from ~/.config/tmax/macros.tlisp (US-2.4.2)
   */
  private async loadSavedMacros(): Promise<void> {
    try {
      const loaded = await this.pluginRuntime.loadMacros(this.filesystem, this.session.macros);
      if (loaded) {
        this.applyUpdate({ type: "SetStatusMessage", message: "Macros loaded from ~/.config/tmax/macros.tlisp" });
      }
      // If file doesn't exist, that's fine - it's the first run
    } catch (error) {
      console.warn("Failed to load macros:", error);
    }
  }

  /**
   * Save recorded macros to ~/.config/tmax/macros.tlisp (US-2.4.2)
   */
  async saveMacros(): Promise<void> {
    try {
      const saved = await this.pluginRuntime.saveMacros(this.filesystem, this.session.macros);
      if (saved) {
        this.applyUpdate({ type: "SetStatusMessage", message: "Macros saved to ~/.config/tmax/macros.tlisp" });
      }
    } catch (error) {
      console.warn("Failed to save macros:", error);
    }
  }

  /**
   * Load plugins from a directory (US-2.1.1). Delegates parsing + loading to
   * the PluginRuntime collaborator (CHORE-44 Change 3: no plugin file parsing
   * in Editor).
   */
  async loadPluginsFromDirectory(pluginDir: string): Promise<PluginLoadResult> {
    return this.pluginRuntime.loadPluginsFromDirectory(pluginDir, this.filesystem, (code) => this.interpreter.execute(code));
  }

  /**
   * Load minimal fallback key bindings when core-bindings.tlisp fails.
   * CHORE-44 Change 3: the fallback keymap string + critical-failure status
   * commit live in the binding-runtime collaborator; this is a one-line facade.
   */
  private loadFallbackBindings(): void {
    this.bindingRuntime.loadFallbackBindings();
  }

  /**
   * Load initialization file (SPEC-025)
   *
   * Loads and executes the user's init.tlisp configuration file.
   * This file can contain:
   * - Custom keymap definitions using defkeymap
   * - Keymap registrations using keymap-set
   * - Any other T-Lisp initialization code
   *
   * The file is loaded from ~/.config/tmax/init.tlisp (XDG config directory)
   * @param initFilePath - Optional custom init file path
   *
   * CHORE-44 Change 3: the discovery algorithm (config-dir creation, default
   * path, `~/.config/tmax/init.tlisp` fallback, silent "use defaults") lives
   * in the binding-runtime collaborator; this facade supplies the registered
   * keymap list (read from keymapSync) and stores the resolved path.
   */
  private async loadInitFile(initFilePath?: string): Promise<void> {
    const registeredKeymaps = ["normal", "insert", "visual", "command", "mx"].filter(mode =>
      this.keymapSync.hasKeymap(mode)
    );
    const resolved = await this.bindingRuntime.loadInitFile(initFilePath, registeredKeymaps);
    this.currentInitFile = resolved;
  }

  /**
   * Reload init file without restarting editor (SPEC-025)
   * Useful for testing configuration changes
   */
  async evalInitFile(): Promise<void> {
    const initLog = log.module('editor').fn('evalInitFile');
    initLog.info('Reloading init file', { data: { path: this.currentInitFile } });

    // Reload using stored init file path
    await this.loadInitFile(this.currentInitFile || undefined);

    initLog.info('Init file reloaded successfully');
  }

  /**
   * Evaluate current buffer as T-Lisp code (SPEC-025)
   * Useful for testing T-Lisp code without saving to file
   * @returns The result of the last expression evaluated
   */
  evalBuffer(): TLispValue {
    const evalLog = log.module('editor').fn('evalBuffer');
    
    if (!this.model.currentBuffer) {
      evalLog.warn('No buffer to evaluate');
      return createNil();
    }

    const bufferContentResult = this.model.currentBuffer.getContent();
    if (Either.isLeft(bufferContentResult)) {
      evalLog.error('Failed to get buffer content');
      return createNil();
    }
    const bufferContent = bufferContentResult.right;
    evalLog.debug('Evaluating buffer content', {
      data: {
        length: bufferContent.length
      }
    });

    try {
      const result = this.interpreter.execute(bufferContent);
      evalLog.info('Buffer evaluated successfully');
      if (Either.isLeft(result)) {
        return createNil();
      }
      return result.right;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      evalLog.error('Error evaluating buffer', error instanceof Error ? error : new Error(errorMsg));
      throw error;
    }
  }

  /**
   * Execute a T-Lisp command
   * @param command - Command to execute
   * @returns Result of command execution
   */
  private collectVisibleGlobalBindings(): Map<string, TLispValue> {
    const result = new Map<string, TLispValue>();
    let env: TLispEnvironment | undefined = this.interpreter.globalEnv;

    while (env) {
      for (const [name, value] of env.bindings) {
        if (!result.has(name)) result.set(name, value);
      }
      env = env.parent;
    }

    return result;
  }

  private resolveCallable(name: string): { value: TLispValue; moduleName?: string; env?: ModuleExportRecord["env"] } | undefined {
    const globalValue = this.interpreter.globalEnv.lookup(name);
    if (globalValue) {
      return { value: globalValue };
    }

    const publicExport = this.interpreter.moduleRegistry.resolvePublicName(name);
    if (publicExport) {
      return {
        value: publicExport.value,
        moduleName: publicExport.moduleName,
        env: publicExport.env,
      };
    }

    if (!name.includes("/")) {
      const exported = this.interpreter.moduleRegistry.resolveUniqueExport(name);
      if (exported && exported !== "ambiguous") {
        return {
          value: exported.value,
          moduleName: exported.moduleName,
          env: exported.env,
        };
      }
    }

    return undefined;
  }

  private commandHead(command: string): string | undefined {
    const source = command.trim().startsWith("(") ? command : `(${command})`;
    try {
      const expr = this.interpreter.parse(source);
      if (expr.type !== "list") return undefined;
      const elements = expr.value as TLispValue[];
      const head = elements[0];
      return head?.type === "symbol" ? head.value as string : undefined;
    } catch {
      return undefined;
    }
  }

  executeCommand(command: string): unknown {
    try {
      this.applyUpdate({ type: "SetLastCommand", command });
      const result = this.interpreter.execute(command);
      if (Either.isRight(result)) {
        return result;
      }

      // Handle eval error with diagnostic rendering
      const err = result.left;
      if (err.message === 'EDITOR_QUIT_SIGNAL') {
        throw new Error('EDITOR_QUIT_SIGNAL');
      }
      if (err.diagnostic) {
        this.applyUpdate({ type: "SetStatusMessage", message: `[${err.diagnostic.code}] ${err.message}` });
        this.logMessage(renderDiagnostic(err.diagnostic), 'error', this.model.lastCommand);
      } else {
        this.applyUpdate({ type: "SetStatusMessage", message: err.message });
        this.logMessage(err.message, 'error', this.model.lastCommand);
      }

      const source = command.trim().startsWith("(") ? command : `(${command})`;
      const head = this.commandHead(source);
      if (!head) return result;

      const callable = this.resolveCallable(head);
      if (!callable?.env || callable.value.type !== "function") {
        return result;
      }

      const expr = this.interpreter.parse(source);
      return this.interpreter.eval(expr, callable.env);
    } catch (error) {
      if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
        throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal
      }
      this.applyUpdate({ type: "SetStatusMessage", message: `Error: ${error instanceof Error ? error.message : String(error)}` });
      this.logMessage(this.model.statusMessage, 'error', this.model.lastCommand);
      throw error;
    }
  }

  async executeCommandAsync(command: string): Promise<unknown> {
    try {
      this.applyUpdate({ type: "SetLastCommand", command });
      const result = await this.interpreter.executeAsync!(command);
      if (Either.isRight(result)) {
        return result;
      }

      const err = result.left;
      const source = command.trim().startsWith("(") ? command : `(${command})`;
      const head = this.commandHead(source);
      const callable = head ? this.resolveCallable(head) : undefined;
      if (callable?.env && callable.value.type === "function") {
        const expr = this.interpreter.parse(source);
        return this.interpreter.evalAsync!(expr, callable.env);
      }

      if (err.message === 'EDITOR_QUIT_SIGNAL') {
        throw new Error('EDITOR_QUIT_SIGNAL');
      }
      if (err.diagnostic) {
        this.applyUpdate({ type: "SetStatusMessage", message: `[${err.diagnostic.code}] ${err.message}` });
        this.logMessage(renderDiagnostic(err.diagnostic), 'error', this.model.lastCommand);
      } else {
        this.applyUpdate({ type: "SetStatusMessage", message: err.message });
        this.logMessage(err.message, 'error', this.model.lastCommand);
      }
      return result;
    } catch (error) {
      if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
        throw new Error("EDITOR_QUIT_SIGNAL");
      }
      this.applyUpdate({ type: "SetStatusMessage", message: `Error: ${error instanceof Error ? error.message : String(error)}` });
      this.logMessage(this.model.statusMessage, 'error', this.model.lastCommand);
      throw error;
    }
  }

  /**
   * Normalize key input for consistent mapping
   * @param key - Raw key input
   * @returns Normalized key string
   */
  private normalizeKey(key: string): string {
    // Handle Alt/Meta key sequences (ESC + char)
    if (key.startsWith("\x1b") && key.length > 1) {
      const char = key.slice(1);
      return `M-${char}`;
    }

    // Convert common escape sequences to readable names
    switch (key) {
      case "\x01": return "C-a";
      case "\x02": return "C-b";
      case "\x03": return "C-c";
      case "\x04": return "C-d";
      case "\x05": return "C-e";
      case "\x06": return "C-f";
      case "\x07": return "C-g";
      case "\x08": return "Backspace";
      case "\x09": return "Tab";
      case "\x0a": return "Enter";
      case "\x0b": return "C-k";
      case "\x0c": return "C-l";
      case "\x0d": return "Enter";
      case "\x0e": return "C-n";
      case "\x0f": return "C-o";
      case "\x10": return "C-p";
      case "\x11": return "C-q";
      case "\x12": return "C-r";
      case "\x13": return "C-s";
      case "\x14": return "C-t";
      case "\x15": return "C-u";
      case "\x16": return "C-v";
      case "\x17": return "C-w";
      case "\x18": return "C-x";
      case "\x19": return "C-y";
      case "\x1a": return "C-z";
      case "\x1b": return "Escape";
      case "\x7f": return "Backspace";
      case "\r": return "Enter";
      case "\n": return "Enter";
      case "\t": return "Tab";
      default: return key;
    }
  }

  /**
   * Escape special characters for safe inclusion in T-Lisp string literals
   */
  escapeKeyForTLisp(key: string): string {
    // Escape special characters for T-Lisp string literals
    return key
      .replace(/\\/g, "\\\\")  // Escape backslashes first
      .replace(/"/g, '\\"')    // Escape double quotes
      .replace(/\n/g, "\\n")   // Escape newlines
      .replace(/\t/g, "\\t")   // Escape tabs
      .replace(/\r/g, "\\r");  // Escape carriage returns
  }

  /**
   * Handle key input
   * @param key - Key pressed
   */
  async handleKey(key: string): Promise<void> {
    const keyLog = log.module('editor').fn('handleKey');

    // Log key press in DEBUG mode (can be very verbose)
    const previousMode = this.model.mode;
    keyLog.debug(`Key pressed: ${key}`, {
      data: {
        key,
        normalizedKey: this.normalizeKey(key),
        currentMode: previousMode,
        cursorPosition: this.model.cursorPosition
      }
    });

    // Ensure core bindings are loaded before processing keys
    await this.ensureCoreBindingsLoaded();

    const normalizedKey = this.normalizeKey(key);

    // Dispatch to mode-specific handlers
    switch (this.model.mode) {
      case "normal":
        await handleNormalMode(this, key, normalizedKey);
        break;
      case "insert":
        await handleInsertMode(this, key, normalizedKey);
        break;
      case "visual":
        await handleVisualMode(this, key, normalizedKey);
        break;
      case "command":
        await handleCommandMode(this, key, normalizedKey);
        break;
      case "mx":
        await handleMxMode(this, key, normalizedKey);
        break;
      case "replace":
        await handleReplaceMode(this, key, normalizedKey);
        break;
      default:
        // Handle unknown mode as normal mode
        await handleNormalMode(this, key, normalizedKey);
        break;
    }

    // Log mode changes (INFO level)
    if (previousMode !== this.model.mode) {
      keyLog.info(`Mode changed: ${previousMode} → ${this.model.mode}`, {
        data: {
          previousMode,
          newMode: this.model.mode,
          triggerKey: key
        }
      });
    }

    // Log errors
    if (this.model.statusMessage?.includes('Error')) {
      keyLog.error('Editor error occurred', undefined, {
        operation: 'handleKeyPress',
        data: { statusMessage: this.model.statusMessage, key }
      });
    }

    // Notify attached frontends (e.g. embedded SteepFrontend) so that input
    // arriving over the socket (tmaxclient --keys), which bypasses the local
    // stdin render path, still triggers a re-render.
    this.notifyStateChange();
  }

  /**
   * Log a message to the *Messages* buffer
   */
  logMessage(msg: string, level: LogLevel = 'info', command?: string, frameId?: string): void {
    this.logging.logMessage(msg, level, command, frameId);
  }

  /**
   * Set the transient status-line message WITHOUT logging it (SPEC-055 two-tier
   * split). Use for deliberately-ephemeral messages: which-key hints, prompts,
   * prefixes. Contrast with logMessage, which logs + echoes.
   */
  setEchoOnly(text: string): void {
    this.applyUpdate({ type: "SetStatusMessage", message: text });
  }

  /**
   * Log a daemon lifecycle event to the *daemon* buffer (SPEC-047). Records
   * the event in the unified store under category='daemon' and refreshes the
   * *daemon* virtual buffer. Connection events are info level, so they never
   * mirror into *Messages* (the SPEC-047 anti-pollution guarantee holds).
   */
  logDaemonEvent(event: string, detail?: string): void {
    this.logging.logDaemonEvent(event, detail);
  }

  /**
   * Log a program-run event (shell/process/test/autosave) to its category
   * buffer (SPEC-055). The mirror rule automatically surfaces warn/error
   * entries into *Messages*, so callers do not mirror by hand.
   */
  logProgram(category: 'shell' | 'process' | 'test' | 'autosave', entry: Omit<LogEntry, 'ts' | 'category'> & { ts?: number }): void {
    this.logging.logProgram(category, entry);
  }

  /**
   * Flush the log to disk (SPEC-055). Append-per-write already persists every
   * entry, so this is belt-and-suspenders for graceful shutdown — currently a
   * no-op kept as the documented hook for a future periodic-flush strategy.
   */
  flushLog(): void {
    this.logging.flushLog();
  }

  /** Accessor for the daemon log (view-bound to *daemon*). Used by tests + future introspection. */
  getDaemonLog(): ViewBoundLog {
    return this.logging.getDaemonLog();
  }

  /**
   * Replace editor-local buffers/layout with the given workspace while keeping
   * daemon-global interpreter, keymaps, and message log intact.
   */
  applyWorkspace(workspace: WorkspaceState): void {
    this.currentWorkspace = workspace;

    // R3-1: Build reverse index from OLD workspace buffers before deep-copy.
    // After deep-copy, identity checks fail because new instances are created.
    const oldBufferNames = new Map<FunctionalTextBuffer, string>();
    for (const [name, buf] of workspace.buffers.entries()) {
      oldBufferNames.set(buf, name);
    }

    // CHORE-44 Change 3: the reconcile algorithm (deep-copy buffers + rebuild
    // metadata/mode-state maps) lives in WorkspaceRuntime (AC3.4). Mutate the
    // existing buffers/bufferMetadata maps in place (other refs hold them).
    const reconciled = this.workspaceRuntime.reconcileWorkspace(
      workspace,
      this.bufferRecency,
      this.logging.log.render('messages', { fullDate: true }),
    );
    this.buffers.clear();
    for (const [name, buf] of reconciled.buffers) this.buffers.set(name, buf);
    this.bufferMetadata.clear();
    for (const [name, meta] of reconciled.bufferMetadata) this.bufferMetadata.set(name, meta);
    this.bufferModeStates = reconciled.bufferModeStates;
    this.bufferRecency = reconciled.nextRecency;

    const bufferName = workspace.currentBufferName ?? '*scratch*';
    const buffer = this.buffers.get(bufferName) ?? this.buffers.get('*scratch*') ?? FunctionalTextBufferImpl.create('');
    if (!this.buffers.has(bufferName)) {
      this.buffers.set(bufferName, buffer);
      this.updateBufferMetadata(bufferName, { modified: false });
    }

    this.applyUpdate({ type: "SetCurrentBuffer", buffer });
    this.applyUpdate({ type: "SetCurrentFilename", filename: workspace.currentFilename ?? this.bufferMetadata.get(bufferName)?.filename });
    this.applyUpdate({ type: "SetCursorPosition", position: { ...workspace.cursorState } });
    this.applyUpdate({ type: "SetViewportTop", top: workspace.viewportState.top });
    this.applyUpdate({ type: "SetViewportLeft", left: workspace.viewportState.left ?? 0 });
    // R3-1: use oldBufferNames reverse index to resolve buffer names,
    // then look up the new deep-copied instance from this.buffers
	    const defaultWindow: Window = {
	      id: 'window-main',
	      buffer,
	      bufferName,
	      cursorLine: this.model.cursorPosition.line,
	      cursorColumn: this.model.cursorPosition.column,
	      viewportTop: this.model.viewportTop,
	      viewportLeft: this.model.viewportLeft ?? 0,
	      height: this.terminal.getSize().height - 2,
	      width: this.terminal.getSize().width,
	    };
	    const windows = workspace.windows.length > 0
	      ? workspace.windows.map(w => {
	        const resolvedName = oldBufferNames.get(w.buffer) ?? '*scratch*';
	        return { ...w, buffer: this.buffers.get(resolvedName) ?? buffer, bufferName: resolvedName };
	      })
	      : [defaultWindow];
	    const tabs = workspace.tabs?.length > 0
	      ? workspace.tabs.map(t => {
	        const resolvedName = oldBufferNames.get(t.buffer) ?? '*scratch*';
	        return { ...t, buffer: this.buffers.get(resolvedName) ?? buffer, bufferName: resolvedName };
	      })
	      : [];

	    this.applyUpdate({ type: "SetWindows", windows });
	    this.applyUpdate({ type: "SetCurrentWindowIndex", index: 0 });
	    this.applyUpdate({ type: "SetTabs", tabs });
	    this.applyUpdate({ type: "SetCurrentTabIndex", index: 0 });
    // Sync-back bridge: model.buffers must keep the SAME Map reference as
    // this.buffers so subsequent this.buffers.set/delete stay visible to the
    // model. SetBuffers copies (new Map), which would desync the two.
    this.model = { ...this.model, buffers: this.buffers };
    this.applyUpdate({ type: "SetMode", mode: 'normal' }); // I10: reset mode on workspace switch

    // I4: re-detect major mode for the active buffer
    if (this.model.currentFilename) {
      this.activateMajorModeForFile(this.model.currentFilename);
    }
  }

  /**
   * Snapshot the editor-local buffers/layout back into workspace-owned state.
   * N8: returned buffers are live references — consumers that need isolation
   * must deep-copy (applyWorkspace does this on the receiving end).
   */
  exportWorkspace(base?: WorkspaceState): WorkspaceState {
    // CHORE-44 Change 3: the workspace serialization algorithm lives in the
    // WorkspaceRuntime collaborator (AC3.4); Editor supplies a state snapshot.
    const currentBufferName = this.findBufferName(this.model.currentBuffer) ?? base?.currentBufferName ?? '*scratch*';
    const activeMinorModes = this.getCurrentModeState().activeMinorModes;
    return this.workspaceRuntime.serializeWorkspace({
      buffers: this.buffers,
      bufferMetadata: this.bufferMetadata,
      bufferModeStates: this.bufferModeStates,
      minorModeRegistry: this.minorModeRegistry,
      model: this.model,
      currentBufferName,
      currentMajorMode: this.getCurrentMajorMode(),
      activeMinorModes,
      base,
    });
  }

  /**
   * Create a new buffer
   * @param name - Buffer name
   * @param content - Initial content
   */
  createBuffer(name: string, content: string = ""): void {
    const buffer = FunctionalTextBufferImpl.create(content);
    this.buffers.set(name, buffer);
    this.updateBufferMetadata(name, { modified: false, recency: this.bufferRecency++ });

    // Always set currentBuffer to the newly created buffer
    this.applyUpdate({ type: "SetCurrentBuffer", buffer });

    // Initialize first window if this is the first buffer (US-3.2.1)
    if (!this.model.windows || this.model.windows.length === 0) {
      // Get terminal size for window dimensions (US-3.2.2)
      const terminalSize = this.terminal.getSize();
      const initialWindow: Window = {
        id: "window-main",
        buffer: buffer,
        bufferName: this.findBufferName(buffer),
        cursorLine: this.model.cursorPosition.line,
        cursorColumn: this.model.cursorPosition.column,
        viewportTop: this.model.viewportTop,
        viewportLeft: this.model.viewportLeft ?? 0,
        height: terminalSize.height - 2, // Reserve space for status line and minibuffer
        width: terminalSize.width,
      };
      this.applyUpdate({ type: "SetWindows", windows: [initialWindow] });
      this.applyUpdate({ type: "SetCurrentWindowIndex", index: 0 });
    } else {
      // Update current window's buffer
      const currentWindow = this.model.windows[this.model.currentWindowIndex ?? 0];
      if (currentWindow) {
        currentWindow.buffer = buffer;
        currentWindow.bufferName = this.findBufferName(buffer);
        // Sync window cursor with global cursor position
        currentWindow.cursorLine = this.model.cursorPosition.line;
        currentWindow.cursorColumn = this.model.cursorPosition.column;
        currentWindow.viewportTop = this.model.viewportTop;
      }
    }
  }

  /**
   * Open a file (CHORE-42: the read is dispatched as an owner-`'openFile'`
   * `OpenFile` Cmd through the live effect layer; the public contract is
   * unchanged — a failed read updates status/logs, leaves the previous buffer
   * intact, and resolves rather than rejects).
   * @param filename - File to open
   */
  async openFile(filename: string): Promise<void> {
    const commandId = globalThis.crypto.randomUUID();
    const completion = this.trackCommand(commandId);
    this.applyUpdate({ type: "OpenFile", commandId, owner: "openFile", filename });
    const outcome = await completion;
    if (outcome.status === "failed") {
      // OpenFileFailed reducer already recorded the failure status; mirror the
      // prior log behavior (impure) and leave the previous buffer intact.
      this.logMessage(`Failed to open ${filename}: ${outcome.error.message}`, 'error');
      return;
    }
    const content = outcome.content ?? "";
    this.createBuffer(filename, content);
    // Track the filename for save operations
    this.applyUpdate({ type: "SetCurrentFilename", filename });
    const name = this.findBufferName(this.model.currentBuffer);
    if (name) this.updateBufferMetadata(name, { filename, modified: false });

    // Notify LSP client about file open (US-3.1.1)
    await this.lspClient.onFileOpen(filename, content);

    // Simulate diagnostics from language server (US-3.1.2)
    await this.lspClient.simulateDiagnostics(filename, content);

    // Update editor state with diagnostics (US-3.1.2)
    this.applyUpdate({ type: "SetLspDiagnostics", diagnostics: this.lspClient.getDiagnostics() });

    // Update status message with LSP connection status (US-3.1.1)
    const lspStatus = this.lspClient.getStatusMessage();
    this.applyUpdate({ type: "SetStatusMessage", message: lspStatus ? `Opened ${filename} - ${lspStatus}` : `Opened ${filename}` });
    this.logMessage(`Opened ${filename}`, 'info');

    // SPEC-035: Auto-detect and activate major mode
    this.activateMajorModeForFile(filename);

    // SPEC-013: Parse AST for code awareness
    try {
      this.executeCommand("(ast-parse-buffer)");
    } catch (_) {
      // Non-critical: AST features unavailable if parse fails
    }

    this.recomputeHighlights();
  }

  /**
   * Save current buffer (CHORE-42: the write is dispatched as an
   * owner-`'saveFile'` `SaveFile` Cmd through the live effect layer; the
   * public contract is unchanged — non-write early returns stay non-write, and
   * a failed write updates status/logs, keeps the modified flag set, and
   * resolves rather than rejects).
   * @param filename - Optional filename to save to (overrides current filename)
   */
  async saveFile(filename?: string): Promise<void> {
    if (!this.model.currentBuffer) {
      this.applyUpdate({ type: "SetStatusMessage", message: "No buffer to save" });
      return;
    }

    // Use provided filename or fall back to tracked filename
    const saveFilename = filename || this.model.currentFilename;
    if (!saveFilename) {
      this.applyUpdate({ type: "SetStatusMessage", message: "Buffer has no associated file" });
      return;
    }

    // Capture content before dispatch — the SaveFile Cmd requires it, and the
    // buffer must not change between read and write.
    const contentResult = this.model.currentBuffer.getContent();
    if (Either.isLeft(contentResult)) {
      const gfMsg = `Failed to get content: ${contentResult.left}`;
      this.applyUpdate({ type: "SetStatusMessage", message: gfMsg });
      // SPEC-055: route save errors through the log so they don't vanish.
      this.logMessage(gfMsg, 'error');
      return;
    }

    const commandId = globalThis.crypto.randomUUID();
    const completion = this.trackCommand(commandId);
    this.applyUpdate({ type: "SaveFile", commandId, owner: "saveFile", filename: saveFilename, content: contentResult.right });
    const outcome = await completion;
    if (outcome.status === "failed") {
      // SaveFileFailed reducer already recorded the failure status; mirror the
      // prior log behavior and keep the modified flag set.
      this.logMessage(`Failed to save ${saveFilename}: ${outcome.error.message}`, 'error');
      return;
    }
    // Success: SaveFileSucceeded reducer set status "Saved X" + cleared the
    // model modified flag. Reconcile Editor-side tracking + metadata.
    if (filename && !this.model.currentFilename) {
      this.applyUpdate({ type: "SetCurrentFilename", filename });
    }
    this.setCurrentBufferModified(false);
    this.logMessage(`Saved ${saveFilename}`, 'info');
  }

  /**
   * Get the current buffer key for mode state lookup
   */
  getCurrentBufferKey(): string {
    return this.model.currentFilename ?? "*scratch*";
  }

  /**
   * Get buffer-local mode state for the current buffer
   */
  getCurrentModeState(): BufferModeState {
    const state = getOrCreateModeState(this.bufferModeStates, this.getCurrentBufferKey());
    const withGlobals = applyGlobalMinorModes(state, this.globalizedMinorModes);
    if (withGlobals !== state) Object.assign(state, withGlobals);
    return state;
  }

  /**
   * Set the current buffer's major mode
   */
  setCurrentMajorMode(modeName: string): void {
    const key = this.getCurrentBufferKey();
    const state = getOrCreateModeState(this.bufferModeStates, key);
    state.majorMode = modeName;
  }

  /**
   * Get the current buffer's major mode
   */
  getCurrentMajorMode(): string {
    return this.getCurrentModeState().majorMode;
  }

  /**
   * Register a minor mode configuration
   */
  registerMinorMode(config: MinorModeConfig): void {
    this.minorModeRegistry.set(config.name, config);
  }

  /**
   * Get the minor mode registry
   */
  getMinorModeRegistry(): Map<string, MinorModeConfig> {
    return this.minorModeRegistry;
  }

  /**
   * Get buffer mode states map
   */
  getBufferModeStates(): Map<string, BufferModeState> {
    return this.bufferModeStates;
  }

  /**
   * Get globalized minor modes
   */
  getGlobalizedMinorModes(): Set<string> {
    return this.globalizedMinorModes;
  }

  /**
   * Get auto-mode rules. CHORE-44 Change 1: delegates to the model-held
   * per-editor auto-mode rules (`model.session.majorMode.autoModeRules`),
   * which `major-mode-register`/`auto-mode-add` mutate in place.
   */
  getAutoModeRules(): AutoModeRule[] {
    return this.model.session.majorMode.autoModeRules;
  }

  /**
   * Get load paths
   */
  getLoadPaths(): string[] {
    return [...this.model.loadPaths];
  }

  /**
   * Get current module name (for module introspection)
   */
  getCurrentModuleName(): string | undefined {
    return this.model.currentModuleName;
  }

  /**
   * Update viewport to ensure cursor is visible
   * This method is now used by React components to manage viewport
   */
  updateViewport(): void {
    // This method is kept for compatibility with React components
    // The actual viewport management is now handled by BufferView component
  }

  /**
   * Subscribe to editor state changes. The listener is invoked after
   * handleKey mutates state, so an attached frontend (e.g. the embedded
   * SteepFrontend in main.tsx) can re-render in response to socket-driven
   * input (`tmaxclient --keys`) that bypasses its own stdin. Returns an
   * unsubscribe function.
   */
  onStateChange(listener: () => void): () => void {
    this.stateChangeListeners.push(listener);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter(l => l !== listener);
    };
  }

  /** Notify subscribers that editor state changed (called at end of handleKey). */
  private notifyStateChange(): void {
    for (const listener of this.stateChangeListeners) {
      try { listener(); } catch { /* a frontend listener must not break input */ }
    }
  }

  // ── Functional core bridge (CHORE-39) ───────────────────────────────
  // The editor's deterministic state lives in `this.model` (EditorModel).
  // `applyUpdate` dispatches a Msg through the pure `update` reducer, commits
  // the result, enqueues any returned Cmds (via the command-runtime
  // collaborator), and fires state-change listeners exactly once for that
  // committed change. The drain runs queued Cmds asynchronously and feeds
  // follow-up Msgs back through `applyUpdate` (CHORE-44 Change 3: the queue,
  // drain loop, ownership waiters, and outcome classification live in
  // `command-runtime.ts`; the methods below are one-line facades so the
  // public/private prototype inventory is unchanged).

  /** Canonical typed read access to the editor model. */
  getModel(): EditorModel {
    return this.model;
  }

  /**
   * Commit a fresh model produced by a State-monad computation (CHORE-39
   * Phase 4). Used by API primitives that run `State<EditorModel, A>` against
   * the live model via `runModel`.
   */
  applyModel(model: EditorModel): void {
    this.model = model;
  }

  /** Typed access to the terminal (used by handlers). */
  getTerminal(): TerminalIO {
    return this.terminal;
  }

  /**
   * Dispatch a Msg through the pure reducer, commit the resulting model,
   * enqueue any returned Cmds (via {@link enqueueCmd}, so the live effect
   * layer is the single ingress to the drain), and fire state-change
   * listeners once. Returns the committed model synchronously.
   */
  applyUpdate(msg: Msg): EditorModel {
    const result = update(this.model, msg);
    this.model = result.model;
    for (const cmd of result.cmds) this.enqueueCmd(cmd);
    this.notifyStateChange();
    return this.model;
  }

  /** Enqueue a Cmd directly (e.g. from a handler) and kick the drain. */
  enqueueCmd(cmd: Cmd): void {
    this.commandRuntime.enqueueCmd(cmd);
  }

  /**
   * Register an ownership waiter so a public method can `await` the drain's
   * settlement for `commandId`. Must be called BEFORE dispatching the
   * initiating Msg so the waiter is present when the drain settles it.
   */
  private trackCommand(commandId: string): Promise<CommandOutcome> {
    return this.commandRuntime.trackCommand(commandId);
  }

  /**
   * Map a settled Cmd's `runCmd` result to the outcome the awaiting owner
   * sees. CHORE-44 Change 3: the classification algorithm lives in the
   * command-runtime collaborator; this is a one-line facade.
   */
  private classifyCommand(result: Either<AppError, readonly Msg[]>): CommandOutcome {
    return this.commandRuntime.classifyCommand(result);
  }

  /** Drain queued Cmds sequentially; follow-up Msgs commit via applyUpdate. */
  private async drainCommands(): Promise<void> {
    await this.commandRuntime.drainCommands();
  }

  /** The EditorRuntime capability surface used by Cmd runners. */
  getRuntime(): EditorRuntime {
    const self = this;
    return {
      evalTlisp: (expr: string): Either<AppError, TLispValue> => {
        try {
          return Either.right<TLispValue, AppError>(self.executeCommand(expr) as TLispValue);
        } catch (error) {
          return Either.left<AppError, TLispValue>(self.toAppError(error));
        }
      },
      evalTlispAsync: async (expr: string): Promise<Either<AppError, TLispValue>> => {
        try {
          const value = await self.executeCommandAsync(expr);
          return Either.right<TLispValue, AppError>(value as TLispValue);
        } catch (error) {
          return Either.left<AppError, TLispValue>(self.toAppError(error));
        }
      },
      readFile: async (path: string): Promise<Either<AppError, string>> => {
        try {
          const content = await self.filesystem.readFile(path);
          return Either.right<string, AppError>(content);
        } catch (error) {
          return Either.left<AppError, string>(self.toAppError(error));
        }
      },
      writeFile: async (path: string, content: string): Promise<Either<AppError, void>> => {
        try {
          await self.filesystem.writeFile(path, content);
          return Either.right<void, AppError>(undefined);
        } catch (error) {
          return Either.left<AppError, void>(self.toAppError(error));
        }
      },
      logMessage: (message, level) => { self.logMessage(message, level); },
      logProgram: (_category, entry) => { self.logMessage(entry.text); },
      toAppError: (error: unknown) => self.toAppError(error),
    };
  }

  /** Coerce a thrown value into a typed AppError. */
  private toAppError(error: unknown): AppError {
    if (error && typeof error === "object" && "type" in error && typeof (error as { type?: unknown }).type === "string") {
      return error as AppError;
    }
    return createValidationError("ConstraintViolation", error instanceof Error ? error.message : String(error));
  }

  /**
   * Get editor state for React components
   */
  getEditorState(): EditorState {
    const modeState = this.getCurrentModeState();
    // modelToEditorState clones mutable collections so callers cannot mutate
    // internal model state through retained references.
    const base = modelToEditorState(this.model);
    return {
      ...base,
      cursorFocus: this.model.cursorFocus ?? 'buffer',
      currentMajorMode: modeState.majorMode,
      activeMinorModes: [...modeState.activeMinorModes],
      activeMinorModeLighters: modeState.activeMinorModes
        .map((m) => this.minorModeRegistry.get(m)?.lighter ?? "")
        .filter((l) => l !== ""),
      minibufferState: cloneJsonValue(this.model.minibufferState),
      minibufferView: this.model.minibufferView ? structuredClone(this.model.minibufferView) : undefined,
    };
  }

  /**
   * Set editor state from React components
   */
  setEditorState(newState: EditorState): void {
    const previousBufferKey = this.getCurrentBufferKey();
    const nextBufferKey = newState.currentFilename ?? "*scratch*";
    const hasExistingModeState = this.bufferModeStates.has(nextBufferKey);

    // Bulk ingress of caller-owned EditorState. Routed as one
    // SetEditorStateExternal dispatch whose reducer just spreads the patch
    // (no defensive cloning beyond the explicit minibuffer clones below),
    // preserving the prior line-by-line direct-commit semantics.
    const currentBufferName = this.findBufferName(newState.currentBuffer);
    this.applyUpdate({
      type: "SetEditorStateExternal",
      patch: {
        currentBuffer: newState.currentBuffer,
        cursorPosition: newState.cursorPosition,
        mode: newState.mode,
        statusMessage: newState.statusMessage,
        viewportTop: newState.viewportTop,
        viewportLeft: newState.viewportLeft ?? 0,
        config: newState.config,
        currentFilename: newState.currentFilename,
        commandLine: newState.commandLine ?? this.model.commandLine,
        mxCommand: newState.mxCommand ?? this.model.mxCommand,
        minibufferState: cloneJsonValue(newState.minibufferState),
        minibufferView: newState.minibufferView ? structuredClone(newState.minibufferView) : undefined,
        cursorFocus: newState.cursorFocus ?? this.model.cursorFocus,
      },
    });
    if (currentBufferName && newState.currentFilename !== undefined) {
      this.updateBufferMetadata(currentBufferName, { filename: newState.currentFilename });
    }
    if (newState.buffers && newState.buffers !== this.buffers) {
      this.buffers.clear();
      for (const [name, buffer] of newState.buffers.entries()) {
        this.buffers.set(name, buffer as FunctionalTextBufferImpl);
      }
    }
    // Sync-back bridge: model.buffers must reference the shared this.buffers
    // map so this.buffers mutations stay visible to the model. SetBuffers would
    // copy (new Map) and desync the two.
    this.model = { ...this.model, buffers: this.buffers };
    if (newState.currentMajorMode || newState.activeMinorModes || newState.activeMinorModeLighters) {
      if (previousBufferKey !== nextBufferKey && hasExistingModeState) {
        return;
      }
      const modeState = this.getCurrentModeState();
      if (newState.currentMajorMode) modeState.majorMode = newState.currentMajorMode;
      if (newState.activeMinorModes) {
        modeState.activeMinorModes = [...newState.activeMinorModes];
        modeState.minorModeActivationOrder = [...newState.activeMinorModes];
      }
    }
  }

  private findBufferName(buffer: FunctionalTextBuffer | undefined): string | undefined {
    if (!buffer) return undefined;
    for (const [name, candidate] of this.buffers) {
      if (candidate === buffer) return name;
    }
    return undefined;
  }

  clearModifiedFlags(): void {
    for (const [name, meta] of this.bufferMetadata.entries()) {
      if (meta.modified) {
        this.bufferMetadata.set(name, { ...meta, modified: false });
      }
    }
  }

  markBuffersModified(names: string[]): void {
    for (const name of names) {
      this.updateBufferMetadata(name, { modified: true });
    }
    const currentName = this.findBufferName(this.model.currentBuffer);
    if (currentName && names.includes(currentName)) {
      this.applyUpdate({ type: "SetBufferModified", modified: true });
    }
  }

  private updateBufferMetadata(
    name: string,
    update: Partial<{ filename?: string; modified: boolean; recency: number }>,
  ): void {
    const current = this.bufferMetadata.get(name) ?? { modified: false, recency: this.bufferRecency++ };
    this.bufferMetadata.set(name, { ...current, ...update });
  }

  private touchBuffer(name: string): void {
    this.updateBufferMetadata(name, { recency: this.bufferRecency++ });
  }

  private getCurrentBufferModified(): boolean {
    const name = this.findBufferName(this.model.currentBuffer);
    return name ? this.bufferMetadata.get(name)?.modified ?? false : false;
  }

  private setCurrentBufferModified(modified: boolean): void {
    const name = this.findBufferName(this.model.currentBuffer);
    if (name) this.updateBufferMetadata(name, { modified });
    this.applyUpdate({ type: "SetBufferModified", modified });
  }

  private getModeStateForBufferName(name: string): BufferModeState {
    return getOrCreateModeState(this.bufferModeStates, this.bufferMetadata.get(name)?.filename ?? name);
  }

  private minibufferViewFromTlisp(value: TLispValue): MinibufferRenderView {
    if (value.type !== "hashmap") throw new Error("minibuffer view must be a hashmap");
    const map = value.value as Map<string, TLispValue>;
    const stringValue = (key: string): string => {
      const entry = map.get(key);
      return entry?.type === "string" ? entry.value as string : "";
    };
    const rowsValue = map.get("rows");
    const rows = rowsValue?.type === "list"
      ? (rowsValue.value as TLispValue[]).flatMap(row => {
        if (row.type !== "hashmap") return [];
        const rowMap = row.value as Map<string, TLispValue>;
        const segmentsValue = rowMap.get("segments");
        const segments = segmentsValue?.type === "list"
          ? (segmentsValue.value as TLispValue[]).flatMap(segment => {
            if (segment.type !== "hashmap") return [];
            const segmentMap = segment.value as Map<string, TLispValue>;
            const text = segmentMap.get("text");
            const face = segmentMap.get("face");
            if (text?.type !== "string") return [];
            return [{
              text: text.value as string,
              ...(face?.type === "string" ? { face: face.value as string } : {}),
            }];
          })
          : [];
        return [{
          selected: rowMap.get("selected")?.type === "boolean" && rowMap.get("selected")?.value === true,
          segments,
        }];
      })
      : [];
    const inputPoint = map.get("input-point");
    return {
      prompt: stringValue("prompt"),
      input: stringValue("input"),
      inputPoint: inputPoint?.type === "number" ? inputPoint.value as number : stringValue("input").length,
      rows,
      message: stringValue("message"),
    };
  }

  /**
   * Update terminal size - called when terminal dimensions change
   * @param width - New terminal width
   * @param height - New terminal height
   */
  updateTerminalSize(width: number, height: number): void {
    // Check if terminal has updateSize method (InkTerminalIO does)
    const terminalIO = this.terminal as { updateSize?: (width: number, height: number) => void };
    if (typeof terminalIO.updateSize === 'function') {
      terminalIO.updateSize(width, height);
    }
  }

  /**
   * Start the editor
   * Note: In React UI mode, this method is used for initialization only
   * The main event loop is handled by React components
   */
  async start(): Promise<void> {
    this.running = true;

    // Load core bindings and user init file
    await this.ensureCoreBindingsLoaded();
    await this.loadInitFile(this.currentInitFile || undefined);

    // Load saved macros from ~/.config/tmax/macros.tlisp (US-2.4.2)
    await this.loadSavedMacros();

    // Create default buffer if no editable buffer is selected. The messages
    // buffer is created during logging and must not suppress scratch startup.
    if (!this.model.currentBuffer) {
      this.createBuffer("*scratch*", "");
    }
  }

  /**
   * Stop the editor
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Get current editor state (for testing)
   */
  getState(): EditorState {
    return this.getEditorState();
  }

  /**
   * Return factual metadata for every live buffer.
   */
  getBufferDetails(): Array<{
    name: string;
    content: string;
    filename?: string;
    majorMode: string;
    modified: boolean;
    characters: number;
    lines: number;
    current: boolean;
    special: boolean;
    recency: number;
  }> {
    const currentName = this.findBufferName(this.model.currentBuffer);
    return Array.from(this.buffers.entries()).map(([name, buffer]) => {
      const content = buffer.getContent();
      const text = Either.isRight(content) ? content.right : "";
      const lineCount = buffer.getLineCount();
      const metadata = this.bufferMetadata.get(name) ?? { modified: false, recency: 0 };
      return {
        name,
        content: text,
        ...(metadata.filename ? { filename: metadata.filename } : {}),
        majorMode: this.getModeStateForBufferName(name).majorMode,
        modified: metadata.modified,
        characters: text.length,
        lines: Either.isRight(lineCount) ? lineCount.right : 0,
        current: name === currentName,
        special: name.startsWith("*") && name.endsWith("*"),
        recency: metadata.recency,
      };
    });
  }

  /**
   * Get T-Lisp interpreter (for testing)
   */
  getInterpreter(): TLispInterpreterImpl {
    return this.interpreter;
  }

  /**
   * Get the filesystem interface (for server/daemon use)
   */
  getFilesystem(): FileSystem {
    return this.filesystem;
  }

  /**
   * Look up a binding by name from the global environment chain.
   */
  lookupGlobalBinding(name: string): TLispValue | undefined {
    return this.interpreter.globalEnv.lookup(name);
  }

  /**
   * Get all visible global bindings (walking parent chain).
   */
  getAllGlobalBindings(): Map<string, TLispValue> {
    return this.collectVisibleGlobalBindings();
  }

  /**
   * Get names of all defined functions/macros in the global environment.
   */
  getGlobalFunctionNames(): string[] {
    const names: string[] = [];
    for (const [name, value] of this.collectVisibleGlobalBindings()) {
      if (value.type === 'function' || value.type === 'macro') {
        names.push(name);
      }
    }
    return names.sort();
  }

  /**
   * Get all variables (using *name* convention) from the global environment.
   */
  getGlobalVariables(): Record<string, any> {
    const variables: Record<string, any> = {};
    for (const [name, value] of this.collectVisibleGlobalBindings()) {
      if (name.startsWith('*') && name.endsWith('*')) {
        // Use the same JSON conversion the server uses
        // We return raw TLispValues; caller converts as needed
        variables[name] = value;
      }
    }
    return variables;
  }

  /**
   * Ensure core bindings are loaded (for server/daemon use).
   */
  async ensureCoreBindingsLoadedPublic(): Promise<void> {
    await this.ensureCoreBindingsLoaded();
  }

  /**
   * Load init file (for server/daemon use).
   */
  async loadInitFilePublic(initFilePath?: string): Promise<void> {
    await this.loadInitFile(initFilePath);
  }

  /**
   * Get the message log (for server/daemon use).
   */
  getMessageLog(): ViewBoundLog {
    return this.logging.getMessageLog();
  }

  /** Accessor for the unified Log store (SPEC-055). Used by the daemon query
   *  path for category/view/level filtering across all categories. */
  getUnifiedLog(): Log {
    return this.logging.getUnifiedLog();
  }

  /**
   * Get key mappings (for testing)
   */
  getKeyMappings(): Map<string, KeyMapping[]> {
    return this.keyMappings;
  }

  /**
   * Get which-key handle (for per-instance state)
   */
  getWhichKeyHandle(): WhichKeyHandle {
    return this.whichKeyHandle;
  }

  /**
   * Check if editor is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get current editor mode
   */
  getMode(): string {
    return this.model.mode;
  }

  /**
   * Get current count prefix
   * @returns Current count (0 if no count active)
   */
  getCount(): number {
    return this.model.countPrefix;
  }

  /**
   * Set count prefix value
   * @param count - Count value to set
   */
  setCount(count: number): void {
    this.model = { ...this.model, countPrefix: Math.max(0, count) };
  }

  /**
   * Reset count prefix to 0
   */
  resetCount(): void {
    this.model = { ...this.model, countPrefix: 0 };
  }

  /**
   * Check if count is active (greater than 0)
   * @returns true if count is active
   */
  isCountActive(): boolean {
    return this.model.countPrefix > 0;
  }

  /**
   * Consume and return the current count, then reset
   * @returns Current count (defaults to 1 if no count set)
   */
  consumeCount(): number {
    const count = this.model.countPrefix > 0 ? this.model.countPrefix : 1;
    this.model = { ...this.model, countPrefix: 0 };
    return count;
  }

  /**
   * Get current visual selection
   * @returns Visual selection or null if not in visual mode
   */
  getSelection(): any {
    return this.session.visual.get();
  }

  /**
   * Clear visual selection and exit visual mode
   */
  clearSelection(): void {
    this.session.visual.clear();
    this.applyUpdate({ type: "SetMode", mode: "normal" });
  }

  /**
   * Auto-detect and activate major mode based on filename (SPEC-035)
   */
  activateMajorModeForFile(filename: string): void {
    try {
      this.applyUpdate({ type: "SetCurrentFilename", filename });
      this.executeCommand("(major-mode-auto-detect)");
    } catch (_) {
      // No mode matched — keep fundamental mode
    }
  }

  /**
   * Recompute syntax highlight spans for visible viewport (SPEC-035).
   *
   * NOTE: As of the BUG-15 audit, `state.highlightSpans` has no production
   * consumer — the TUI client computes its own spans via `computeHighlightSpans`
   * in `src/client/tui-client.ts:62-64`. This method is kept correct for any
   * future consumer; whether to delete it as dead code is an open question
   * deferred to RFC-019 Tier 1.6 (daemon-side span caching).
   */
  recomputeHighlights(): void {
    if (!this.model.currentBuffer) {
      this.applyUpdate({ type: "SetHighlightSpans", spans: undefined });
      return;
    }

    try {
      const contentResult = this.model.currentBuffer.getContent();
      if (Either.isLeft(contentResult)) {
        this.applyUpdate({ type: "SetHighlightSpans", spans: undefined });
        return;
      }

      const lines = contentResult.right.split('\n');
      const startLine = this.model.viewportTop;
      // The daemon does not know the client's terminal height (the TUI client
      // computes its own spans), so fall back to a sensible default line count.
      // Previously this used `config.tabSize` (default 4) which is unrelated to
      // viewport height and caused the wrong window to be tokenized.
      const endLine = Math.min(startLine + HIGHLIGHT_RECOMPUTE_VIEWPORT_LINES, lines.length);

      // Use the T-Lisp API to highlight visible lines
      const spans: HighlightSpan[][] = [];
      for (let i = startLine; i < endLine; i++) {
        try {
          const result = this.executeCommand(`(syntax-highlight-line ${i})`) as { type: string; value: unknown } | null | undefined;
          if (result && typeof result === 'object' && result.type === 'list') {
            spans.push(result.value as HighlightSpan[]);
          } else {
            spans.push([]);
          }
        } catch (_) {
          spans.push([]);
        }
      }
      this.applyUpdate({ type: "SetHighlightSpans", spans: spans.length > 0 ? spans : undefined });
    } catch (_) {
      this.applyUpdate({ type: "SetHighlightSpans", spans: undefined });
    }
  }
}
