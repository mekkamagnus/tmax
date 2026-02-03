/**
 * @file minibuffer-ops.ts
 * @description Minibuffer operations for T-Lisp editor API (US-1.10.1)
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList } from "../../tlisp/values.ts";
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
 * Create minibuffer operations API functions
 * @param getMode - Function to get current editor mode
 * @param setMode - Function to set current editor mode
 * @param getMxCommand - Function to get current M-x command
 * @param setMxCommand - Function to set current M-x command
 * @param getStatusMessage - Function to get current status message
 * @param setStatusMessage - Function to set current status message
 * @param getCommandHistory - Function to get command history array
 * @param setCommandHistory - Function to set command history array
 * @param getHistoryIndex - Function to get current history index
 * @param setHistoryIndex - Function to set current history index
 * @returns Map of minibuffer function names to implementations
 */
export function createMinibufferOps(
  getMode: () => "normal" | "insert" | "visual" | "command" | "mx",
  setMode: (mode: "normal" | "insert" | "visual" | "command" | "mx") => void,
  getMxCommand: () => string,
  setMxCommand: (command: string) => void,
  getStatusMessage: () => string,
  setStatusMessage: (message: string) => void,
  getCommandHistory: () => string[],
  setCommandHistory: (history: string[]) => void,
  getHistoryIndex: () => number,
  setHistoryIndex: (index: number) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * Check if minibuffer is active (in mx mode)
   */
  api.set("minibuffer-active", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "minibuffer-active");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const isActive = getMode() === "mx";
    return Either.right(createBoolean(isActive));
  });

  /**
   * Get current minibuffer input
   */
  api.set("minibuffer-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "minibuffer-get");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createString(getMxCommand()));
  });

  /**
   * Set minibuffer input
   */
  api.set("minibuffer-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "minibuffer-set");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const textArg = args[0];
    const typeValidation = validateArgType(textArg, "string", 0, "minibuffer-set");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const text = textArg.value as string;
    setMxCommand(text);

    return Either.right(createString(text));
  });

  /**
   * Clear minibuffer input
   */
  api.set("minibuffer-clear", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "minibuffer-clear");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    setMxCommand("");
    return Either.right(createNil());
  });

  /**
   * Get command history as list
   */
  api.set("minibuffer-history", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "minibuffer-history");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const history = getCommandHistory();
    const historyValues = history.map(cmd => createString(cmd));
    return Either.right(createList(historyValues));
  });

  /**
   * Add command to history
   */
  api.set("minibuffer-history-add", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "minibuffer-history-add");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const commandArg = args[0];
    const typeValidation = validateArgType(commandArg, "string", 0, "minibuffer-history-add");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const command = commandArg.value as string;
    const history = getCommandHistory();

    // Don't add duplicates of the most recent command
    if (history.length === 0 || history[history.length - 1] !== command) {
      setCommandHistory([...history, command]);
    }

    // Reset history index
    setHistoryIndex(history.length);

    return Either.right(createNil());
  });

  /**
   * Navigate to previous command in history (M-p)
   */
  api.set("minibuffer-history-previous", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "minibuffer-history-previous");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const history = getCommandHistory();
    let currentIndex = getHistoryIndex();

    if (history.length === 0) {
      setStatusMessage("No command history");
      return Either.right(createNil());
    }

    // Move to previous command in history
    if (currentIndex > 0) {
      currentIndex--;
      setHistoryIndex(currentIndex);
      setMxCommand(history[currentIndex]);
    } else {
      // Already at oldest command
      setStatusMessage("Already at oldest command");
    }

    return Either.right(createString(getMxCommand()));
  });

  /**
   * Navigate to next command in history (M-n)
   */
  api.set("minibuffer-history-next", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "minibuffer-history-next");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const history = getCommandHistory();
    let currentIndex = getHistoryIndex();

    if (history.length === 0) {
      setStatusMessage("No command history");
      return Either.right(createNil());
    }

    // Move to next command in history
    if (currentIndex < history.length - 1) {
      currentIndex++;
      setHistoryIndex(currentIndex);
      setMxCommand(history[currentIndex]);
    } else if (currentIndex === history.length - 1) {
      // At end of history, clear input
      currentIndex = history.length;
      setHistoryIndex(currentIndex);
      setMxCommand("");
    }

    return Either.right(createString(getMxCommand()));
  });

  /**
   * Reset history index to end (call when entering minibuffer)
   */
  api.set("minibuffer-history-reset-index", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "minibuffer-history-reset-index");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const history = getCommandHistory();
    setHistoryIndex(history.length);
    return Either.right(createNil());
  });

  return api;
}
