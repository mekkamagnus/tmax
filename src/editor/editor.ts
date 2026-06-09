/**
 * @file editor.ts
 * @description Core editor implementation with T-Lisp extensibility for React UI
 * This class manages the editor state and logic but delegates rendering to React components
 */

import { TLispInterpreterImpl } from "../tlisp/interpreter.ts";
import { FileSystemImpl } from "../core/filesystem.ts";
import { createEditorAPI, TlispEditorState } from "./tlisp-api.ts";
import type { EditorState, FunctionalTextBuffer, Window, HighlightSpan, MinibufferRenderView } from "../core/types.ts";
import { createString, createList, createNil, createNumber, createBoolean, createHashmap } from "../tlisp/values.ts";
import type { TerminalIO, FileSystem } from "../core/types.ts";
import type { TLispEnvironment, TLispValue, TLispFunctionImpl } from "../tlisp/types.ts";
import type { TLispFunction } from "../tlisp/types.ts";
import { Either } from "../utils/task-either.ts";
import { renderDiagnostic } from "../tlisp/diagnostic-renderer.ts";
import { FunctionalTextBufferImpl } from "../core/buffer.ts";
import { MessageLog, type LogLevel } from "./message-log.ts";
import { handleNormalMode } from "./handlers/normal-handler.ts";
import { handleInsertMode } from "./handlers/insert-handler.ts";
import { handleVisualMode } from "./handlers/visual-handler.ts";
import { handleCommandMode } from "./handlers/command-handler.ts";
import { handleMxMode } from "./handlers/mx-handler.ts";
import * as macroRecording from "./api/macro-recording.ts";
import { loadMacrosFromFile, saveMacrosToFile } from "./api/macro-persistence.ts";
import { LSPClient } from "../lsp/client.ts";
import { createWindowOps } from "./api/window-ops.ts";
import { createTabOps } from "./api/tab-ops.ts";
import { log } from "../utils/logger.ts";
import { KeymapSync } from "./keymap-sync.ts";
import { createKeymapOps } from "./api/keymap-ops.ts";
import { resetYankRegisterState } from "./api/yank-ops.ts";
import { resetDeleteRegisterState } from "./api/delete-ops.ts";
import { resetUndoRedoState } from "./api/undo-redo-ops.ts";
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

/**
 * Key mapping for editor commands
 */
export interface KeyMapping {
  key: string;
  command: string;
  mode?: "normal" | "insert" | "visual" | "command" | "mx";
  majorMode?: string;
}

/**
 * Resolve the best key mapping from candidates, considering editor mode
 * and major mode. Precedence: mode+majorMode > mode > majorMode > global.
 */
export function resolveMapping(
  mappings: KeyMapping[],
  editorMode: string,
  currentMajorMode?: string,
): KeyMapping | undefined {
  // 1. Exact match: editor mode + major mode
  if (currentMajorMode) {
    const exact = mappings.find(m => m.mode === editorMode && m.majorMode === currentMajorMode);
    if (exact) return exact;
  }
  // 2. Editor mode only (no major mode constraint)
  const modeOnly = mappings.find(m => m.mode === editorMode && !m.majorMode);
  if (modeOnly) return modeOnly;
  // 3. Major mode only (no editor mode constraint)
  if (currentMajorMode) {
    const majorOnly = mappings.find(m => !m.mode && m.majorMode === currentMajorMode);
    if (majorOnly) return majorOnly;
  }
  // 4. Global (no constraints)
  return mappings.find(m => !m.mode && !m.majorMode);
}

/**
 * Core editor implementation
 */
export class Editor {
  private state: EditorState;
  private buffers: Map<string, FunctionalTextBufferImpl> = new Map();
  private interpreter: TLispInterpreterImpl;
  private keyMappings: Map<string, KeyMapping[]>;
  private running: boolean = false;
  private coreBindingsLoaded: boolean = false;
  private terminal: TerminalIO;
  private filesystem: FileSystem;
  private countPrefix: number = 0;  // Accumulated count for count prefix commands
  private messages: string[] = [];
  private messageLog = new MessageLog();
  private spacePressed: boolean = false;  // Track space key for SPC ; sequence (US-1.10.1)
  private windowPrefixPressed: boolean = false;  // Track C-w prefix for window commands (SPEC-004)
  private lspClient: LSPClient;  // LSP client for language server integration (US-3.1.1)
  keymapSync: KeymapSync;  // Bridge layer for T-Lisp keymap integration (US-0.4.1)
  private currentInitFile: string = '';  // Path to current init file (SPEC-025)
  // Buffer-local mode state (SPEC-003)
  private bufferModeStates: Map<string, BufferModeState> = new Map();
  private minorModeRegistry: Map<string, MinorModeConfig> = new Map();
  private globalizedMinorModes: Set<string> = new Set();
  private autoModeRules: AutoModeRule[] = [];
  private loadPaths: string[] = [`${import.meta.dir}/../tlisp/core`];
  private currentModuleName: string | undefined;
  private bufferMetadata: Map<string, { filename?: string; modified: boolean; recency: number }> = new Map();
  private bufferRecency: number = 0;

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

    this.state = {
      cursorPosition: { line: 0, column: 0 },
      mode: "normal",
      statusMessage: "Welcome to tmax",
      viewportTop: 0,
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
    };

