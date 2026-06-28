/**
 * @file runtime.ts
 * @description EditorRuntime — the impure capability surface the editor
 * exposes to Cmd runners. The `Editor` class is the only implementation;
 * pure functional code never depends on it directly, only on this interface.
 */

import type { AppError } from "../../error/types.ts";
import type { TLispValue } from "../../tlisp/types.ts";
import type { Either } from "../../utils/task-either.ts";

/**
 * Impure capabilities a Cmd needs to execute an effect.
 */
export interface EditorRuntime {
  /** Synchronously evaluate a T-Lisp expression string. */
  evalTlisp(expr: string): Either<AppError, TLispValue>;
  /** Asynchronously evaluate a T-Lisp expression string. */
  evalTlispAsync(expr: string): Promise<Either<AppError, TLispValue>>;
  /** Read a file's contents. */
  readFile(path: string): Promise<Either<AppError, string>>;
  /** Write contents to a file. */
  writeFile(path: string, content: string): Promise<Either<AppError, void>>;
  /** Append a structured editor event to the *Messages* log. */
  logMessage(message: string, level?: "info" | "warn" | "error"): void;
  /** Append a program-run output event under a category buffer. */
  logProgram(category: string, entry: { text: string; stream?: "stdout" | "stderr" }): void;
  /** Coerce a thrown value into a typed AppError. */
  toAppError(error: unknown): AppError;
}
