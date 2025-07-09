/**
 * @file tlisp-api.ts
 * @description T-Lisp editor API functions that bridge TypeScript core with T-Lisp extensibility
 */

import type { TLispValue, TLispFunctionImpl } from "../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../tlisp/values.ts";
import { TextBufferImpl } from "../core/buffer.ts";
import type { TerminalIO, FileSystem, TextBuffer } from "../core/types.ts";

/**
 * Editor state that can be accessed from T-Lisp
 */
export interface EditorState {
  currentBuffer: TextBuffer | null;
  buffers: Map<string, TextBuffer>;
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
}

/**
 * Create T-Lisp editor API functions
 * @param state - Editor state
 * @returns Map of function names to implementations
 */
export function createEditorAPI(state: EditorState): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  // Buffer management functions
  api.set("buffer-create", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("buffer-create requires exactly 1 argument: name");
    }
    
    const nameArg = args[0];
    if (!nameArg || nameArg.type !== "string") {
      throw new Error("buffer-create requires a string name");
    }
    
    const name = nameArg.value as string;
    const buffer = new TextBufferImpl("");
    state.buffers.set(name, buffer);
    
    return createString(name);
  });

  api.set("buffer-switch", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("buffer-switch requires exactly 1 argument: name");
    }
    
    const nameArg = args[0];
    if (!nameArg || nameArg.type !== "string") {
      throw new Error("buffer-switch requires a string name");
    }
    
    const name = nameArg.value as string;
    const buffer = state.buffers.get(name);
    if (!buffer) {
      throw new Error(`Buffer '${name}' not found`);
    }
    
    state.currentBuffer = buffer;
    return createString(name);
  });

  api.set("buffer-current", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("buffer-current requires no arguments");
    }
    
    if (!state.currentBuffer) {
      return createNil();
    }
    
    // Find the buffer name
    for (const [name, buffer] of state.buffers) {
      if (buffer === state.currentBuffer) {
        return createString(name);
      }
    }
    
    return createNil();
  });

  api.set("buffer-list", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("buffer-list requires no arguments");
    }
    
    const bufferNames = Array.from(state.buffers.keys()).map(name => createString(name));
    return createList(bufferNames);
  });

  // Cursor movement functions
  api.set("cursor-position", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("cursor-position requires no arguments");
    }
    
    return createList([createNumber(state.cursorLine), createNumber(state.cursorColumn)]);
  });

  api.set("cursor-move", (args: TLispValue[]): TLispValue => {
    if (args.length !== 2) {
      throw new Error("cursor-move requires exactly 2 arguments: line, column");
    }
    
    const lineArg = args[0];
    const columnArg = args[1];
    
    if (!lineArg || lineArg.type !== "number") {
      throw new Error("cursor-move requires a number for line");
    }
    
    if (!columnArg || columnArg.type !== "number") {
      throw new Error("cursor-move requires a number for column");
    }
    
    const line = lineArg.value as number;
    const column = columnArg.value as number;
    
    // Validate bounds
    if (!state.currentBuffer) {
      throw new Error("No current buffer");
    }
    
    const maxLine = state.currentBuffer.getLineCount();
    const targetLine = Math.max(0, Math.min(line, maxLine - 1));
    const lineLength = state.currentBuffer.getLine(targetLine).length;
    const targetColumn = Math.max(0, Math.min(column, lineLength));
    
    state.cursorLine = targetLine;
    state.cursorColumn = targetColumn;
    
    return createList([createNumber(state.cursorLine), createNumber(state.cursorColumn)]);
  });

  api.set("cursor-line", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("cursor-line requires no arguments");
    }
    
    return createNumber(state.cursorLine);
  });

  api.set("cursor-column", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("cursor-column requires no arguments");
    }
    
    return createNumber(state.cursorColumn);
  });

  // Text access functions
  api.set("buffer-text", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("buffer-text requires no arguments");
    }
    
    if (!state.currentBuffer) {
      throw new Error("No current buffer");
    }
    
    return createString(state.currentBuffer.getContent());
  });

  api.set("buffer-line", (args: TLispValue[]): TLispValue => {
    if (args.length > 1) {
      throw new Error("buffer-line requires 0 or 1 argument: optional line number");
    }
    
    if (!state.currentBuffer) {
      throw new Error("No current buffer");
    }
    
    let lineNumber = state.cursorLine;
    if (args.length === 1) {
      const lineArg = args[0];
      if (!lineArg || lineArg.type !== "number") {
        throw new Error("buffer-line requires a number for line");
      }
      lineNumber = lineArg.value as number;
    }
    
    if (lineNumber < 0 || lineNumber >= state.currentBuffer.getLineCount()) {
      throw new Error(`Line number ${lineNumber} out of bounds`);
    }
    
    return createString(state.currentBuffer.getLine(lineNumber));
  });

  api.set("buffer-lines", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("buffer-lines requires no arguments");
    }
    
    if (!state.currentBuffer) {
      throw new Error("No current buffer");
    }
    
    const lines: TLispValue[] = [];
    for (let i = 0; i < state.currentBuffer.getLineCount(); i++) {
      lines.push(createString(state.currentBuffer.getLine(i)));
    }
    
    return createList(lines);
  });

  api.set("buffer-line-count", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("buffer-line-count requires no arguments");
    }
    
    if (!state.currentBuffer) {
      throw new Error("No current buffer");
    }
    
    return createNumber(state.currentBuffer.getLineCount());
  });

  // Text editing functions
  api.set("buffer-insert", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("buffer-insert requires exactly 1 argument: text");
    }
    
    if (!state.currentBuffer) {
      throw new Error("No current buffer");
    }
    
    const textArg = args[0];
    if (!textArg || textArg.type !== "string") {
      throw new Error("buffer-insert requires a string");
    }
    
    const text = textArg.value as string;
    const position = { line: state.cursorLine, column: state.cursorColumn };
    
    state.currentBuffer.insert(position, text);
    
    // Update cursor position based on inserted text
    if (text.includes('\n')) {
      // Handle newlines: count how many lines were added and position cursor at end
      const lines = text.split('\n');
      const newLinesAdded = lines.length - 1;
      state.cursorLine += newLinesAdded;
      
      // If text ends with newline, cursor goes to beginning of new line
      // Otherwise, cursor goes to end of the last line
      if (text.endsWith('\n')) {
        state.cursorColumn = 0;
      } else {
        state.cursorColumn = lines[lines.length - 1].length;
      }
    } else {
      // No newlines, just advance column
      state.cursorColumn += text.length;
    }
    
    return createString(text);
  });

  api.set("buffer-delete", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("buffer-delete requires exactly 1 argument: count");
    }
    
    if (!state.currentBuffer) {
      throw new Error("No current buffer");
    }
    
    const countArg = args[0];
    if (!countArg || countArg.type !== "number") {
      throw new Error("buffer-delete requires a number");
    }
    
    const count = countArg.value as number;
    
    // Handle backspace (delete characters before cursor)
    if (count > 0) {
      // Move cursor back by count characters
      let newColumn = state.cursorColumn - count;
      let newLine = state.cursorLine;
      
      // Handle line boundaries
      if (newColumn < 0) {
        if (newLine > 0) {
          newLine--;
          const prevLineLength = state.currentBuffer.getLine(newLine).length;
          newColumn = prevLineLength + newColumn + 1; // +1 for the newline
        } else {
          newColumn = 0;
        }
      }
      
      // Create range for deletion
      const startPos = { line: newLine, column: newColumn };
      const endPos = { line: state.cursorLine, column: state.cursorColumn };
      const range = { start: startPos, end: endPos };
      
      // Delete the range
      state.currentBuffer.delete(range);
      
      // Update cursor position
      state.cursorLine = newLine;
      state.cursorColumn = newColumn;
    }
    
    return createString("deleted");
  });

  // Mode functions
  api.set("editor-mode", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("editor-mode requires no arguments");
    }
    
    return createString(state.mode);
  });

  api.set("editor-set-mode", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("editor-set-mode requires exactly 1 argument: mode");
    }
    
    const modeArg = args[0];
    if (!modeArg || modeArg.type !== "string") {
      throw new Error("editor-set-mode requires a string");
    }
    
    const mode = modeArg.value as string;
    if (!["normal", "insert", "visual", "command", "mx"].includes(mode)) {
      throw new Error(`Invalid mode: ${mode}`);
    }
    
    state.mode = mode as "normal" | "insert" | "visual" | "command" | "mx";
    
    return createString(mode);
  });

  // Status functions
  api.set("editor-status", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("editor-status requires no arguments");
    }
    
    return createString(state.statusMessage);
  });

  api.set("editor-set-status", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("editor-set-status requires exactly 1 argument: message");
    }
    
    const messageArg = args[0];
    if (!messageArg || messageArg.type !== "string") {
      throw new Error("editor-set-status requires a string");
    }
    
    state.statusMessage = messageArg.value as string;
    
    return createString(state.statusMessage);
  });

  // Editor control functions
  api.set("editor-quit", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("editor-quit requires no arguments");
    }
    
    // Signal the editor to stop
    // This will be handled by the main editor loop
    throw new Error("EDITOR_QUIT_SIGNAL");
  });

  // Command line functions
  api.set("editor-command-line", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("editor-command-line requires no arguments");
    }
    
    return createString(state.commandLine);
  });

  api.set("editor-set-command-line", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("editor-set-command-line requires exactly 1 argument: text");
    }
    
    const textArg = args[0];
    if (!textArg || textArg.type !== "string") {
      throw new Error("editor-set-command-line requires a string");
    }
    
    state.commandLine = textArg.value as string;
    
    return createString(state.commandLine);
  });

  api.set("editor-enter-command-mode", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("editor-enter-command-mode requires no arguments");
    }
    
    state.commandLine = "";
    state.mode = "command";
    
    return createString("command");
  });

  api.set("editor-exit-command-mode", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("editor-exit-command-mode requires no arguments");
    }
    
    state.commandLine = "";
    state.mode = "normal";
    
    return createString("normal");
  });

  api.set("editor-execute-command-line", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("editor-execute-command-line requires no arguments");
    }
    
    const command = state.commandLine.trim();
    
    // Handle basic commands
    if (command === "q" || command === "quit") {
      throw new Error("EDITOR_QUIT_SIGNAL");
    } else if (command === "w" || command === "write") {
      // TODO: Implement save functionality
      state.statusMessage = "Save functionality not implemented yet";
    } else if (command === "wq") {
      // TODO: Implement save and quit
      state.statusMessage = "Save and quit functionality not implemented yet";
    } else if (command.startsWith("e ") || command.startsWith("edit ")) {
      // TODO: Implement file opening
      const filename = command.split(" ")[1];
      state.statusMessage = `Edit ${filename} not implemented yet`;
    } else if (command === "") {
      // Empty command, do nothing
    } else {
      // Try to execute as T-Lisp command
      try {
        // Note: This is a simplified approach. In a full implementation,
        // you might want to have a separate command parser
        state.statusMessage = `Unknown command: ${command}`;
      } catch (error) {
        state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    // Clear command line and return to normal mode
    state.commandLine = "";
    state.mode = "normal";
    
    return createString(command);
  });

  // M-x (Emacs-style) functionality
  api.set("editor-handle-space", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("editor-handle-space requires no arguments");
    }
    
    state.spacePressed = true;
    state.statusMessage = "SPC-";
    
    return createString("space");
  });

  api.set("editor-handle-semicolon", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("editor-handle-semicolon requires no arguments");
    }
    
    if (state.spacePressed) {
      // SPC ; sequence - enter M-x mode
      state.spacePressed = false;
      state.mxCommand = "";
      state.mode = "mx";
      state.statusMessage = "";
    } else {
      // Just a semicolon in normal mode
      state.statusMessage = "Unbound key: ;";
    }
    
    return createString("semicolon");
  });

  api.set("editor-exit-mx-mode", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("editor-exit-mx-mode requires no arguments");
    }
    
    state.mxCommand = "";
    state.mode = "normal";
    state.spacePressed = false;
    state.statusMessage = "";
    
    return createString("normal");
  });

  api.set("editor-execute-mx-command", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      throw new Error("editor-execute-mx-command requires no arguments");
    }
    
    const command = state.mxCommand.trim();
    
    if (command === "") {
      // Empty command, just exit
      state.mxCommand = "";
      state.mode = "normal";
      return createString("");
    }
    
    // Try to execute as T-Lisp function call
    try {
      // Add parentheses if not present to make it a function call
      const tlispCommand = command.includes("(") ? command : `(${command})`;
      
      // Note: This would need access to the interpreter instance
      // For now, we'll handle some built-in commands
      if (command === "editor-quit" || command === "quit") {
        throw new Error("EDITOR_QUIT_SIGNAL");
      } else if (command === "buffer-create") {
        state.statusMessage = "buffer-create requires arguments";
      } else if (command === "cursor-position") {
        state.statusMessage = `Cursor: line ${state.cursorLine + 1}, column ${state.cursorColumn + 1}`;
      } else if (command === "editor-mode") {
        state.statusMessage = `Current mode: ${state.mode}`;
      } else {
        state.statusMessage = `Executed: ${command}`;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
        throw error; // Re-throw quit signal
      }
      state.statusMessage = `M-x error: ${error instanceof Error ? error.message : String(error)}`;
    }
    
    // Clear M-x command and return to normal mode
    state.mxCommand = "";
    state.mode = "normal";
    
    return createString(command);
  });

  // File operations - Note: These are placeholders since T-Lisp can't handle async operations
  // File operations should be handled through editor commands instead
  api.set("file-read", (args: TLispValue[]): TLispValue => {
    throw new Error("file-read not implemented - use editor file operations instead");
  });

  api.set("file-write", (args: TLispValue[]): TLispValue => {
    throw new Error("file-write not implemented - use editor file operations instead");
  });

  return api;
}