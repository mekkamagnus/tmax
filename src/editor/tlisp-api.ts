/**
 * @file tlisp-api.ts
 * @description T-Lisp editor API functions that bridge TypeScript core with T-Lisp extensibility
 */

import type { TLispValue, TLispFunctionImpl } from "../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../tlisp/values.ts";
import { FunctionalTextBufferImpl } from "../core/buffer.ts";
import type { TerminalIO, FileSystem, FunctionalTextBuffer } from "../core/types.ts";
import { Either } from "../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType,
  validateBufferExists
} from "../utils/validation.ts";
import {
  ValidationError,
  createValidationError,
  createBufferError,
  AppError
} from "../error/types.ts";

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
  operations?: EditorOperations;  // Optional operations reference
}

/**
 * Create T-Lisp editor API functions
 * @param state - T-Lisp editor state bridge
 * @returns Map of function names to implementations
 */
export function createEditorAPI(state: TlispEditorState): Map<string, TLispFunctionWithEither> {
  const api = new Map<string, TLispFunctionWithEither>();

  // Buffer management functions
  api.set("buffer-create", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "buffer-create");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const nameArg = args[0];
    const typeValidation = validateArgType(nameArg, "string", 0, "buffer-create");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const name = nameArg.value as string;
    const buffer = FunctionalTextBufferImpl.create("");
    state.buffers.set(name, buffer);

    return Either.right(createString(name));
  });

  api.set("buffer-switch", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "buffer-switch");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const nameArg = args[0];
    const typeValidation = validateArgType(nameArg, "string", 0, "buffer-switch");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const name = nameArg.value as string;
    const buffer = state.buffers.get(name);
    const bufferExistsValidation = validateBufferExists(buffer, name);
    if (Either.isLeft(bufferExistsValidation)) {
      return Either.left(bufferExistsValidation.left);
    }

    state.currentBuffer = buffer!;
    return Either.right(createString(name));
  });

  api.set("buffer-current", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "buffer-current");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (!state.currentBuffer) {
      return Either.right(createNil());
    }

    // Find the buffer name
    for (const [name, buffer] of state.buffers) {
      if (buffer === state.currentBuffer) {
        return Either.right(createString(name));
      }
    }

    return Either.right(createNil());
  });

  api.set("buffer-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "buffer-list");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const bufferNames = Array.from(state.buffers.keys()).map(name => createString(name));
    return Either.right(createList(bufferNames));
  });

  // Cursor movement functions
  api.set("cursor-position", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "cursor-position");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createList([createNumber(state.cursorLine), createNumber(state.cursorColumn)]));
  });

  api.set("cursor-move", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 2, "cursor-move");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    const lineArg = args[0];
    const lineTypeValidation = validateArgType(lineArg, "number", 0, "cursor-move");
    if (Either.isLeft(lineTypeValidation)) {
      return createString(`Error: ${lineTypeValidation.left.message}`);
    }

    const columnArg = args[1];
    const columnTypeValidation = validateArgType(columnArg, "number", 1, "cursor-move");
    if (Either.isLeft(columnTypeValidation)) {
      return createString(`Error: ${columnTypeValidation.left.message}`);
    }

    const line = lineArg.value as number;
    const column = columnArg.value as number;

    // Validate buffer exists
    const bufferValidation = validateBufferExists(state.currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return createString(`Error: ${bufferValidation.left.message}`);
    }

    const lineCountResult = state.currentBuffer!.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      return createString(`Error: Failed to get line count: ${lineCountResult.left}`);
    }

    const maxLine = lineCountResult.right;
    const targetLine = Math.max(0, Math.min(line, maxLine - 1));

    const lineResult = state.currentBuffer!.getLine(targetLine);
    if (Either.isLeft(lineResult)) {
      return createString(`Error: Failed to get line: ${lineResult.left}`);
    }

    const lineLength = lineResult.right.length;
    const targetColumn = Math.max(0, Math.min(column, lineLength));

    state.cursorLine = targetLine;
    state.cursorColumn = targetColumn;

    return createList([createNumber(state.cursorLine), createNumber(state.cursorColumn)]);
  });

  api.set("cursor-line", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "cursor-line");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    return createNumber(state.cursorLine);
  });

  api.set("cursor-column", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "cursor-column");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    return createNumber(state.cursorColumn);
  });

  // Text access functions
  api.set("buffer-text", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "buffer-text");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    const bufferValidation = validateBufferExists(state.currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return createString(`Error: ${bufferValidation.left.message}`);
    }

    const contentResult = state.currentBuffer!.getContent();

    // Handle Either<BufferError, string>
    if (Either.isLeft(contentResult)) {
      // Return error message as string
      return createString(`Error: ${contentResult.left}`);
    }

    return createString(contentResult.right);
  });

  api.set("buffer-line", (args: TLispValue[]): TLispValue => {
    if (args.length > 1) {
      return createString("Error: buffer-line requires 0 or 1 argument: optional line number");
    }

    const bufferValidation = validateBufferExists(state.currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return createString(`Error: ${bufferValidation.left.message}`);
    }

    let lineNumber = state.cursorLine;
    if (args.length === 1) {
      const lineArg = args[0];
      const typeValidation = validateArgType(lineArg, "number", 0, "buffer-line");
      if (Either.isLeft(typeValidation)) {
        return createString(`Error: ${typeValidation.left.message}`);
      }
      lineNumber = lineArg.value as number;
    }

    const lineCountResult = state.currentBuffer!.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      return createString(`Error: Failed to get line count: ${lineCountResult.left}`);
    }

    if (lineNumber < 0 || lineNumber >= lineCountResult.right) {
      return createString(`Error: Line number ${lineNumber} out of bounds`);
    }

    const lineResult = state.currentBuffer!.getLine(lineNumber);
    if (Either.isLeft(lineResult)) {
      return createString(`Error: Failed to get line: ${lineResult.left}`);
    }

    return createString(lineResult.right);
  });

  api.set("buffer-lines", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "buffer-lines");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    const bufferValidation = validateBufferExists(state.currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return createString(`Error: ${bufferValidation.left.message}`);
    }

    const lineCountResult = state.currentBuffer!.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      return createString(`Error: Failed to get line count: ${lineCountResult.left}`);
    }

    const lines: TLispValue[] = [];
    for (let i = 0; i < lineCountResult.right; i++) {
      const lineResult = state.currentBuffer!.getLine(i);
      if (Either.isLeft(lineResult)) {
        return createString(`Error reading line ${i}: ${lineResult.left}`);
      }
      lines.push(createString(lineResult.right));
    }

    return createList(lines);
  });

  api.set("buffer-line-count", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "buffer-line-count");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    const bufferValidation = validateBufferExists(state.currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return createString(`Error: ${bufferValidation.left.message}`);
    }

    const lineCountResult = state.currentBuffer!.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      return createString(`Error: Failed to get line count: ${lineCountResult.left}`);
    }

    return createNumber(lineCountResult.right);
  });

  // Text editing functions
  api.set("buffer-insert", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 1, "buffer-insert");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    const bufferValidation = validateBufferExists(state.currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return createString(`Error: ${bufferValidation.left.message}`);
    }

    const textArg = args[0];
    const typeValidation = validateArgType(textArg, "string", 0, "buffer-insert");
    if (Either.isLeft(typeValidation)) {
      return createString(`Error: ${typeValidation.left.message}`);
    }

    const text = textArg.value as string;
    const position = { line: state.cursorLine, column: state.cursorColumn };

    const insertResult = state.currentBuffer!.insert(position, text);
    if (Either.isLeft(insertResult)) {
      return createString(`Error: Failed to insert text: ${insertResult.left}`);
    }

    // Update buffer with new immutable buffer
    state.currentBuffer = insertResult.right;

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
    const argsValidation = validateArgsCount(args, 1, "buffer-delete");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    const bufferValidation = validateBufferExists(state.currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return createString(`Error: ${bufferValidation.left.message}`);
    }

    const countArg = args[0];
    const typeValidation = validateArgType(countArg, "number", 0, "buffer-delete");
    if (Either.isLeft(typeValidation)) {
      return createString(`Error: ${typeValidation.left.message}`);
    }

    const count = countArg.value as number;

    // Delete characters starting from cursor position (forward delete)
    if (count > 0) {
      const startPos = { line: state.cursorLine, column: state.cursorColumn };

      // Calculate end position (could span multiple lines)
      let endLine = state.cursorLine;
      let endColumn = state.cursorColumn + count;

      // For simplicity, just delete from current position forward on same line
      // Multi-line deletion would require more complex logic
      const endPos = { line: endLine, column: endColumn };
      const range = { start: startPos, end: endPos };

      // Delete the range
      const deleteResult = state.currentBuffer!.delete(range);
      if (Either.isLeft(deleteResult)) {
        return createString(`Error: Failed to delete: ${deleteResult.left}`);
      }

      // Update buffer with new immutable buffer
      state.currentBuffer = deleteResult.right;

      // Cursor stays at same position (content after it shifts forward)
    }

    return createString("deleted");
  });

  // Mode functions
  api.set("editor-mode", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "editor-mode");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    return createString(state.mode);
  });

  api.set("editor-set-mode", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 1, "editor-set-mode");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    const modeArg = args[0];
    const typeValidation = validateArgType(modeArg, "string", 0, "editor-set-mode");
    if (Either.isLeft(typeValidation)) {
      return createString(`Error: ${typeValidation.left.message}`);
    }

    const mode = modeArg.value as string;
    const modeValidation = validateEditorMode(mode);
    if (Either.isLeft(modeValidation)) {
      return createString(`Error: ${modeValidation.left.message}`);
    }

    state.mode = mode as "normal" | "insert" | "visual" | "command" | "mx";

    return createString(mode);
  });

  // Status functions
  api.set("editor-status", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "editor-status");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    return createString(state.statusMessage);
  });

  api.set("editor-set-status", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 1, "editor-set-status");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    const messageArg = args[0];
    const typeValidation = validateArgType(messageArg, "string", 0, "editor-set-status");
    if (Either.isLeft(typeValidation)) {
      return createString(`Error: ${typeValidation.left.message}`);
    }

    state.statusMessage = messageArg.value as string;

    return createString(state.statusMessage);
  });

  // Editor control functions
  api.set("editor-quit", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "editor-quit");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    // Signal the editor to stop
    // This will be handled by the main editor loop
    // For now, return a special quit signal value instead of throwing
    return createString("EDITOR_QUIT_SIGNAL");
  });

  // Command line functions
  api.set("editor-command-line", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "editor-command-line");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    return createString(state.commandLine);
  });

  api.set("editor-set-command-line", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 1, "editor-set-command-line");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    const textArg = args[0];
    const typeValidation = validateArgType(textArg, "string", 0, "editor-set-command-line");
    if (Either.isLeft(typeValidation)) {
      return createString(`Error: ${typeValidation.left.message}`);
    }

    state.commandLine = textArg.value as string;

    return createString(state.commandLine);
  });

  api.set("editor-enter-command-mode", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "editor-enter-command-mode");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    state.commandLine = "";
    state.mode = "command";

    return createString("command");
  });

  api.set("editor-exit-command-mode", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "editor-exit-command-mode");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    state.commandLine = "";
    state.mode = "normal";

    return createString("normal");
  });

  api.set("editor-execute-command-line", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "editor-execute-command-line");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    const command = state.commandLine.trim();

    // Handle basic commands
    if (command === "q" || command === "quit") {
      // Return quit signal instead of throwing
      return createString("EDITOR_QUIT_SIGNAL");
    } else if (command === "w" || command === "write") {
      // Save current buffer
      if (state.operations?.saveFile) {
        state.statusMessage = "Saving...";
        // Fire and forget - the editor will update status after save
        state.operations.saveFile().then(() => {
          // Find buffer name for status message
          let filename = "";
          for (const [name, buffer] of state.buffers) {
            if (buffer === state.currentBuffer) {
              filename = name;
              break;
            }
          }
          state.statusMessage = `Saved ${filename}`;
        }).catch((error) => {
          state.statusMessage = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
        });
      } else {
        state.statusMessage = "Save functionality not available";
      }
    } else if (command === "wq") {
      // Save and quit
      if (state.operations?.saveFile) {
        state.statusMessage = "Saving and quitting...";
        state.operations.saveFile().then(() => {
          // Return quit signal instead of throwing
          return createString("EDITOR_QUIT_SIGNAL");
        }).catch((error) => {
          state.statusMessage = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
        });
      } else {
        state.statusMessage = "Save and quit functionality not available";
      }
    } else if (command.startsWith("e ") || command.startsWith("edit ")) {
      // TODO: Implement file opening
      const filename = command.split(" ")[1];
      state.statusMessage = `Edit ${filename} not implemented yet`;
    } else if (command === "") {
      // Empty command, do nothing
    } else {
      // Try to execute as T-Lisp command
      // Note: This is a simplified approach. In a full implementation,
      // you might want to have a separate command parser
      state.statusMessage = `Unknown command: ${command}`;
    }

    // Clear command line and return to normal mode
    state.commandLine = "";
    state.mode = "normal";

    return createString(command);
  });

  // M-x (Emacs-style) functionality
  api.set("editor-handle-space", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "editor-handle-space");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    state.spacePressed = true;
    state.statusMessage = "SPC-";

    return createString("space");
  });

  api.set("editor-handle-semicolon", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "editor-handle-semicolon");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
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
    const argsValidation = validateArgsCount(args, 0, "editor-exit-mx-mode");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    state.mxCommand = "";
    state.mode = "normal";
    state.spacePressed = false;
    state.statusMessage = "";

    return createString("normal");
  });

  api.set("editor-execute-mx-command", (args: TLispValue[]): TLispValue => {
    const argsValidation = validateArgsCount(args, 0, "editor-execute-mx-command");
    if (Either.isLeft(argsValidation)) {
      return createString(`Error: ${argsValidation.left.message}`);
    }

    const command = state.mxCommand.trim();

    if (command === "") {
      // Empty command, just exit
      state.mxCommand = "";
      state.mode = "normal";
      return createString("");
    }

    // Try to execute as T-Lisp function call
    // Add parentheses if not present to make it a function call
    const tlispCommand = command.includes("(") ? command : `(${command})`;

    // Note: This would need access to the interpreter instance
    // For now, we'll handle some built-in commands
    if (command === "editor-quit" || command === "quit") {
      // Return quit signal instead of throwing
      return createString("EDITOR_QUIT_SIGNAL");
    } else if (command === "buffer-create") {
      state.statusMessage = "buffer-create requires arguments";
    } else if (command === "cursor-position") {
      state.statusMessage = `Cursor: line ${state.cursorLine + 1}, column ${state.cursorColumn + 1}`;
    } else if (command === "editor-mode") {
      state.statusMessage = `Current mode: ${state.mode}`;
    } else {
      state.statusMessage = `Executed: ${command}`;
    }

    // Clear M-x command and return to normal mode
    state.mxCommand = "";
    state.mode = "normal";

    return createString(command);
  });

  // File operations - Note: These are placeholders since T-Lisp can't handle async operations
  // File operations should be handled through editor commands instead
  api.set("file-read", (args: TLispValue[]): TLispValue => {
    return createString("Error: file-read not implemented - use editor file operations instead");
  });

  api.set("file-write", (args: TLispValue[]): TLispValue => {
    return createString("Error: file-write not implemented - use editor file operations instead");
  });

  return api;
}