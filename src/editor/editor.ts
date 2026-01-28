/**
 * @file editor.ts
 * @description Core editor implementation with T-Lisp extensibility for React UI
 * This class manages the editor state and logic but delegates rendering to React components
 */

import { TLispInterpreterImpl } from "../tlisp/interpreter.ts";
import { FileSystemImpl } from "../core/filesystem.ts";
import { createEditorAPI, TlispEditorState } from "./tlisp-api.ts";
import type { EditorState, FunctionalTextBuffer } from "../core/types.ts";
import { createString } from "../tlisp/values.ts";
import type { TerminalIO, FileSystem } from "../core/types.ts";
import { Either } from "../utils/task-either.ts";
import { FunctionalTextBufferImpl } from "../core/buffer.ts";
import { TerminalRenderer } from "./renderer.ts";

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
  private renderer: TerminalRenderer;

  /**
   * Create a new editor instance
   * @param terminal - Terminal interface (may be unused in React UI)
   * @param filesystem - File system interface
   */
  constructor(terminal: TerminalIO, filesystem: FileSystem) {
    this.terminal = terminal;
    this.filesystem = filesystem;
    this.renderer = new TerminalRenderer(terminal);
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
      set mode(v: any) { editor.state.mode = v; },
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
      get operations() {
        return {
          saveFile: () => editor.saveFile(),
          openFile: (filename: string) => editor.openFile(filename),
        };
      },
    };

    const api = createEditorAPI(tlispState);

    for (const [name, fn] of api) {
      this.interpreter.defineBuiltin(name, fn);
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
      
      this.keyMappings.get(key)!.push(mapping);
      
      return createString(key);
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
   * Load core key bindings from T-Lisp file
   */
  private async loadCoreBindings(): Promise<void> {
    // Try to find the core bindings file from current working directory
    const possiblePaths = [
      "src/tlisp/core-bindings.tlisp",
      "./src/tlisp/core-bindings.tlisp",
    ];

    let loaded = false;
    let lastError: string = "";

    for (const path of possiblePaths) {
      try {
        const coreBindingsContent = await this.filesystem.readFile(path);
        this.interpreter.execute(coreBindingsContent);
        // Keep welcome message - log to console instead
        console.log(`Core bindings loaded from ${path}`);
        this.coreBindingsLoaded = true;
        loaded = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        continue;
      }
    }

    if (!loaded) {
      console.warn(`Failed to load core bindings from any path. Last error: ${lastError}`);
      console.warn("Loading minimal fallback key bindings...");
      this.loadFallbackBindings();
      this.coreBindingsLoaded = true;
      // Keep welcome message - fallback bindings loaded
      console.log("Using fallback key bindings");
    }
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
      console.log("Init file loaded: ~/.tmaxrc");
    } catch (error) {
      // Init file not found or error - use defaults
      console.log("No init file found, using defaults");
    }
  }

  /**
   * Execute a T-Lisp command
   * @param command - Command to execute
   * @returns Result of command execution
   */
  private executeCommand(command: string): any {
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

    // Handle printable characters in insert mode FIRST
    // This ensures that normal characters like 'h', 'j', 'k', 'l' are inserted
    // even if they have key mappings for other modes
    if (this.state.mode === "insert" && key.length === 1 && key >= " " && key <= "~") {
      const escapedKey = this.escapeKeyForTLisp(key);
      this.executeCommand(`(buffer-insert "${escapedKey}")`);
    }
    // Handle Enter key in insert mode with proper escaping
    else if (this.state.mode === "insert" && normalizedKey === "Enter") {
      const escapedNewline = this.escapeKeyForTLisp("\n");
      this.executeCommand(`(buffer-insert "${escapedNewline}")`);
    }
    // Handle Backspace key in insert mode
    else if (this.state.mode === "insert" && normalizedKey === "Backspace") {
      this.executeCommand("(buffer-delete 1)");
    }
    // Handle command line input in command mode
    if (this.state.mode === "command") {
      if (key.length === 1 && key >= " " && key <= "~") {
        // Add character to command line
        this.state.commandLine += key;
        return; // Don't process this key further
      } else if (normalizedKey === "Backspace") {
        // Remove last character from command line
        this.state.commandLine = this.state.commandLine.slice(0, -1);
        return; // Don't process this key further
      } else if (normalizedKey === "Escape") {
        this.state.mode = "normal";
        this.state.commandLine = "";
        return; // Don't process this key further
      } else if (normalizedKey === "Enter") {
        // Execute the command line through the T-Lisp key binding system
        // This ensures proper integration with the T-Lisp interpreter
        try {
          this.executeCommand(`(editor-execute-command-line)`);
        } catch (error) {
          if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
            throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal to main loop
          }
          this.state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
        }

        // Clear command line and return to normal mode
        this.state.commandLine = "";
        this.state.mode = "normal";
        return; // Don't process this key further
      }
      // For other keys, fall through to key binding system
    }
    // Handle M-x command input in mx mode
    else if (this.state.mode === "mx") {
      if (key.length === 1 && key >= " " && key <= "~") {
        // TODO: Implement M-x editing in terminal UI
      } else if (normalizedKey === "Backspace") {
        // TODO: Implement M-x editing in terminal UI
      } else if (normalizedKey === "Enter") {
        // Execute M-x command
        if (this.state.mxCommand) {
          this.executeCommand(`(${this.state.mxCommand})`);
          this.state.mxCommand = ""; // Clear M-x command after execution
        }
      } else if (normalizedKey === "Escape") {
        this.state.mode = "normal";
        this.state.mxCommand = "";
      }
    }
    // Handle regular key mappings
    else {
      const mappings = this.keyMappings.get(normalizedKey);

      if (!mappings) {
        this.state.statusMessage = `Unbound key: ${normalizedKey}`;
      } else {
        // Find mapping for current mode
        const mapping = mappings.find(m => !m.mode || m.mode === this.state.mode);
        if (!mapping) {
          this.state.statusMessage = `Unbound key in ${this.state.mode} mode: ${normalizedKey}`;
        } else {
          // Execute the mapped command
          try {
            this.executeCommand(mapping.command);
          } catch (error) {
            if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
              throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal to main loop
            }
            this.state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
      }
    }

    // Render after handling key
    await this.render();
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
   */
  async saveFile(): Promise<void> {
    if (!this.state.currentBuffer) {
      this.state.statusMessage = "No buffer to save";
      return;
    }

    // Use the tracked filename directly
    const filename = this.state.currentFilename;
    if (!filename) {
      this.state.statusMessage = "Buffer has no associated file";
      return;
    }

    try {
      const contentResult = this.state.currentBuffer.getContent();
      if (Either.isRight(contentResult)) {
        await this.filesystem.writeFile(filename, contentResult.right);
        this.state.statusMessage = `Saved ${filename}`;
      } else {
        this.state.statusMessage = `Failed to get content: ${contentResult.left}`;
      }
    } catch (error) {
      this.state.statusMessage = `Failed to save ${filename}: ${error instanceof Error ? error.message : String(error)}`;
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
    if (this.buffers.size === 0) {
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
   * Render the editor to the terminal
   */
  async render(): Promise<void> {
    const buffer = this.state.currentBuffer;
    if (!buffer) {
      await this.terminal.write("No buffer loaded");
      return;
    }
    await this.renderer.render(this.state, buffer);
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
}