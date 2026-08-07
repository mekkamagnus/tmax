/**
 * @file shell-ops.ts
 * @description T-Lisp primitives for shell-mode (interactive terminal).
 * Provides: shell, shell-send, shell-resize, shell-kill, shell-get-lines,
 * shell-alive-p, shell-list.
 * @see SPEC-097 RFC-014A
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createString, createList, createBoolean, createNumber } from "../../tlisp/values.ts";
import { TerminalManager } from "../../core/terminal-manager.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";

export function createShellOps(
  terminalManager: TerminalManager,
  getTerminalSize: () => { width: number; height: number },
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * shell — Create a new terminal (spawns $SHELL). Returns the terminal ID.
   * Usage: (shell) or (shell "cwd")
   *
   * Security: only spawns $SHELL (no arbitrary command parameter). The cwd is
   * user-controlled (terminals inherently have full filesystem access). See ADR-0195.
   */
  api.set("shell", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const cwd = args.length > 0 && args[0]?.type === "string" ? args[0]!.value as string : undefined;
    const size = getTerminalSize();

    const id = terminalManager.createTerminal({
      cols: size.width,
      rows: Math.max(1, size.height - 1),
      cwd,
    });

    return Either.right(createString(id));
  });

  /**
   * shell-send — Send data to a terminal's PTY.
   * Usage: (shell-send terminal-id "data")
   */
  api.set("shell-send", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const valCount = validateArgsCount(args, 2, "shell-send");
    if (Either.isLeft(valCount)) return Either.left(valCount.left);

    const idVal = validateArgType(args[0], "string", 0, "shell-send");
    if (Either.isLeft(idVal)) return Either.left(idVal.left);
    const dataVal = validateArgType(args[1], "string", 1, "shell-send");
    if (Either.isLeft(dataVal)) return Either.left(dataVal.left);

    const id = args[0]!.value as string;
    const data = args[1]!.value as string;

    terminalManager.write(id, data);
    return Either.right(createNil());
  });

  /**
   * shell-resize — Resize a terminal.
   * Usage: (shell-resize terminal-id cols rows)
   */
  api.set("shell-resize", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const valCount = validateArgsCount(args, 3, "shell-resize");
    if (Either.isLeft(valCount)) return Either.left(valCount.left);

    const idVal = validateArgType(args[0], "string", 0, "shell-resize");
    if (Either.isLeft(idVal)) return Either.left(idVal.left);
    const colsVal = validateArgType(args[1], "number", 1, "shell-resize");
    if (Either.isLeft(colsVal)) return Either.left(colsVal.left);
    const rowsVal = validateArgType(args[2], "number", 2, "shell-resize");
    if (Either.isLeft(rowsVal)) return Either.left(rowsVal.left);

    const id = args[0]!.value as string;
    const cols = args[1]!.value as number;
    const rows = args[2]!.value as number;

    terminalManager.resize(id, cols, rows);
    return Either.right(createNil());
  });

  /**
   * shell-kill — Kill a terminal's process.
   * Usage: (shell-kill terminal-id)
   */
  api.set("shell-kill", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const valCount = validateArgsCount(args, 1, "shell-kill");
    if (Either.isLeft(valCount)) return Either.left(valCount.left);

    const idVal = validateArgType(args[0], "string", 0, "shell-kill");
    if (Either.isLeft(idVal)) return Either.left(idVal.left);

    const id = args[0]!.value as string;
    terminalManager.kill(id);
    return Either.right(createNil());
  });

  /**
   * shell-get-lines — Get visible terminal lines (for rendering).
   * Returns a list of strings (one per row).
   * Usage: (shell-get-lines terminal-id)
   */
  api.set("shell-get-lines", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const valCount = validateArgsCount(args, 1, "shell-get-lines");
    if (Either.isLeft(valCount)) return Either.left(valCount.left);

    const idVal = validateArgType(args[0], "string", 0, "shell-get-lines");
    if (Either.isLeft(idVal)) return Either.left(idVal.left);

    const id = args[0]!.value as string;
    const lines = terminalManager.getVisibleLines(id);
    return Either.right(createList(lines.map((l) => createString(l))));
  });

  /**
   * shell-alive-p — Check if a terminal is alive.
   * Usage: (shell-alive-p terminal-id)
   */
  api.set("shell-alive-p", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const valCount = validateArgsCount(args, 1, "shell-alive-p");
    if (Either.isLeft(valCount)) return Either.left(valCount.left);

    const idVal = validateArgType(args[0], "string", 0, "shell-alive-p");
    if (Either.isLeft(idVal)) return Either.left(idVal.left);

    const id = args[0]!.value as string;
    return Either.right(createBoolean(terminalManager.isAlive(id)));
  });

  /**
   * shell-list — List all terminal IDs.
   * Usage: (shell-list)
   */
  api.set("shell-list", (_args: TLispValue[]): Either<AppError, TLispValue> => {
    const ids = terminalManager.list();
    return Either.right(createList(ids.map((id) => createString(id))));
  });

  return api;
}
