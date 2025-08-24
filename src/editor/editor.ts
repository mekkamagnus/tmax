/**
 * @file editor.ts
 * @description Core editor implementation with T-Lisp extensibility
 */

import { TLispInterpreterImpl } from "../tlisp/interpreter.ts";
import { TerminalIOImpl } from "../core/terminal.ts";
import { FileSystemImpl } from "../core/filesystem.ts";
import { TextBufferImpl } from "../core/buffer.ts";
import { createEditorAPI, type EditorState } from "./tlisp-api.ts";
import { createString } from "../tlisp/values.ts";
import type { TerminalIO, FileSystem, TextBuffer } from "../core/types.ts";

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
  private interpreter: TLispInterpreterImpl;
  private keyMappings: Map<string, KeyMapping[]>;
  private running: boolean = false;
  private coreBindingsLoaded: boolean = false;

  /**
   * Create a new editor instance
   * @param terminal - Terminal interface
   * @param filesystem - File system interface
   */
  constructor(terminal: TerminalIO, filesystem: FileSystem) {
    this.state = {
      currentBuffer: null,
      buffers: new Map(),
      cursorLine: 0,
      cursorColumn: 0,
      terminal,
      filesystem,
      mode: "normal",
      lastCommand: "",
      statusMessage: "Welcome to tmax",
      viewportTop: 0,
      commandLine: "",
      spacePressed: false,
      mxCommand: "",
      operations: {
        saveFile: () => this.saveFile(),
        openFile: (filename: string) => this.openFile(filename),
      },
    };

    this.interpreter = new TLispInterpreterImpl();
    this.keyMappings = new Map();
    
    this.initializeAPI();
  }

  /**
   * Initialize the T-Lisp API functions
   */
  private initializeAPI(): void {
    const api = createEditorAPI(this.state);
    
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
        const coreBindingsContent = await this.state.filesystem.readFile(path);
        this.interpreter.execute(coreBindingsContent);
        this.state.statusMessage = `Core bindings loaded from ${path}`;
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
      this.state.statusMessage = "Using fallback key bindings";
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
      const initContent = await this.state.filesystem.readFile("~/.tmaxrc");
      this.interpreter.execute(initContent);
    } catch (error) {
      // Init file not found or error - use defaults
      this.state.statusMessage = "No init file found, using defaults";
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
      if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
        throw error; // Re-throw quit signal
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
      this.executeCommand(`(buffer-insert "${key}")`);
      return;
    }
    
    // Handle command line input in command mode
    if (this.state.mode === "command") {
      if (key.length === 1 && key >= " " && key <= "~") {
        // Add character to command line
        this.state.commandLine += key;
        return;
      } else if (normalizedKey === "Backspace" && this.state.commandLine.length > 0) {
        // Remove last character from command line
        this.state.commandLine = this.state.commandLine.slice(0, -1);
        return;
      }
    }
    
    // Handle M-x command input in mx mode
    if (this.state.mode === "mx") {
      if (key.length === 1 && key >= " " && key <= "~") {
        // Add character to M-x command
        this.state.mxCommand += key;
        return;
      } else if (normalizedKey === "Backspace" && this.state.mxCommand.length > 0) {
        // Remove last character from M-x command
        this.state.mxCommand = this.state.mxCommand.slice(0, -1);
        return;
      }
    }
    
    const mappings = this.keyMappings.get(normalizedKey);
    
    // Reset space state if any key other than semicolon is pressed after space
    if (this.state.spacePressed && normalizedKey !== ";" && normalizedKey !== " ") {
      this.state.spacePressed = false;
      this.state.statusMessage = "";
    }
    
    if (!mappings) {
      this.state.statusMessage = `Unbound key: ${normalizedKey}`;
      return;
    }

    // Find mapping for current mode
    const mapping = mappings.find(m => !m.mode || m.mode === this.state.mode);
    if (!mapping) {
      this.state.statusMessage = `Unbound key in ${this.state.mode} mode: ${normalizedKey}`;
      return;
    }

    // Execute the mapped command
    try {
      this.executeCommand(mapping.command);
    } catch (error) {
      if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
        throw error; // Re-throw quit signal to main loop
      }
      this.state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Create a new buffer
   * @param name - Buffer name
   * @param content - Initial content
   */
  createBuffer(name: string, content: string = ""): void {
    const buffer = new TextBufferImpl(content);
    this.state.buffers.set(name, buffer);
    
    if (!this.state.currentBuffer) {
      this.state.currentBuffer = buffer;
    }
  }

  /**
   * Open a file
   * @param filename - File to open
   */
  async openFile(filename: string): Promise<void> {
    try {
      const content = await this.state.filesystem.readFile(filename);
      this.createBuffer(filename, content);
      this.state.currentBuffer = this.state.buffers.get(filename)!;
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

    // Find buffer name
    let filename = "";
    for (const [name, buffer] of this.state.buffers) {
      if (buffer === this.state.currentBuffer) {
        filename = name;
        break;
      }
    }

    if (!filename) {
      this.state.statusMessage = "Buffer has no associated file";
      return;
    }

    try {
      const content = this.state.currentBuffer.getContent();
      await this.state.filesystem.writeFile(filename, content);
      this.state.statusMessage = `Saved ${filename}`;
    } catch (error) {
      this.state.statusMessage = `Failed to save ${filename}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Update viewport to ensure cursor is visible
   */
  private updateViewport(): void {
    const terminalSize = this.state.terminal.getSize();
    const maxViewportLines = terminalSize.height - 1; // Reserve space for status line
    
    // Scroll down if cursor is below viewport
    if (this.state.cursorLine >= this.state.viewportTop + maxViewportLines) {
      this.state.viewportTop = this.state.cursorLine - maxViewportLines + 1;
    }
    
    // Scroll up if cursor is above viewport
    if (this.state.cursorLine < this.state.viewportTop) {
      this.state.viewportTop = this.state.cursorLine;
    }
    
    // Ensure viewport doesn't go negative
    this.state.viewportTop = Math.max(0, this.state.viewportTop);
  }

  /**
   * Render the editor
   * @param fullRedraw - Whether to clear screen and redraw everything (default: false)
   */
  async render(fullRedraw: boolean = false): Promise<void> {
    // Clear screen if explicitly requested
    if (fullRedraw) {
      await this.state.terminal.clear();
    }
    
    if (!this.state.currentBuffer) {
      await this.state.terminal.moveCursor({ line: 0, column: 0 });
      await this.state.terminal.write("No buffer loaded");
      await this.renderStatusLine();
      return;
    }

    this.updateViewport();
    
    const terminalSize = this.state.terminal.getSize();
    const maxViewportLines = terminalSize.height - 1; // Reserve space for status line
    const totalLines = this.state.currentBuffer.getLineCount();
    
    // Render visible lines
    for (let viewportRow = 0; viewportRow < maxViewportLines; viewportRow++) {
      const bufferLine = this.state.viewportTop + viewportRow;
      
      await this.state.terminal.moveCursor({ line: viewportRow, column: 0 });
      
      if (bufferLine < totalLines) {
        const line = this.state.currentBuffer.getLine(bufferLine);
        const displayLine = line.length > terminalSize.width ? 
          line.substring(0, terminalSize.width - 1) : line;
        await this.state.terminal.write(displayLine);
      }
      
      await this.state.terminal.clearToEndOfLine();
    }
    
    await this.renderStatusLine();
    await this.positionCursor();
  }
  
  /**
   * Render the status line at the bottom of the screen
   */
  private async renderStatusLine(): Promise<void> {
    const terminalSize = this.state.terminal.getSize();
    const statusRow = terminalSize.height - 1;
    
    await this.state.terminal.moveCursor({ line: statusRow, column: 0 });
    
    let statusText: string;
    
    if (this.state.mode === "command") {
      // In command mode, show the command line
      statusText = `:${this.state.commandLine}`;
    } else if (this.state.mode === "mx") {
      // In M-x mode, show the M-x command line
      statusText = `M-x ${this.state.mxCommand}`;
    } else {
      // In other modes, show mode and status
      const mode = this.state.mode.toUpperCase();
      const pos = `${this.state.cursorLine + 1}:${this.state.cursorColumn + 1}`;
      statusText = `-- ${mode} -- ${pos} | ${this.state.statusMessage}`;
    }
    
    // Truncate status if too long
    const displayStatus = statusText.length > terminalSize.width ? 
      statusText.substring(0, terminalSize.width) : statusText;
    
    await this.state.terminal.write(displayStatus);
    await this.state.terminal.clearToEndOfLine();
  }
  
  /**
   * Position the cursor at the editing location
   */
  private async positionCursor(): Promise<void> {
    if (this.state.mode === "command") {
      // In command mode, position cursor at the command line
      const terminalSize = this.state.terminal.getSize();
      const statusRow = terminalSize.height - 1;
      const commandCol = 1 + this.state.commandLine.length; // 1 for the ':' prefix
      
      await this.state.terminal.moveCursor({ line: statusRow, column: commandCol });
    } else if (this.state.mode === "mx") {
      // In M-x mode, position cursor at the M-x command line
      const terminalSize = this.state.terminal.getSize();
      const statusRow = terminalSize.height - 1;
      const mxCol = 4 + this.state.mxCommand.length; // 4 for the 'M-x ' prefix
      
      await this.state.terminal.moveCursor({ line: statusRow, column: mxCol });
    } else {
      // In other modes, position cursor at the editing location
      const screenRow = this.state.cursorLine - this.state.viewportTop;
      const screenCol = this.state.cursorColumn;
      
      await this.state.terminal.moveCursor({ line: screenRow, column: screenCol });
    }
    
    await this.state.terminal.showCursor();
  }

  /**
   * Start the editor
   */
  async start(): Promise<void> {
    this.running = true;
    
    // Load core bindings and user init file
    await this.ensureCoreBindingsLoaded();
    await this.loadInitFile();
    
    // Create default buffer if none exists
    if (this.state.buffers.size === 0) {
      this.createBuffer("*scratch*", "");
    }
    
    // Initial render
    await this.render(true);
    
    while (this.running) {
      // Get key input
      const key = await this.state.terminal.readKey();
      
      try {
        await this.handleKey(key);
      } catch (error) {
        if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
          break;
        }
        // Handle other errors normally
        this.state.statusMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
      
      // Render after handling input
      await this.render(false);
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
}