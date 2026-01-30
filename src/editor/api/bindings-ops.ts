/**
 * @file bindings-ops.ts
 * @description Binding operations for T-Lisp editor API
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";

/**
 * T-Lisp function implementation that returns Either for error handling
 */
export type TLispFunctionWithEither = (args: TLispValue[]) => Either<AppError, TLispValue>;

/**
 * Create editor control API functions
 * @param getOperations - Function to get editor operations
 * @param setStatusMessage - Function to set status message
 * @param getCommandLine - Function to get current command line
 * @param setCommandLine - Function to set current command line
 * @param getMode - Function to get current editor mode
 * @param setMode - Function to set current editor mode
 * @param getMxCommand - Function to get current M-x command
 * @param setMxCommand - Function to set current M-x command
 * @returns Map of editor control function names to implementations
 */
export function createBindingsOps(
  getOperations: () => ({ saveFile?: (filename?: string) => Promise<void>; openFile?: (filename: string) => Promise<void> } | undefined),
  setStatusMessage: (message: string) => void,
  getCommandLine: () => string,
  setCommandLine: (command: string) => void,
  getMode: () => "normal" | "insert" | "visual" | "command" | "mx",
  setMode: (mode: "normal" | "insert" | "visual" | "command" | "mx") => void,
  getMxCommand: () => string,
  setMxCommand: (command: string) => void
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  // Editor control functions
  api.set("editor-quit", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-quit");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    // Signal the editor to stop
    // This will be handled by the main editor loop
    // For now, return a special quit signal value instead of throwing
    return Either.right(createString("EDITOR_QUIT_SIGNAL"));
  });

  api.set("editor-execute-command-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "editor-execute-command-line");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const command = getCommandLine().trim();

    // Handle basic commands
    if (command === "q" || command === "quit") {
      // Return quit signal instead of throwing
      return Either.right(createString("EDITOR_QUIT_SIGNAL"));
    } else if (command === "w" || command === "write" || command.startsWith("w ") || command.startsWith("write ")) {
      // Save current buffer (with optional filename argument)
      const parts = command.split(" ");
      const filename = parts.length > 1 ? parts.slice(1).join(" ") : undefined;

      const ops = getOperations();
      if (ops?.saveFile) {
        setStatusMessage(filename ? `Saving to ${filename}...` : "Saving...");
        // Fire and forget - the editor will update status after save
        ops.saveFile(filename).then(() => {
          setStatusMessage(filename ? `Saved to ${filename}` : "File saved");
        }).catch((error) => {
          setStatusMessage(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      } else {
        setStatusMessage("Save functionality not available");
      }
    } else if (command === "wq") {
      // Save and quit
      const ops = getOperations();
      if (ops?.saveFile) {
        setStatusMessage("Saving and quitting...");
        ops.saveFile().then(() => {
          // Return quit signal instead of throwing
          return Either.right(createString("EDITOR_QUIT_SIGNAL"));
        }).catch((error) => {
          setStatusMessage(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      } else {
        setStatusMessage("Save and quit functionality not available");
      }
    } else if (command.startsWith("e ") || command.startsWith("edit ")) {
      // TODO: Implement file opening
      const filename = command.split(" ")[1];
      setStatusMessage(`Edit ${filename} not implemented yet`);
    } else if (command === "") {
      // Empty command, do nothing
    } else {
      // Try to execute as T-Lisp command
      // Note: This is a simplified approach. In a full implementation,
      // you might want to have a separate command parser
      setStatusMessage(`Unknown command: ${command}`);
    }

    // Clear command line and return to normal mode
    setCommandLine("");
    setMode("normal");

    return Either.right(createString(command));
  });

  return api;
}