    editorLog.debug('Editor state initialized', {
      correlationId: initId,
      data: {
        mode: this.state.mode,
        theme: this.state.config.theme,
        tabSize: this.state.config.tabSize
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

    // Initialize KeymapSync for T-Lisp keymap integration (US-0.4.1)
    editorLog.info('Initializing KeymapSync', { correlationId: initId });
    this.keymapSync = new KeymapSync(this.interpreter);
    editorLog.debug('KeymapSync initialized', { correlationId: initId });

    // Initialize API
    editorLog.info('Initializing T-Lisp API', { correlationId: initId });
    this.initializeAPI();
    resetYankRegisterState();
    resetDeleteRegisterState();
    resetUndoRedoState();

    this.logMessage('Welcome to tmax', 'info');

    this.loadFallbackBindings();

    // Note: Key bindings are loaded lazily on first key press via ensureCoreBindingsLoaded()
    editorLog.debug('Key bindings will be loaded on first key press', {
      correlationId: initId
    });

    editorLog.completeOperation('editor-construction', initId, {
      data: {
        mode: this.state.mode,
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
    const tlispState: TlispEditorState = {
      get currentBuffer() {
        return editor.state.currentBuffer ?? null;
      },
      set currentBuffer(v: FunctionalTextBuffer | null) {
        const previousName = editor.findBufferName(editor.state.currentBuffer);
        const existingName = editor.findBufferName(v ?? undefined);
        const bufferName = existingName ?? previousName;
        if (v && bufferName) editor.buffers.set(bufferName, v as FunctionalTextBufferImpl);
        if (v && editor.state.tabs && editor.state.tabs.length > 0) {
          const currentTabIndex = editor.state.currentTabIndex ?? 0;
          const currentTab = editor.state.tabs[currentTabIndex];
          if (currentTab && currentTab.label === editor.state.currentFilename) {
            editor.state.tabs = editor.state.tabs.map((tab, index) =>
              index === currentTabIndex ? { ...tab, buffer: v } : tab
            );
          }
        }
        editor.state.currentBuffer = v ?? undefined;
        if (bufferName) {
          editor.touchBuffer(bufferName);
          editor.state.currentFilename = editor.bufferMetadata.get(bufferName)?.filename;
        }
      },
      get buffers() {
        return editor.buffers;
      },
      get cursorLine() {
        return editor.state.cursorPosition.line; 
      },
      set cursorLine(v: number) { 
        // Update both global and current window cursor position (US-3.2.1)
        editor.state.cursorPosition.line = v;
        const windows = editor.state.windows;
        if (windows && windows.length > 0) {
          const currentWindow = windows[editor.state.currentWindowIndex ?? 0];
          if (currentWindow) {
            currentWindow.cursorLine = v;
          }
        }
      },
      get cursorColumn() {
        return editor.state.cursorPosition.column; 
      },
      set cursorColumn(v: number) { 
        // Update both global and current window cursor position (US-3.2.1)
        editor.state.cursorPosition.column = v;
        const windows = editor.state.windows;
        if (windows && windows.length > 0) {
          const currentWindow = windows[editor.state.currentWindowIndex ?? 0];
          if (currentWindow) {
            currentWindow.cursorColumn = v;
          }
        }
      },
      get terminal() { return editor.terminal; },
      get filesystem() { return editor.filesystem; },
      get mode() { return editor.state.mode; },
      set mode(v: 'normal' | 'insert' | 'visual' | 'command' | 'mx') { editor.state.mode = v; },
      get lastCommand() { return ""; },
      set lastCommand(_: string) { },
      get statusMessage() { return editor.state.statusMessage; },
      set statusMessage(v: string) { editor.state.statusMessage = v; },
      get viewportTop() { return editor.state.viewportTop; },
      set viewportTop(v: number) { editor.state.viewportTop = v; },
      get commandLine() { return editor.state.commandLine; },
      set commandLine(v: string) { editor.state.commandLine = v; },
      get spacePressed() { return editor.spacePressed; },
      set spacePressed(v: boolean) { editor.spacePressed = v; },
      get mxCommand() { return editor.state.mxCommand; },
      set mxCommand(v: string) { editor.state.mxCommand = v; },
      get cursorFocus() { return editor.state.cursorFocus ?? 'buffer'; },
      set cursorFocus(v: 'buffer' | 'command') { editor.state.cursorFocus = v; },
      get lspDiagnostics() { return editor.state.lspDiagnostics; },
      logMessage: (msg: string, level?: string, command?: string) => editor.logMessage(msg, (level as LogLevel) ?? 'info', command),
      get currentFilename() { return editor.state.currentFilename; },
      set currentFilename(v: string | undefined) {
        editor.state.currentFilename = v;
        const name = editor.findBufferName(editor.state.currentBuffer);
        if (name) editor.updateBufferMetadata(name, { filename: v });
      },
      get config() { return editor.state.config; },
      set config(v: EditorState["config"]) { editor.state.config = v; },
      get operations() {
        return {
          saveFile: (filename?: string) => editor.saveFile(filename),
          openFile: (filename: string) => editor.openFile(filename),
        };
      },
      // Mode state callbacks for SPEC-003 buffer-local mode state
      _evalTlisp: (expr: string) => {
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
      _getCurrentMajorMode: () => editor.getCurrentMajorMode(),
      _setCurrentMajorMode: (mode: string) => editor.setCurrentMajorMode(mode),
      _getMinorModeRegistry: () => editor.getMinorModeRegistry(),
      _getBufferModeStates: () => editor.getBufferModeStates(),
      _getCurrentBufferKey: () => editor.getCurrentBufferKey(),
      _getGlobalizedMinorModes: () => editor.getGlobalizedMinorModes(),
      _getLoadPaths: () => editor.getLoadPaths(),
      _getModuleRegistry: () => editor.interpreter.moduleRegistry,
      _getCurrentModuleName: () => editor.getCurrentModuleName(),
      _getBufferModified: () => editor.getCurrentBufferModified(),
      _setBufferModified: (modified: boolean) => editor.setCurrentBufferModified(modified),
      _getMessageLog: () => editor.messageLog,
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
      let mode: "normal" | "insert" | "visual" | "command" | "mx" | undefined;

      if (modeArg) {
        if (modeArg.type !== "string") {
          throw new Error("key-bind mode must be a string");
        }
        const modeStr = modeArg.value as string;
        if (!["normal", "insert", "visual", "command", "mx"].includes(modeStr)) {
          throw new Error(`Invalid mode: ${modeStr}`);
        }
        mode = modeStr as "normal" | "insert" | "visual" | "command" | "mx";
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
      let mode: "normal" | "insert" | "visual" | "command" | "mx" | undefined;

      if (modeArg) {
        if (modeArg.type !== "string") {
          throw new Error("key-unbind mode must be a string");
        }
        const modeStr = modeArg.value as string;
        if (!["normal", "insert", "visual", "command", "mx"].includes(modeStr)) {
          throw new Error(`Invalid mode: ${modeStr}`);
        }
        mode = modeStr as "normal" | "insert" | "visual" | "command" | "mx";
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
      let mode: "normal" | "insert" | "visual" | "command" | "mx" | undefined;

      if (modeArg) {
        if (modeArg.type !== "string") {
          throw new Error("key-binding mode must be a string");
        }
        const modeStr = modeArg.value as string;
        if (!["normal", "insert", "visual", "command", "mx"].includes(modeStr)) {
          throw new Error(`Invalid mode: ${modeStr}`);
        }
        mode = modeStr as "normal" | "insert" | "visual" | "command" | "mx";
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
      let mode: "normal" | "insert" | "visual" | "command" | "mx" | undefined;

      if (modeArg) {
        if (modeArg.type !== "string") {
          throw new Error("describe-key mode must be a string");
        }
        const modeStr = modeArg.value as string;
        if (!["normal", "insert", "visual", "command", "mx"].includes(modeStr)) {
          throw new Error(`Invalid mode: ${modeStr}`);
        }
        mode = modeStr as "normal" | "insert" | "visual" | "command" | "mx";
      } else {
        // Use current mode if not specified
        mode = this.getMode() as "normal" | "insert" | "visual" | "command" | "mx";
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
      this.state.describeKeyPending = true;
      this.state.statusMessage = "Describe key: press a key";

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
      this.state.describeFunctionPending = true;
      this.state.statusMessage = "Describe function: ";

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
      this.state.aproposCommandPending = true;
      this.state.statusMessage = "Apropos command: ";

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
        this.state.statusMessage = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
      });
      
      return createString("saving...");
    });

    // Add minibuffer API functions (US-1.10.1)
    defineRaw("minibuffer-active", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-active requires no arguments");
      }
      return { type: "boolean", value: this.state.mode === "mx" };
    });

    defineRaw("minibuffer-get", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-get requires no arguments");
      }
      return createString(this.state.mxCommand);
    });

    defineRaw("minibuffer-set", (args) => {
      if (args.length !== 1) {
        throw new Error("minibuffer-set requires exactly 1 argument: text");
      }
      const textArg = args[0];
      if (!textArg || textArg.type !== "string") {
        throw new Error("minibuffer-set requires a string");
      }
      this.state.mxCommand = textArg.value as string;
      return createString(textArg.value as string);
    });

    defineRaw("minibuffer-clear", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-clear requires no arguments");
      }
      this.state.mxCommand = "";
      return createNil();
    });

    defineRaw("minibuffer-state-get", (args) => {
      if (args.length !== 0) throw new Error("minibuffer-state-get requires no arguments");
      return deserializeTlispValue(this.state.minibufferState);
    });

    defineRaw("minibuffer-state-set", (args) => {
      if (args.length !== 1) throw new Error("minibuffer-state-set requires one argument");
      this.state.minibufferState = serializeTlispValue(args[0]!);
      return args[0]!;
    });

    defineRaw("minibuffer-state-clear", (args) => {
      if (args.length !== 0) throw new Error("minibuffer-state-clear requires no arguments");
      this.state.minibufferState = undefined;
      return createNil();
    });

    defineRaw("minibuffer-view-publish", (args) => {
      if (args.length !== 1) throw new Error("minibuffer-view-publish requires one view");
      this.state.minibufferView = this.minibufferViewFromTlisp(args[0]!);
      return args[0]!;
    });

    defineRaw("minibuffer-view-clear", (args) => {
      if (args.length !== 0) throw new Error("minibuffer-view-clear requires no arguments");
      this.state.minibufferView = undefined;
      return createNil();
    });

    defineRaw("editor-cursor-focus", (args) => {
      if (args.length !== 0) throw new Error("editor-cursor-focus requires no arguments");
      return createString(this.state.cursorFocus ?? "buffer");
    });

    defineRaw("editor-set-cursor-focus", (args) => {
      if (args.length !== 1 || args[0]?.type !== "string") {
        throw new Error("editor-set-cursor-focus requires a string");
      }
      const focus = args[0].value as string;
      if (focus !== "buffer" && focus !== "command") throw new Error("Invalid cursor focus");
      this.state.cursorFocus = focus;
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
      if (Either.isLeft(result as any)) throw new Error((result as any).left.message);
      return (result as any).right;
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

    // Line number toggles
    defineRaw("toggle-line-numbers", (args) => {
      if (args.length !== 0) {
        throw new Error("toggle-line-numbers requires no arguments");
      }
      this.state.config.showLineNumbers = !this.state.config.showLineNumbers;
      return createBoolean(this.state.config.showLineNumbers);
    });

    defineRaw("toggle-relative-line-numbers", (args) => {
      if (args.length !== 0) {
        throw new Error("toggle-relative-line-numbers requires no arguments");
      }
      this.state.config.relativeLineNumbers = !this.state.config.relativeLineNumbers;
      if (this.state.config.relativeLineNumbers) {
        this.state.config.showLineNumbers = true;
      }
      return createBoolean(this.state.config.relativeLineNumbers);
    });

    // Window prefix handler: C-w waits for next key (s/v/w/q)
    defineRaw("editor-window-prefix", (args) => {
      if (args.length !== 0) {
        throw new Error("editor-window-prefix requires no arguments");
      }
      this.windowPrefixPressed = true;
      this.state.statusMessage = "C-w";
      return createString("window-prefix");
    });

    // Which-key API functions (US-1.10.3)
    defineRaw("which-key-enable", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-enable requires no arguments");
      }
      this.state.whichKeyTimeout = this.state.whichKeyTimeout || 1000;
      return createNil();
    });

    defineRaw("which-key-disable", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-disable requires no arguments");
      }
      this.state.whichKeyTimeout = 0;
      this.state.whichKeyActive = false;
      this.state.whichKeyPrefix = "";
      this.state.whichKeyBindings = [];
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
      this.state.whichKeyTimeout = timeout;
      return createNumber(timeout);
    });

