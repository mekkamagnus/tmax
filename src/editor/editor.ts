/**
 * @file editor.ts
 * @description Core editor implementation with T-Lisp extensibility for React UI
 * This class manages the editor state and logic but delegates rendering to React components
 */

import { TLispInterpreterImpl } from "../tlisp/interpreter.ts";
import { FileSystemImpl } from "../core/filesystem.ts";
import { createEditorAPI, TlispEditorState } from "./tlisp-api.ts";
import type { EditorState, FunctionalTextBuffer } from "../core/types.ts";
import { createString, createList, createNil, createNumber } from "../tlisp/values.ts";
import type { TerminalIO, FileSystem } from "../core/types.ts";
import { Either } from "../utils/task-either.ts";
import { FunctionalTextBufferImpl } from "../core/buffer.ts";
import { handleNormalMode } from "./handlers/normal-handler.ts";
import { handleInsertMode } from "./handlers/insert-handler.ts";
import { handleVisualMode } from "./handlers/visual-handler.ts";
import { handleCommandMode } from "./handlers/command-handler.ts";
import { handleMxMode } from "./handlers/mx-handler.ts";
import { createMinibufferOps } from "./api/minibuffer-ops.ts";
import * as macroRecording from "./api/macro-recording.ts";
import { loadMacrosFromFile, saveMacrosToFile } from "./api/macro-persistence.ts";
import { LSPClient } from "../lsp/client.ts";

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
  private commandHistory: string[] = [];  // Command history for M-x (US-1.10.1)
  private historyIndex: number = 0;  // Current position in command history
  private spacePressed: boolean = false;  // Track space key for SPC ; sequence (US-1.10.1)
  private lspClient: LSPClient;  // LSP client for language server integration (US-3.1.1)

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
      // Which-key popup state (US-1.10.3)
      whichKeyActive: false,
      whichKeyPrefix: "",
      whichKeyBindings: [],
      whichKeyTimeout: 1000,
      // LSP diagnostics state (US-3.1.2)
      lspDiagnostics: [],
    };

    this.interpreter = new TLispInterpreterImpl();
    this.keyMappings = new Map();
    this.lspClient = new LSPClient(this.terminal, this.filesystem);

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
      get spacePressed() { return editor.spacePressed; },
      set spacePressed(v: boolean) { editor.spacePressed = v; },
      get mxCommand() { return editor.state.mxCommand; },
      set mxCommand(v: string) { editor.state.mxCommand = v; },
      get cursorFocus() { return editor.state.cursorFocus ?? 'buffer'; },
      set cursorFocus(v: 'buffer' | 'command') { editor.state.cursorFocus = v; },
      get lspDiagnostics() { return editor.state.lspDiagnostics; },
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

    // Add describe-key function (US-1.11.1)
    this.interpreter.defineBuiltin("describe-key", (args) => {
      if (args.length < 1 || args.length > 2) {
        throw new Error("describe-key requires 1 or 2 arguments: key, optional mode");
      }

      const keyArg = args[0];
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
        mapping = mappings[0]; // Fall back to first binding
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
    this.interpreter.defineBuiltin("describe-key-prompt", (args) => {
      if (args.length !== 0) {
        throw new Error("describe-key-prompt requires no arguments");
      }

      // Set a flag to indicate we're waiting for a key to describe
      this.state.describeKeyPending = true;
      this.state.statusMessage = "Describe key: press a key";

      return createString("waiting for key");
    });

    // Add describe-function function (US-1.11.2)
    this.interpreter.defineBuiltin("describe-function", (args) => {
      if (args.length !== 1) {
        throw new Error("describe-function requires exactly 1 argument: function-name");
      }

      const nameArg = args[0];
      if (!nameArg || nameArg.type !== "string") {
        throw new Error("describe-function requires a string function name");
      }

      const functionName = nameArg.value as string;

      // Look up the function in the global environment
      const func = this.interpreter.globalEnv.lookup(functionName);

      if (!func) {
        return createNil(); // Function not found
      }

      if (func.type !== "function") {
        return createNil(); // Not a function
      }

      // Extract function information
      const name = func.name || functionName;
      const docstring = func.docstring || "No documentation available";
      const parameters = func.parameters || [];

      // Build signature
      let signature: string;
      if (parameters.length > 0) {
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

      if (func.source) {
        result.push(createString(func.source));
      }

      return createList(result);
    });

    // Add describe-function-prompt function (US-1.11.2)
    // Interactive version that prompts user for function name
    this.interpreter.defineBuiltin("describe-function-prompt", (args) => {
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
    this.interpreter.defineBuiltin("describe-function-complete", (args) => {
      if (args.length !== 1) {
        throw new Error("describe-function-complete requires exactly 1 argument: pattern");
      }

      const patternArg = args[0];
      if (!patternArg || patternArg.type !== "string") {
        throw new Error("describe-function-complete requires a string pattern");
      }

      const pattern = (patternArg.value as string).toLowerCase();

      // Get all function names from the global environment
      const matchingFunctions: TLispValue[] = [];
      
      for (const [name, value] of this.interpreter.globalEnv.bindings) {
        if (value.type === "function" && name.toLowerCase().includes(pattern)) {
          matchingFunctions.push(createString(name));
        }
      }

      return createList(matchingFunctions);
    });

    // Add apropos-command function (US-1.11.3)
    // Search for commands by pattern, returning name, binding, and documentation
    this.interpreter.defineBuiltin("apropos-command", (args) => {
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

      // Search through all functions in the global environment
      for (const [name, value] of this.interpreter.globalEnv.bindings) {
        if (value.type === "function") {
          const lowerName = name.toLowerCase();

          // Check if the pattern matches (supports simple regex patterns)
          let matches = false;
          try {
            // Try to match as regex first
            const regex = new RegExp(pattern, "i");
            matches = regex.test(lowerName);
          } catch {
            // If invalid regex, fall back to simple substring match
            matches = lowerName.includes(pattern);
          }

          if (matches) {
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

            // Build result: [name, bindings, docstring]
            const func = value as TLispFunctionImpl;
            const docstring = func.docstring || "No documentation available";

            const result: TLispValue[] = [
              createString(name),
              bindings.length > 0 ? createString(bindings.join(", ")) : createString(""),
              createString(docstring)
            ];

            matchingCommands.push(createList(result));
          }
        }
      }

      return createList(matchingCommands);
    });

    // Add apropos-command-prompt function (US-1.11.3)
    // Interactive version that prompts user for search pattern
    this.interpreter.defineBuiltin("apropos-command-prompt", (args) => {
      if (args.length !== 0) {
        throw new Error("apropos-command-prompt requires no arguments");
      }

      // Set a flag to indicate we're waiting for a search pattern
      this.state.aproposCommandPending = true;
      this.state.statusMessage = "Apropos command: ";

      return createString("waiting for search pattern");
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

    // Add minibuffer API functions (US-1.10.1)
    this.interpreter.defineBuiltin("minibuffer-active", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-active requires no arguments");
      }
      return { type: "boolean", value: this.state.mode === "mx" };
    });

    this.interpreter.defineBuiltin("minibuffer-get", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-get requires no arguments");
      }
      return createString(this.state.mxCommand);
    });

    this.interpreter.defineBuiltin("minibuffer-set", (args) => {
      if (args.length !== 1) {
        throw new Error("minibuffer-set requires exactly 1 argument: text");
      }
      const textArg = args[0];
      if (!textArg || textArg.type !== "string") {
        throw new Error("minibuffer-set requires a string");
      }
      this.state.mxCommand = textArg.value;
      return createString(textArg.value);
    });

    this.interpreter.defineBuiltin("minibuffer-clear", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-clear requires no arguments");
      }
      this.state.mxCommand = "";
      return createNil();
    });

    this.interpreter.defineBuiltin("minibuffer-history", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-history requires no arguments");
      }
      const historyValues = this.commandHistory.map(cmd => createString(cmd));
      return createList(historyValues);
    });

    this.interpreter.defineBuiltin("minibuffer-history-add", (args) => {
      if (args.length !== 1) {
        throw new Error("minibuffer-history-add requires exactly 1 argument: command");
      }
      const commandArg = args[0];
      if (!commandArg || commandArg.type !== "string") {
        throw new Error("minibuffer-history-add requires a string");
      }
      const command = commandArg.value;
      // Don't add duplicates of the most recent command
      if (this.commandHistory.length === 0 || this.commandHistory[this.commandHistory.length - 1] !== command) {
        this.commandHistory.push(command);
      }
      // Reset history index
      this.historyIndex = this.commandHistory.length;
      return createNil();
    });

    this.interpreter.defineBuiltin("minibuffer-history-previous", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-history-previous requires no arguments");
      }
      if (this.commandHistory.length === 0) {
        this.state.statusMessage = "No command history";
        return createNil();
      }
      // Move to previous command in history
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.state.mxCommand = this.commandHistory[this.historyIndex];
      } else {
        // Already at oldest command
        this.state.statusMessage = "Already at oldest command";
      }
      return createString(this.state.mxCommand);
    });

    this.interpreter.defineBuiltin("minibuffer-history-next", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-history-next requires no arguments");
      }
      if (this.commandHistory.length === 0) {
        this.state.statusMessage = "No command history";
        return createNil();
      }
      // Move to next command in history
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
        this.state.mxCommand = this.commandHistory[this.historyIndex];
      } else if (this.historyIndex === this.commandHistory.length - 1) {
        // At end of history, clear input
        this.historyIndex = this.commandHistory.length;
        this.state.mxCommand = "";
      }
      return createString(this.state.mxCommand);
    });

    this.interpreter.defineBuiltin("minibuffer-history-reset-index", (args) => {
      if (args.length !== 0) {
        throw new Error("minibuffer-history-reset-index requires no arguments");
      }
      this.historyIndex = this.commandHistory.length;
      return createNil();
    });

    // Combined function for SPC ; that also resets history index
    this.interpreter.defineBuiltin("editor-enter-mx-mode", (args) => {
      if (args.length !== 0) {
        throw new Error("editor-enter-mx-mode requires no arguments");
      }
      this.spacePressed = false;
      this.state.mxCommand = "";
      this.state.mode = "mx";
      this.state.statusMessage = "";
      this.state.cursorFocus = 'command';
      this.historyIndex = this.commandHistory.length; // Reset history index
      return createString("mx");
    });

    // Which-key API functions (US-1.10.3)
    this.interpreter.defineBuiltin("which-key-enable", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-enable requires no arguments");
      }
      this.state.whichKeyTimeout = this.state.whichKeyTimeout || 1000;
      return createNil();
    });

    this.interpreter.defineBuiltin("which-key-disable", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-disable requires no arguments");
      }
      this.state.whichKeyTimeout = 0;
      this.state.whichKeyActive = false;
      this.state.whichKeyPrefix = "";
      this.state.whichKeyBindings = [];
      return createNil();
    });

    this.interpreter.defineBuiltin("which-key-timeout", (args) => {
      if (args.length !== 1) {
        throw new Error("which-key-timeout requires exactly 1 argument: milliseconds");
      }
      const timeoutArg = args[0];
      if (!timeoutArg || timeoutArg.type !== "number") {
        throw new Error("which-key-timeout requires a number");
      }
      const timeout = timeoutArg.value;
      if (timeout < 0) {
        throw new Error("which-key-timeout must be a positive number");
      }
      this.state.whichKeyTimeout = timeout;
      return createNumber(timeout);
    });

    this.interpreter.defineBuiltin("which-key-active", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-active requires no arguments");
      }
      return { type: "boolean", value: this.state.whichKeyActive || false };
    });

    this.interpreter.defineBuiltin("which-key-prefix", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-prefix requires no arguments");
      }
      return createString(this.state.whichKeyPrefix || "");
    });

    this.interpreter.defineBuiltin("which-key-bindings", (args) => {
      if (args.length !== 0) {
        throw new Error("which-key-bindings requires no arguments");
      }
      const bindings = this.state.whichKeyBindings || [];
      const bindingValues = bindings.map((binding: any) => {
        return createList([
          createString(binding.key),
          createString(binding.command),
        ]);
      });
      return createList(bindingValues);
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
    this.interpreter.defineBuiltin("macro-record-start", (args) => {
      if (args.length !== 1) {
        throw new Error("macro-record-start requires exactly 1 argument: register");
      }
      const registerArg = args[0];
      if (!registerArg || registerArg.type !== "string") {
        throw new Error("macro-record-start requires a string register");
      }
      const register = registerArg.value;

      const result = startRecording(register);
      if (Either.isLeft(result)) {
        throw new Error(result.left);
      }
      return createString(result.right);
    });

    // macro-record-stop: Stop recording and save macro
    this.interpreter.defineBuiltin("macro-record-stop", (args) => {
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
    this.interpreter.defineBuiltin("macro-record-key", (args) => {
      if (args.length !== 1) {
        throw new Error("macro-record-key requires exactly 1 argument: key");
      }
      const keyArg = args[0];
      if (!keyArg || keyArg.type !== "string") {
        throw new Error("macro-record-key requires a string key");
      }
      const key = keyArg.value;

      const result = recordKey(key);
      if (Either.isLeft(result)) {
        throw new Error(result.left);
      }
      return createString(result.right);
    });

    // macro-record-active: Check if currently recording
    this.interpreter.defineBuiltin("macro-record-active", (args) => {
      if (args.length !== 0) {
        throw new Error("macro-record-active requires no arguments");
      }
      return { type: "boolean", value: isRecording() };
    });

    // macro-record-register: Get current recording register
    this.interpreter.defineBuiltin("macro-record-register", (args) => {
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
    this.interpreter.defineBuiltin("macro-list", (args) => {
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
    this.interpreter.defineBuiltin("macro-execute", (args) => {
      if (args.length < 1 || args.length > 2) {
        throw new Error("macro-execute requires 1 or 2 arguments: register, optional count");
      }
      const registerArg = args[0];
      if (!registerArg || registerArg.type !== "string") {
        throw new Error("macro-execute requires a string register");
      }
      const register = registerArg.value;

      // Handle optional count parameter
      let count = 1;
      if (args.length === 2) {
        const countArg = args[1];
        if (!countArg || countArg.type !== "number") {
          throw new Error("macro-execute count must be a number");
        }
        count = countArg.value;
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
    this.interpreter.defineBuiltin("macro-execute-last", (args) => {
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
    this.interpreter.defineBuiltin("macro-last-executed", (args) => {
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
    this.interpreter.defineBuiltin("macro-clear", (args) => {
      if (args.length !== 0) {
        throw new Error("macro-clear requires no arguments");
      }
      clearAllMacros();
      return createNil();
    });

    // macro-clear-register: Clear a specific macro
    this.interpreter.defineBuiltin("macro-clear-register", (args) => {
      if (args.length !== 1) {
        throw new Error("macro-clear-register requires exactly 1 argument: register");
      }
      const registerArg = args[0];
      if (!registerArg || registerArg.type !== "string") {
        throw new Error("macro-clear-register requires a string register");
      }
      const register = registerArg.value;

      const result = clearMacro(register);
      if (Either.isLeft(result)) {
        throw new Error(result.left);
      }
      return createString(result.right);
    });

    // macro-record-reset: Reset macro recording state (for testing)
    this.interpreter.defineBuiltin("macro-record-reset", (args) => {
      if (args.length !== 0) {
        throw new Error("macro-record-reset requires no arguments");
      }
      resetMacroRecordingState();
      return createNil();
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
    const result = {
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

          // Load plugin.tlisp
          try {
            const pluginContent = await this.filesystem.readFile(pluginFilePath);
            const execResult = this.interpreter.execute(pluginContent);
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
        (key-bind ";" "(editor-enter-mx-mode)" "normal")
        (key-bind "Escape" "(editor-exit-mx-mode)" "mx")
        (key-bind "C-g" "(editor-exit-mx-mode)" "mx")
        (key-bind "Enter" "(editor-execute-mx-command)" "mx")
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
      case "\x13": return "C-v";
      case "\x14": return "C-w";
      case "\x15": return "C-x";
      case "\x16": return "C-y";
      case "\x17": return "C-z";
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

      // Notify LSP client about file open (US-3.1.1)
      await this.lspClient.onFileOpen(filename, content);

      // Simulate diagnostics from language server (US-3.1.2)
      await this.lspClient.simulateDiagnostics(filename, content);

      // Update editor state with diagnostics (US-3.1.2)
      this.state.lspDiagnostics = this.lspClient.getDiagnostics();

      // Update status message with LSP connection status (US-3.1.1)
      const lspStatus = this.lspClient.getStatusMessage();
      this.state.statusMessage = lspStatus ? `Opened ${filename} - ${lspStatus}` : `Opened ${filename}`;
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

    // Load saved macros from ~/.config/tmax/macros.tlisp (US-2.4.2)
    await this.loadSavedMacros();

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
}