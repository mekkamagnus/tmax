/**
 * @file editor.ts
 * @description Core editor implementation with T-Lisp extensibility for React UI
 * This class manages the editor state and logic but delegates rendering to React components
 */

import { TLispInterpreterImpl } from "../tlisp/interpreter.ts";
import { FileSystemImpl } from "../core/filesystem.ts";
import { createEditorAPI, TlispEditorState } from "./tlisp-api.ts";
import type { EditorState, FunctionalTextBuffer } from "../core/types.ts";
import { createString, createList, createNil } from "../tlisp/values.ts";
import type { TerminalIO, FileSystem } from "../core/types.ts";
import { Either } from "../utils/task-either.ts";
import { FunctionalTextBufferImpl } from "../core/buffer.ts";
import { handleNormalMode } from "./handlers/normal-handler.ts";
import { handleInsertMode } from "./handlers/insert-handler.ts";
import { handleVisualMode } from "./handlers/visual-handler.ts";
import { handleCommandMode } from "./handlers/command-handler.ts";
import { handleMxMode } from "./handlers/mx-handler.ts";

/**
 * Key mapping for editor commands
 */
export interface KeyMapping {
  key: string;
  command: string;
  mode?: "normal" | "insert" | "visual" | "command" | "mx";
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

  /**
   * Create a new editor instance
   * @param terminal - Terminal interface (may be unused in React UI)
   * @param filesystem - File system interface
   */
  constructor(terminal: TerminalIO, filesystem: FileSystem) {
    this.terminal = terminal;
    this.filesystem = filesystem;
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
        wordWrap: false
      },
      commandLine: "",
      mxCommand: "",
      currentFilename: undefined,
      buffers: this.buffers,
      cursorFocus: 'buffer',
    };

    this.interpreter = new TLispInterpreterImpl();
    this.keyMappings = new Map();

    this.initializeAPI();
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
        // Update the buffer in the buffers map using tracked filename
        if (v && editor.state.currentFilename) {
          // Use the tracked filename to update the correct buffer entry
          editor.buffers.set(editor.state.currentFilename, v as FunctionalTextBufferImpl);
        }
        editor.state.currentBuffer = v ?? undefined;
      },
      get buffers() {
        return editor.buffers;
      },
      get cursorLine() { return editor.state.cursorPosition.line; },
      set cursorLine(v: number) { editor.state.cursorPosition.line = v; },
      get cursorColumn() { return editor.state.cursorPosition.column; },
      set cursorColumn(v: number) { editor.state.cursorPosition.column = v; },
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
      get spacePressed() { return false; },
      set spacePressed(_: boolean) { },
      get mxCommand() { return editor.state.mxCommand; },
      set mxCommand(v: string) { editor.state.mxCommand = v; },
      get cursorFocus() { return editor.state.cursorFocus ?? 'buffer'; },
      set cursorFocus(v: 'buffer' | 'command') { editor.state.cursorFocus = v; },
      get operations() {
        return {
          saveFile: (filename?: string) => editor.saveFile(filename),
          openFile: (filename: string) => editor.openFile(filename),
        };
      },
    };

    const api = createEditorAPI(tlispState);

    for (const [name, fn] of api) {
      // Wrap the Either-returning function to convert to the expected TLispFunctionImpl format
      const wrappedFn = (args: TLispValue[]) => {
        const result = fn(args);
        if (Either.isLeft(result)) {
          // Convert error to string representation or throw
          // For now, we'll throw an error to match the expected behavior
          throw new Error(`T-Lisp API Error: ${result.left.message}`);
        }
        return result.right;
      };

      this.interpreter.defineBuiltin(name, wrappedFn);
    }

    // Add key mapping functions
    this.interpreter.defineBuiltin("key-bind", (args) => {
      if (args.length < 2 || args.length > 3) {
        throw new Error("key-bind requires 2 or 3 arguments: key, command, optional mode");
      }

      const keyArg = args[0];
      const commandArg = args[1];
      const modeArg = args[2];

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

      const mapping: KeyMapping = { key, command, mode };

      if (!this.keyMappings.has(key)) {
        this.keyMappings.set(key, []);
      }

      // Remove any existing mappings for the same key and mode to handle conflicts
      const existingMappings = this.keyMappings.get(key)!;
      const filteredMappings = existingMappings.filter(existing =>
        !(existing.mode === mode || (!existing.mode && !mode))
      );

      // Add the new mapping
      filteredMappings.push(mapping);
      this.keyMappings.set(key, filteredMappings);

      return createString(key);
    });

    // Add key unbind function
    this.interpreter.defineBuiltin("key-unbind", (args) => {
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
    this.interpreter.defineBuiltin("key-bindings", (args) => {
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
    this.interpreter.defineBuiltin("key-binding", (args) => {
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
        const mapping = mappings[0]; // Return first available mapping
        return createList([
          createString(mapping.command),
          createString("source"), // Could be extended to show source file
          createString(mapping.mode || "all")
        ]);
      }
    });

    // Add command execution function
    this.interpreter.defineBuiltin("execute-command", (args) => {
      if (args.length !== 1) {
        throw new Error("execute-command requires exactly 1 argument: command");
      }
      
      const commandArg = args[0];
      if (!commandArg || commandArg.type !== "string") {
        throw new Error("execute-command requires a string command");
      }
      
      const command = commandArg.value as string;
      return this.executeCommand(command);
    });

    // Add count prefix API functions (US-1.3.1)
    this.interpreter.defineBuiltin("count-get", (args) => {
      if (args.length !== 0) {
        throw new Error("count-get requires no arguments");
      }
      return { type: "number", value: this.getCount() };
    });

    this.interpreter.defineBuiltin("count-set", (args) => {
      if (args.length !== 1) {
        throw new Error("count-set requires exactly 1 argument: count");
      }
      const countArg = args[0];
      if (!countArg || countArg.type !== "number") {
        throw new Error("count-set requires a number");
      }
      const count = countArg.value;
      if (count < 0) {
        throw new Error("count must be >= 0");
      }
      this.setCount(count);
      return createNil();
    });

    this.interpreter.defineBuiltin("count-reset", (args) => {
      if (args.length !== 0) {
        throw new Error("count-reset requires no arguments");
      }
      this.resetCount();
      return createNil();
    });

    this.interpreter.defineBuiltin("count-active", (args) => {
      if (args.length !== 0) {
        throw new Error("count-active requires no arguments");
      }
      return { type: "boolean", value: this.isCountActive() };
    });

    // Add file operations
    this.interpreter.defineBuiltin("file-save", (args) => {
      if (args.length !== 0) {
        throw new Error("file-save requires no arguments");
      }
      
      // Use async saveFile but return synchronously for T-Lisp
      this.saveFile().catch((error) => {
        this.state.statusMessage = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
      });
      
      return createString("saving...");
    });
  }

  /**
   * Load bindings from file
   * @param path - Path to the bindings file
   * @returns true if loaded successfully, false otherwise
   */
  private async loadBindingsFromFile(path: string): Promise<boolean> {
    try {
      const coreBindingsContent = await this.filesystem.readFile(path);
      this.interpreter.execute(coreBindingsContent);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to load bindings from ${path}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Load core key bindings from T-Lisp files
   */
  private async loadCoreBindings(): Promise<void> {
    const bindingFiles = [
      "src/tlisp/core/bindings/normal.tlisp",
      "src/tlisp/core/bindings/insert.tlisp",
      "src/tlisp/core/bindings/visual.tlisp",
      "src/tlisp/core/bindings/command.tlisp",
    ];

    let allLoaded = true;
    let lastError: string = "";

    for (const path of bindingFiles) {
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
      `;
      this.interpreter.execute(fallbackBindings);
    } catch (error) {
      console.error("Critical: Failed to load even fallback bindings:", error);
      this.state.statusMessage = "Critical: No key bindings available";
    }
  }

  /**
   * Load initialization file
   */
  private async loadInitFile(): Promise<void> {
    try {
      const initContent = await this.filesystem.readFile("~/.tmaxrc");
      this.interpreter.execute(initContent);
      console.log("Loaded custom ~/.tmaxrc bindings");
    } catch (error) {
      // Init file not found or error - use defaults (silent)
      // This is expected if the user hasn't created a ~/.tmaxrc file yet
    }
  }

  /**
   * Execute a T-Lisp command
   * @param command - Command to execute
   * @returns Result of command execution
   */
  private executeCommand(command: string): unknown {
    try {
      this.state.lastCommand = command;
      return this.interpreter.execute(command);
    } catch (error) {
      if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
        throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal
      }
      this.state.statusMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }
  }

  /**
   * Normalize key input for consistent mapping
   * @param key - Raw key input
   * @returns Normalized key string
   */
  private normalizeKey(key: string): string {
    // Convert common escape sequences to readable names
    switch (key) {
      case "\x1b": return "Escape";
      case "\x7f": return "Backspace";
      case "\x08": return "Backspace";
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
  }

  /**
   * Create a new buffer
   * @param name - Buffer name
   * @param content - Initial content
   */
  createBuffer(name: string, content: string = ""): void {
    const buffer = FunctionalTextBufferImpl.create(content);
    this.buffers.set(name, buffer);

    // Always set currentBuffer to the newly created buffer
    this.state.currentBuffer = buffer;
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
      this.state.statusMessage = `Opened ${filename}`;
    } catch (error) {
      this.state.statusMessage = `Failed to open ${filename}: ${error instanceof Error ? error.message : String(error)}`;
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
      } else {
        this.state.statusMessage = `Failed to get content: ${contentResult.left}`;
      }
    } catch (error) {
      this.state.statusMessage = `Failed to save ${saveFilename}: ${error instanceof Error ? error.message : String(error)}`;
    }
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
    return {
      currentBuffer: this.state.currentBuffer,
      cursorPosition: this.state.cursorPosition,
      mode: this.state.mode,
      statusMessage: this.state.statusMessage,
      viewportTop: this.state.viewportTop,
      config: this.state.config,
      commandLine: this.state.commandLine,
      mxCommand: this.state.mxCommand,
      currentFilename: this.state.currentFilename,
      buffers: this.buffers as unknown as Map<string, FunctionalTextBuffer>,
      cursorFocus: this.state.cursorFocus ?? 'buffer',
    };
  }

  /**
   * Set editor state from React components
   */
  setEditorState(newState: EditorState): void {
    this.state.currentBuffer = newState.currentBuffer;
    this.state.cursorPosition = newState.cursorPosition;
    this.state.mode = newState.mode;
    this.state.statusMessage = newState.statusMessage;
    this.state.viewportTop = newState.viewportTop;
    this.state.config = newState.config;
    this.state.currentFilename = newState.currentFilename;
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
    await this.loadInitFile();

    // Create default buffer if none exists
    // But check if currentBuffer was already set (e.g., from main.tsx with a file)
    if (this.buffers.size === 0 && !this.state.currentBuffer) {
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
    return this.state;
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
}