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
import { State, stateUtils } from "../../utils/state.ts";
import type { EditorModel } from "../functional/model.ts";
import { runModel, type EditorModelAccess } from "./state-context.ts";

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
 * @param setSpacePressed - Function to set space pressed state
 * @param getCursorFocus - Function to get cursor focus state
 * @param setCursorFocus - Function to set cursor focus state
 * @returns Map of mode function names to implementations
 */
export function createModeOps(
  modelAccess: EditorModelAccess,
  getStatusMessage: () => string,
  setStatusMessage: (message: string) => void,
  getCommandLine: () => string,
  setCommandLine: (command: string) => void,
  setSpacePressed: (pressed: boolean) => void,
  getCursorFocus: () => 'buffer' | 'command',
  setCursorFocus: (focus: 'buffer' | 'command') => void
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: mode read/write now flow through the State monad against
  // EditorModel, replacing the old getMode/setMode callbacks. The body below
  // still calls getMode()/setMode but those are now State-backed.
  type EditorMode = EditorModel["mode"];
  const getMode = (): EditorMode => runModel(modelAccess, State.gets<EditorModel, EditorMode>(m => m.mode));
  const setMode = (mode: EditorMode): void => {
    runModel(modelAccess, stateUtils.updateProperty<EditorModel, "mode">("mode", mode));
  };
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

    const modeArg = args[0]!
    const typeValidation = validateArgType(modeArg, "string", 0, "editor-set-mode");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const mode = modeArg.value as string;
    const validModes = ['normal', 'insert', 'visual', 'command', 'mx', 'replace'];
    if (!validModes.includes(mode)) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        `Invalid mode: ${mode}`,
        'mode',
        mode,
        'valid mode'
      ));
    }

    setMode(mode as "normal" | "insert" | "visual" | "command" | "mx" | "replace");

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

    const messageArg = args[0]!
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

    const textArg = args[0]!
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

  // Low-level prefix state used by T-Lisp key semantics.
  api.set("editor-handle-space", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-handle-space");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    setSpacePressed(true);
    setStatusMessage("SPC-");

    return Either.right(createString("space"));
  });

  // Help prefix handler (US-1.11.2)
  api.set("editor-handle-help-prefix", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-handle-help-prefix");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    // Set a flag to indicate we're in help prefix mode
    // The next key will determine which help function to call
    setStatusMessage("Help: (k)ey, (f)unction");
    
    return Either.right(createString("help-prefix"));
  });

  // Window prefix handler (US-3.2.2)
  // C-w prefix for window management commands
  api.set("editor-handle-window-prefix", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-handle-window-prefix");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    // Set a flag to indicate we're in window prefix mode
    // The next key will determine which window function to call
    setStatusMessage("Window: (+)height (-)height (>)width (<)width (w)next (q)close");
    
    return Either.right(createString("window-prefix"));
  });

  return api;
}
