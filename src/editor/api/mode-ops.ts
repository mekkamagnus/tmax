/**
 * @file mode-ops.ts
 * @description Mode operations for T-Lisp editor API
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType
} from "../../utils/validation.ts";
import {
  ValidationError,
  createValidationError,
  AppError
} from "../../error/types.ts";

/**
 * T-Lisp function implementation that returns Either for error handling
 */
export type TLispFunctionWithEither = (args: TLispValue[]) => Either<AppError, TLispValue>;

/**
 * Create mode operations API functions
 * @param getMode - Function to get current editor mode
 * @param setMode - Function to set current editor mode
 * @param getStatusMessage - Function to get current status message
 * @param setStatusMessage - Function to set current status message
 * @param getCommandLine - Function to get current command line
 * @param setCommandLine - Function to set current command line
 * @param getSpacePressed - Function to get space pressed state
 * @param setSpacePressed - Function to set space pressed state
 * @param getMxCommand - Function to get current M-x command
 * @param setMxCommand - Function to set current M-x command
 * @param getCursorFocus - Function to get cursor focus state
 * @param setCursorFocus - Function to set cursor focus state
 * @returns Map of mode function names to implementations
 */
export function createModeOps(
  getMode: () => "normal" | "insert" | "visual" | "command" | "mx",
  setMode: (mode: "normal" | "insert" | "visual" | "command" | "mx") => void,
  getStatusMessage: () => string,
  setStatusMessage: (message: string) => void,
  getCommandLine: () => string,
  setCommandLine: (command: string) => void,
  getSpacePressed: () => boolean,
  setSpacePressed: (pressed: boolean) => void,
  getMxCommand: () => string,
  setMxCommand: (command: string) => void,
  getCursorFocus: () => 'buffer' | 'command',
  setCursorFocus: (focus: 'buffer' | 'command') => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  api.set("editor-mode", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-mode");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createString(getMode()));
  });

  api.set("editor-set-mode", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "editor-set-mode");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const modeArg = args[0];
    const typeValidation = validateArgType(modeArg, "string", 0, "editor-set-mode");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const mode = modeArg.value as string;
    const validModes = ['normal', 'insert', 'visual', 'command', 'mx'];
    if (!validModes.includes(mode)) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        `Invalid mode: ${mode}`,
        'mode',
        mode,
        'valid mode'
      ));
    }

    setMode(mode as "normal" | "insert" | "visual" | "command" | "mx");

    return Either.right(createString(mode));
  });

  // Status functions
  api.set("editor-status", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-status");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createString(getStatusMessage()));
  });

  api.set("editor-set-status", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "editor-set-status");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const messageArg = args[0];
    const typeValidation = validateArgType(messageArg, "string", 0, "editor-set-status");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    setStatusMessage(messageArg.value as string);

    return Either.right(createString(getStatusMessage()));
  });

  // Command line functions
  api.set("editor-command-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-command-line");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createString(getCommandLine()));
  });

  api.set("editor-set-command-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "editor-set-command-line");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const textArg = args[0];
    const typeValidation = validateArgType(textArg, "string", 0, "editor-set-command-line");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    setCommandLine(textArg.value as string);

    return Either.right(createString(getCommandLine()));
  });

  api.set("editor-enter-command-mode", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-enter-command-mode");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    setCommandLine("");
    setMode("command");
    setCursorFocus('command');

    return Either.right(createString("command"));
  });

  api.set("editor-exit-command-mode", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-exit-command-mode");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    setCommandLine("");
    setMode("normal");
    setCursorFocus('buffer');

    return Either.right(createString("normal"));
  });

  api.set("editor-exit-mx-mode", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-exit-mx-mode");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    setMxCommand("");
    setMode("normal");
    setSpacePressed(false);
    setStatusMessage("");
    setCursorFocus('buffer');

    return Either.right(createString("normal"));
  });

  // M-x (Emacs-style) functionality
  api.set("editor-handle-space", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-handle-space");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    setSpacePressed(true);
    setStatusMessage("SPC-");

    return Either.right(createString("space"));
  });

  api.set("editor-handle-semicolon", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-handle-semicolon");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    if (getSpacePressed()) {
      // SPC ; sequence - enter M-x mode
      setSpacePressed(false);
      setMxCommand("");
      setMode("mx");
      setStatusMessage("");
      setCursorFocus('command');
      
      // Note: History index reset will be handled by the editor
      // through a separate mechanism (mode change detection)
    } else {
      // Just a semicolon in normal mode
      setStatusMessage("Unbound key: ;");
    }

    return Either.right(createString("semicolon"));
  });

  api.set("editor-execute-mx-command", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-execute-mx-command");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const command = getMxCommand().trim();

    if (command === "") {
      // Empty command, just exit
      setMxCommand("");
      setMode("normal");
      setCursorFocus('buffer');
      return Either.right(createString(""));
    }

    // Try to execute as T-Lisp function call
    // Add parentheses if not present to make it a function call
    const tlispCommand = command.includes("(") ? command : `(${command})`;

    // Note: This would need access to the interpreter instance
    // For now, we'll handle some built-in commands
    if (command === "editor-quit" || command === "quit") {
      // Return quit signal instead of throwing
      return Either.right(createString("EDITOR_QUIT_SIGNAL"));
    } else if (command === "buffer-create") {
      setStatusMessage("buffer-create requires arguments");
    } else if (command === "editor-mode") {
      setStatusMessage(`Current mode: ${getMode()}`);
    } else {
      setStatusMessage(`Executed: ${command}`);
    }

    // Clear M-x command and return to normal mode
    setMxCommand("");
    setMode("normal");
    setCursorFocus('buffer');

    return Either.right(createString(command));
  });

  return api;
}