    defineRaw("which-key-active", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-active requires no arguments");
      }
      return { type: "boolean", value: this.state.whichKeyActive || false };
    });

    defineRaw("which-key-prefix", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-prefix requires no arguments");
      }
      return createString(this.state.whichKeyPrefix || "");
    });

    defineRaw("which-key-bindings", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-bindings requires no arguments");
      }
      const bindings = this.state.whichKeyBindings || [];
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

    // Use imported macro recording functions
    const {
      startRecording,
      stopRecording,
      recordKey,
      isRecording,
      getCurrentRegister,
      getMacros,
      executeMacro,
      executeLastMacro,
      getLastExecutedMacro,
      clearAllMacros,
      clearMacro,
      resetMacroRecordingState,
    } = macroRecording;

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

      // Execute each key the specified number of times
      for (let i = 0; i < count; i++) {
        for (const key of keys) {
          // Execute the key via handleKey
          // Note: This is a simplified version that executes the key as a command
          // In a full implementation, we'd need to handle the key properly
          this.handleKey(key).catch((error) => {
            this.state.statusMessage = `Macro error: ${error instanceof Error ? error.message : String(error)}`;
          });
        }
      }

      return createString(register);
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

      // Execute each key
      for (const key of keys) {
        this.handleKey(key).catch((error) => {
          this.state.statusMessage = `Macro error: ${error instanceof Error ? error.message : String(error)}`;
        });
      }

      return createString(register);
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
      () => this.state.windows || [],
      (windows) => { this.state.windows = windows; },
      () => this.state.currentWindowIndex ?? 0,
      (index) => { this.state.currentWindowIndex = index; },
      () => this.state.currentBuffer,
      () => this.terminal.getSize()
    );

    for (const [name, fn] of windowOps) {
      this.interpreter.defineBuiltin(name, fn);
    }

    // Add tab management operations (SPEC-004)
    const tabOps = createTabOps(
      () => this.state.tabs || [],
      (tabs) => { this.state.tabs = tabs; },
      () => this.state.currentTabIndex ?? 0,
      (index) => { this.state.currentTabIndex = index; },
      (name, content) => {
        this.createBuffer(name, content);
        return this.state.currentBuffer;
      },
      (tab) => {
        this.state.currentBuffer = tab.buffer;
        this.state.currentFilename = tab.label;
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
    const executeContent = (content: string): boolean => {
      const result = this.interpreter.execute(content);
      if (Either.isLeft(result)) {
        const sanitizedContent = content.replace(
          /"\((editor-set-mode) "([^"]+)"\)"/g,
          '"($1 \\"$2\\")"'
        );
        if (sanitizedContent !== content) {
          const sanitizedResult = this.interpreter.execute(sanitizedContent);
          if (Either.isRight(sanitizedResult)) {
            return true;
          }
        }
        throw new Error(result.left.message);
      }
      return true;
    };

    try {
      const coreBindingsContent = await this.filesystem.readFile(path);
      return executeContent(coreBindingsContent);
    } catch (error) {
      try {
        const realFile = Bun.file(path);
        if (await realFile.exists()) {
          return executeContent(await realFile.text());
        }
      } catch (realError) {
        const realMessage = realError instanceof Error ? realError.message : String(realError);
        if (!silent) {
          console.warn(`Failed to load bindings from ${path}: ${realMessage}`);
        }
        return false;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!silent) {
        console.warn(`Failed to load bindings from ${path}: ${errorMessage}`);
      }
      return false;
    }
  }

  /**
   * Load core key bindings from T-Lisp files
   */
  private async loadCoreBindings(): Promise<void> {
    const bindingsDir = `${import.meta.dir}/../tlisp/core/bindings`;
    const requiredBindingFiles = [
      `${bindingsDir}/normal.tlisp`,
      `${bindingsDir}/insert.tlisp`,
      `${bindingsDir}/visual.tlisp`,
      `${bindingsDir}/command.tlisp`,
    ];

    let allLoaded = true;
    let lastError: string = "";

    for (const path of requiredBindingFiles) {
      const loaded = await this.loadBindingsFromFile(path);
      if (!loaded) {
        allLoaded = false;
        lastError = `Failed to load from ${path}`;
      }
    }

    if (!allLoaded) {
      console.warn(`Failed to load some core bindings. Last error: ${lastError}`);
      console.warn("Loading minimal fallback key bindings...");
      this.loadFallbackBindings();
    }

    this.coreBindingsLoaded = true;
    this.executeCommand("(editor/modes/line-numbers/global-line-numbers-mode t)");
  }

  /**
   * Ensure core bindings are loaded (lazy loading)
   */
  private async ensureCoreBindingsLoaded(): Promise<void> {
    if (!this.coreBindingsLoaded) {
      await this.loadCoreBindings();
    }
  }

  /**
   * Load saved macros from ~/.config/tmax/macros.tlisp (US-2.4.2)
   */
  private async loadSavedMacros(): Promise<void> {
    try {
      const loaded = await loadMacrosFromFile(this.filesystem);
      if (loaded) {
        this.state.statusMessage = "Macros loaded from ~/.config/tmax/macros.tlisp";
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
      const saved = await saveMacrosToFile(this.filesystem);
      if (saved) {
        this.state.statusMessage = "Macros saved to ~/.config/tmax/macros.tlisp";
      }
    } catch (error) {
      console.warn("Failed to save macros:", error);
    }
  }

  private pluginModuleName(pluginName: string): string {
    const safeName = pluginName
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `user/plugin/${safeName || "plugin"}`;
  }

  private pluginHasDefmodule(content: string): boolean {
    return /^\s*\(\s*defmodule\b/m.test(content);
  }

  private collectPluginExports(content: string): string[] {
    const exports = new Set<string>();
    const pattern = /^\s*\(\s*def(?:un|var|macro)\s+([^\s()]+)/gm;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (name) exports.add(name);
    }

    return Array.from(exports);
  }

  private wrapPluginModule(pluginName: string, content: string): string {
    if (this.pluginHasDefmodule(content)) {
      return content;
    }

    const moduleName = this.pluginModuleName(pluginName);
    const exports = this.collectPluginExports(content);
    const exportForm = exports.length > 0 ? `(export ${exports.join(" ")})` : "(export)";
    return `(defmodule ${moduleName}\n  ${exportForm}\n\n${content}\n)\n`;
  }

  /**
   * Load plugins from a directory (US-2.1.1)
   * @param pluginDir - Path to directory containing plugin subdirectories
   * @returns Result of plugin loading operation
   */
  async loadPluginsFromDirectory(pluginDir: string): Promise<{
    /** Successfully loaded plugins */
    loaded: string[];
    /** Skipped plugins (no plugin.tlisp) */
    skipped: string[];
    /** Total plugins discovered */
    total: number;
    /** Errors encountered during loading */
    errors: Array<{ plugin: string; error: string }>;
  }> {
    const result: {
      loaded: string[];
      skipped: string[];
      total: number;
      errors: Array<{ plugin: string; error: string }>;
    } = {
      loaded: [],
      skipped: [],
      total: 0,
      errors: []
    };

    try {
      // Check if plugin directory exists
      const dirExists = await this.filesystem.exists(pluginDir);
      if (!dirExists) {
        result.errors.push({
          plugin: 'directory',
          error: `Plugin directory does not exist: ${pluginDir}`
        });
        return result;
      }

      // Read directory contents
      // Try to use filesystem.readdir if available (for mock filesystem), otherwise fall back to fs
      let entryNames: string[];
      if (this.filesystem.readdir) {
        const allEntries = await this.filesystem.readdir(pluginDir);
        // For mock filesystem, we need to filter to only directories
        // We'll check if each entry has a directory stat
        const dirEntries: string[] = [];
        for (const entry of allEntries) {
          const entryPath = `${pluginDir}/${entry}`;
          try {
            const stat = await this.filesystem.stat(entryPath);
            if (stat.isDirectory) {
              dirEntries.push(entry);
            }
          } catch (e) {
            // Stat failed, assume it's not a directory
          }
        }
        entryNames = dirEntries;
      } else {
        // Use real fs module
        const entriesWithTypes = await (await import('fs/promises')).readdir(pluginDir, { withFileTypes: true });
        entryNames = entriesWithTypes
          .filter((entry: any) => entry.isDirectory())
          .map((entry: any) => entry.name);
      }

      result.total = entryNames.length;

      // Load each plugin
      for (const pluginName of entryNames) {
        const pluginPath = `${pluginDir}/${pluginName}`;

        try {
          // Check if plugin.tlisp exists
          const pluginFilePath = `${pluginPath}/plugin.tlisp`;
          const pluginFileExists = await this.filesystem.exists(pluginFilePath);

          if (!pluginFileExists) {
            result.skipped.push(pluginName);
            continue;
          }

          // Load plugin.toml if it exists
          const tomlPath = `${pluginPath}/plugin.toml`;
          const tomlExists = await this.filesystem.exists(tomlPath);

          if (tomlExists) {
            try {
              const tomlContent = await this.filesystem.readFile(tomlPath);
              // Parse TOML metadata (basic parsing for now)
              // TODO: Implement full TOML parsing in future iteration
              console.log(`Loading plugin metadata from: ${tomlPath}`);
            } catch (error) {
              // Don't fail plugin loading if toml has issues
              console.warn(`Warning: Failed to load plugin.toml for ${pluginName}: ${error}`);
            }
          }

          // Load plugin.tlisp with mandatory module isolation.
          try {
            const pluginContent = await this.filesystem.readFile(pluginFilePath);
            const execResult = this.interpreter.execute(this.wrapPluginModule(pluginName, pluginContent));
            if (execResult._tag === 'Left') {
              // Parse or execution error
              result.errors.push({
                plugin: pluginName,
                error: execResult.left.message
              });
              console.error(`Failed to load plugin ${pluginName}: ${execResult.left.message}`);
            } else {
              result.loaded.push(pluginName);
              console.log(`Loaded plugin: ${pluginName}`);
            }
          } catch (error) {
            result.errors.push({
              plugin: pluginName,
              error: error instanceof Error ? error.message : String(error)
            });
          }

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push({
            plugin: pluginName,
            error: errorMessage
          });
          console.error(`Failed to load plugin ${pluginName}: ${errorMessage}`);
        }
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({
        plugin: 'directory',
        error: `Failed to read plugin directory: ${errorMessage}`
      });
    }

    return result;
  }

  /**
   * Load minimal fallback key bindings when core-bindings.tlisp fails
   */
  private loadFallbackBindings(): void {
    try {
      // Essential bindings for basic functionality
      const fallbackBindings = `
        ;; Minimal fallback bindings
        (key-bind "q" "(editor-quit)" "normal")
        (key-bind "i" "(editor-set-mode \\"insert\\")" "normal")
        (key-bind "Escape" "(editor-set-mode \\"normal\\")" "insert")
        (key-bind "h" "(cursor-move (cursor-line) (- (cursor-column) 1))" "normal")
        (key-bind "j" "(cursor-move (+ (cursor-line) 1) (cursor-column))" "normal")
        (key-bind "k" "(cursor-move (- (cursor-line) 1) (cursor-column))" "normal")
        (key-bind "l" "(cursor-move (cursor-line) (+ (cursor-column) 1))" "normal")
        (key-bind ":" "(editor-enter-command-mode)" "normal")
        (key-bind "Escape" "(editor-exit-command-mode)" "command")
        (key-bind "Enter" "(editor-execute-command-line)" "command")
        
        ;; M-x mode bindings (US-1.10.1)
        (key-bind " " "(editor-handle-space)" "normal")
        (key-bind ";" "(execute-extended-command-maybe)" "normal")
        (key-bind "C-x b" "(switch-buffer)" "normal")
        (key-bind "Escape" "(minibuffer-dispatch-key \\"Escape\\")" "mx")
        (key-bind "C-g" "(minibuffer-dispatch-key \\"C-g\\")" "mx")
        (key-bind "Enter" "(minibuffer-dispatch-key \\"Enter\\")" "mx")

        ;; Window management bindings (SPEC-004)
        (key-bind "C-w" "(editor-window-prefix)" "normal")
      `;
      this.interpreter.execute(fallbackBindings);

      // Enable line-numbers mode by default
      try { this.interpreter.execute('(global-line-numbers-mode t)'); } catch { /* ok */ }
    } catch (error) {
      console.error("Critical: Failed to load even fallback bindings:", error);
      this.state.statusMessage = "Critical: No key bindings available";
    }
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
   */
  private async loadInitFile(initFilePath?: string): Promise<void> {
    const initLog = log.module('editor').fn('loadInitFile');

    // Determine init file path
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const configDir = `${homeDir}/.config/tmax`;
    const defaultInitFile = `${configDir}/init.tlisp`;

    const initFile = initFilePath || defaultInitFile;

    // Store for later reference
    this.currentInitFile = initFile;

    try {
      // Create config directory if it doesn't exist (only for default path)
      if (!initFilePath) {
        try {
          await this.filesystem.createDir(configDir);
          initLog.debug('Created config directory', { data: { path: configDir } });
        } catch (dirError) {
          // Directory creation failed - might already exist or permission error
          initLog.debug('Config directory creation failed or already exists', {
            data: {
              path: configDir,
              error: dirError instanceof Error ? dirError.message : String(dirError)
            }
          });
        }
      }

      initLog.debug(`Loading init file: ${initFile}`);

      let initContent: string;
      try {
        initContent = await this.filesystem.readFile(initFile);
      } catch (readError) {
        if (initFilePath) {
          throw readError;
        }
        initContent = await this.filesystem.readFile("~/.config/tmax/init.tlisp");
        this.currentInitFile = "~/.config/tmax/init.tlisp";
      }
      this.interpreter.execute(initContent);

      initLog.info('Loaded init file', {
        data: { path: initFile }
      });

      // Log any keymaps that were registered
      const registeredKeymaps = ["normal", "insert", "visual", "command", "mx"].filter(mode =>
        this.keymapSync.hasKeymap(mode)
      );

      if (registeredKeymaps.length > 0) {
        initLog.info('Registered T-Lisp keymaps from init file', {
          data: { modes: registeredKeymaps }
        });
      }
    } catch (error) {
      // Init file not found or error - use defaults (silent)
      // This is expected if the user hasn't created an init file yet
      initLog.debug('No init file found or error loading it', {
        data: {
          path: initFile,
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
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
    
    if (!this.state.currentBuffer) {
      evalLog.warn('No buffer to evaluate');
      return createNil();
    }

    const bufferContentResult = this.state.currentBuffer.getContent();
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

  private executeCommand(command: string): unknown {
    try {
      this.state.lastCommand = command;
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
        this.state.statusMessage = `[${err.diagnostic.code}] ${err.message}`;
        this.logMessage(renderDiagnostic(err.diagnostic), 'error', this.state.lastCommand);
      } else {
        this.state.statusMessage = err.message;
        this.logMessage(err.message, 'error', this.state.lastCommand);
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
      this.state.statusMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      this.logMessage(this.state.statusMessage, 'error', this.state.lastCommand);
      throw error;
    }
  }

  private async executeCommandAsync(command: string): Promise<unknown> {
    try {
      this.state.lastCommand = command;
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
        this.state.statusMessage = `[${err.diagnostic.code}] ${err.message}`;
        this.logMessage(renderDiagnostic(err.diagnostic), 'error', this.state.lastCommand);
      } else {
        this.state.statusMessage = err.message;
        this.logMessage(err.message, 'error', this.state.lastCommand);
      }
      return result;
    } catch (error) {
      if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
        throw new Error("EDITOR_QUIT_SIGNAL");
      }
      this.state.statusMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      this.logMessage(this.state.statusMessage, 'error', this.state.lastCommand);
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
  private escapeKeyForTLisp(key: string): string {
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
    const previousMode = this.state.mode;
    keyLog.debug(`Key pressed: ${key}`, {
      data: {
        key,
        normalizedKey: this.normalizeKey(key),
        currentMode: previousMode,
        cursorPosition: this.state.cursorPosition
      }
    });

    // Ensure core bindings are loaded before processing keys
    await this.ensureCoreBindingsLoaded();

    const normalizedKey = this.normalizeKey(key);

    // Dispatch to mode-specific handlers
    switch (this.state.mode) {
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
      default:
        // Handle unknown mode as normal mode
        await handleNormalMode(this, key, normalizedKey);
        break;
    }

    // Log mode changes (INFO level)
    if (previousMode !== this.state.mode) {
      keyLog.info(`Mode changed: ${previousMode} → ${this.state.mode}`, {
        data: {
          previousMode,
          newMode: this.state.mode,
          triggerKey: key
        }
      });
    }

    // Log errors
    if (this.state.statusMessage?.includes('Error')) {
      keyLog.error('Editor error occurred', undefined, {
        operation: 'handleKeyPress',
        data: { statusMessage: this.state.statusMessage, key }
      });
    }
  }

  /**
   * Log a message to the *Messages* buffer
   */
  logMessage(msg: string, level: LogLevel = 'info', command?: string): void {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const line = `[${ts}] ${msg}`;
    this.messages.push(line);
    this.messageLog.log(level, msg, command);
    this.buffers.set('*Messages*', FunctionalTextBufferImpl.create(this.messageLog.render()));
    this.updateBufferMetadata('*Messages*', { modified: false });
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
    this.state.currentBuffer = buffer;

    // Initialize first window if this is the first buffer (US-3.2.1)
    if (!this.state.windows || this.state.windows.length === 0) {
      // Get terminal size for window dimensions (US-3.2.2)
      const terminalSize = this.terminal.getSize();
      const initialWindow: Window = {
        id: "window-main",
        buffer: buffer,
        cursorLine: this.state.cursorPosition.line,
        cursorColumn: this.state.cursorPosition.column,
        viewportTop: this.state.viewportTop,
        height: terminalSize.height - 2, // Reserve space for status line and minibuffer
        width: terminalSize.width,
      };
      this.state.windows = [initialWindow];
      this.state.currentWindowIndex = 0;
    } else {
      // Update current window's buffer
      const currentWindow = this.state.windows[this.state.currentWindowIndex ?? 0];
      if (currentWindow) {
        currentWindow.buffer = buffer;
        // Sync window cursor with global cursor position
        currentWindow.cursorLine = this.state.cursorPosition.line;
        currentWindow.cursorColumn = this.state.cursorPosition.column;
        currentWindow.viewportTop = this.state.viewportTop;
      }
    }
  }

  /**
   * Open a file
   * @param filename - File to open
   */
  async openFile(filename: string): Promise<void> {
    try {
      const content = await this.filesystem.readFile(filename);
      this.createBuffer(filename, content);
      // Track the filename for save operations
      this.state.currentFilename = filename;
      const name = this.findBufferName(this.state.currentBuffer);
      if (name) this.updateBufferMetadata(name, { filename, modified: false });

      // Notify LSP client about file open (US-3.1.1)
      await this.lspClient.onFileOpen(filename, content);

      // Simulate diagnostics from language server (US-3.1.2)
      await this.lspClient.simulateDiagnostics(filename, content);

      // Update editor state with diagnostics (US-3.1.2)
      this.state.lspDiagnostics = this.lspClient.getDiagnostics();

      // Update status message with LSP connection status (US-3.1.1)
      const lspStatus = this.lspClient.getStatusMessage();
      this.state.statusMessage = lspStatus ? `Opened ${filename} - ${lspStatus}` : `Opened ${filename}`;
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
    } catch (error) {
      this.state.statusMessage = `Failed to open ${filename}: ${error instanceof Error ? error.message : String(error)}`;
      this.logMessage(`Failed to open ${filename}: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  /**
   * Save current buffer
   * @param filename - Optional filename to save to (overrides current filename)
   */
  async saveFile(filename?: string): Promise<void> {
    if (!this.state.currentBuffer) {
      this.state.statusMessage = "No buffer to save";
      return;
    }

    // Use provided filename or fall back to tracked filename
    const saveFilename = filename || this.state.currentFilename;
    if (!saveFilename) {
      this.state.statusMessage = "Buffer has no associated file";
      return;
    }

    try {
      const contentResult = this.state.currentBuffer.getContent();
      if (Either.isRight(contentResult)) {
        await this.filesystem.writeFile(saveFilename, contentResult.right);
        // Update tracked filename if a new one was provided
        if (filename && !this.state.currentFilename) {
          this.state.currentFilename = filename;
        }
        this.state.statusMessage = `Saved ${saveFilename}`;
        this.setCurrentBufferModified(false);
        this.logMessage(`Saved ${saveFilename}`, 'info');
      } else {
        this.state.statusMessage = `Failed to get content: ${contentResult.left}`;
      }
    } catch (error) {
      this.state.statusMessage = `Failed to save ${saveFilename}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Get the current buffer key for mode state lookup
   */
  getCurrentBufferKey(): string {
    return this.state.currentFilename ?? "*scratch*";
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
   * Get auto-mode rules
   */
  getAutoModeRules(): AutoModeRule[] {
    return this.autoModeRules;
  }

  /**
   * Get load paths
   */
  getLoadPaths(): string[] {
    return this.loadPaths;
  }

  /**
   * Get current module name (for module introspection)
   */
  getCurrentModuleName(): string | undefined {
    return this.currentModuleName;
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
   * Get editor state for React components
   */
  getEditorState(): EditorState {
    const modeState = this.getCurrentModeState();
    return {
      ...this.state,
      buffers: this.buffers as unknown as Map<string, FunctionalTextBuffer>,
      cursorFocus: this.state.cursorFocus ?? 'buffer',
      currentMajorMode: modeState.majorMode,
      activeMinorModes: [...modeState.activeMinorModes],
      activeMinorModeLighters: modeState.activeMinorModes
        .map((m) => this.minorModeRegistry.get(m)?.lighter ?? "")
        .filter((l) => l !== ""),
      minibufferState: cloneJsonValue(this.state.minibufferState),
      minibufferView: this.state.minibufferView ? structuredClone(this.state.minibufferView) : undefined,
    };
  }

  /**
   * Set editor state from React components
   */
  setEditorState(newState: EditorState): void {
    const previousBufferKey = this.getCurrentBufferKey();
    const nextBufferKey = newState.currentFilename ?? "*scratch*";
    const hasExistingModeState = this.bufferModeStates.has(nextBufferKey);

    this.state.currentBuffer = newState.currentBuffer;
    this.state.cursorPosition = newState.cursorPosition;
    this.state.mode = newState.mode;
    this.state.statusMessage = newState.statusMessage;
    this.state.viewportTop = newState.viewportTop;
    this.state.config = newState.config;
    this.state.currentFilename = newState.currentFilename;
    const currentBufferName = this.findBufferName(this.state.currentBuffer);
    if (currentBufferName && newState.currentFilename !== undefined) {
      this.updateBufferMetadata(currentBufferName, { filename: newState.currentFilename });
    }
    this.state.commandLine = newState.commandLine ?? this.state.commandLine;
    this.state.mxCommand = newState.mxCommand ?? this.state.mxCommand;
    this.state.minibufferState = cloneJsonValue(newState.minibufferState);
    this.state.minibufferView = newState.minibufferView ? structuredClone(newState.minibufferView) : undefined;
    this.state.cursorFocus = newState.cursorFocus ?? this.state.cursorFocus;
    this.state.buffers = newState.buffers ?? this.state.buffers;
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
    const name = this.findBufferName(this.state.currentBuffer);
    return name ? this.bufferMetadata.get(name)?.modified ?? false : false;
  }

  private setCurrentBufferModified(modified: boolean): void {
    const name = this.findBufferName(this.state.currentBuffer);
    if (name) this.updateBufferMetadata(name, { modified });
    this.state.bufferModified = modified;
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
    const terminalIO = this.terminal as any;
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
    if (!this.state.currentBuffer) {
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
    const currentName = this.findBufferName(this.state.currentBuffer);
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
   * Get key mappings (for testing)
   */
  getKeyMappings(): Map<string, KeyMapping[]> {
    return this.keyMappings;
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
    return this.state.mode;
  }

  /**
   * Get current count prefix
   * @returns Current count (0 if no count active)
   */
  getCount(): number {
    return this.countPrefix;
  }

  /**
   * Set count prefix value
   * @param count - Count value to set
   */
  setCount(count: number): void {
    this.countPrefix = Math.max(0, count);
  }

  /**
   * Reset count prefix to 0
   */
  resetCount(): void {
    this.countPrefix = 0;
  }

  /**
   * Check if count is active (greater than 0)
   * @returns true if count is active
   */
  isCountActive(): boolean {
    return this.countPrefix > 0;
  }

  /**
   * Consume and return the current count, then reset
   * @returns Current count (defaults to 1 if no count set)
   */
  consumeCount(): number {
    const count = this.countPrefix > 0 ? this.countPrefix : 1;
    this.countPrefix = 0;
    return count;
  }

  /**
   * Get current visual selection
   * @returns Visual selection or null if not in visual mode
   */
  getSelection(): any {
    const { getVisualSelection } = require("./api/visual-ops.ts");
    return getVisualSelection();
  }

  /**
   * Clear visual selection and exit visual mode
   */
  clearSelection(): void {
    const { clearVisualSelection } = require("./api/visual-ops.ts");
    clearVisualSelection();
    this.state.mode = "normal";
  }

  /**
   * Auto-detect and activate major mode based on filename (SPEC-035)
   */
  activateMajorModeForFile(filename: string): void {
    try {
      this.state.currentFilename = filename;
      this.executeCommand("(major-mode-auto-detect)");
    } catch (_) {
      // No mode matched — keep fundamental mode
    }
  }

  /**
   * Recompute syntax highlight spans for visible viewport (SPEC-035)
   */
  recomputeHighlights(): void {
    if (!this.state.currentBuffer) {
      this.state.highlightSpans = undefined;
      return;
    }

    try {
      const contentResult = this.state.currentBuffer.getContent();
      if (Either.isLeft(contentResult)) {
        this.state.highlightSpans = undefined;
        return;
      }

      const lines = contentResult.right.split('\n');
      const startLine = this.state.viewportTop;
      const endLine = Math.min(startLine + (this.state.config?.tabSize ?? 50), lines.length);

      // Use the T-Lisp API to highlight visible lines
      const spans: HighlightSpan[][] = [];
      for (let i = startLine; i < endLine; i++) {
        try {
          const result = this.executeCommand(`(syntax-highlight-line ${i})`);
          if (result && typeof result === 'object' && (result as any).type === 'list') {
            spans.push((result as any).value as HighlightSpan[]);
          } else {
            spans.push([]);
          }
        } catch (_) {
          spans.push([]);
        }
      }
      this.state.highlightSpans = spans.length > 0 ? spans : undefined;
    } catch (_) {
      this.state.highlightSpans = undefined;
    }
  }
}
