/**
 * @file sys-ops.ts
 * @description Standalone T-Lisp system primitives.
 */

import { execSync } from "node:child_process";
import type { AppError } from "../error/types.ts";
import { Either } from "../utils/task-either.ts";
import type { TLispInterpreter, TLispValue } from "./types.ts";
import { createNil, createNumber, createString } from "./values.ts";

export interface StandaloneSysOptions {
  allowProcess?: boolean;
  allowShell?: boolean;
  exit?: (code: number) => never | void;
  env?: NodeJS.ProcessEnv;
}

const evalError = (message: string, details?: Record<string, unknown>): AppError => ({
  type: "EvalError",
  variant: "RuntimeError",
  message,
  details,
});

const typeError = (message: string, details?: Record<string, unknown>): AppError => ({
  type: "EvalError",
  variant: "TypeError",
  message,
  details,
});

const expectString = (value: TLispValue | undefined, name: string): Either<AppError, string> => {
  if (!value) return Either.left(evalError(`${name} missing argument`));
  if (value.type !== "string") {
    return Either.left(typeError(`${name} requires a string argument`, { actual: value.type }));
  }
  return Either.right(value.value as string);
};

export function registerSysPrimitives(interpreter: TLispInterpreter, options: StandaloneSysOptions = {}): void {
  const allowProcess = options.allowProcess ?? true;
  const allowShell = options.allowShell ?? false;
  const env = options.env ?? process.env;
  const exitFn = options.exit ?? ((code: number) => process.exit(code));

  interpreter.defineBuiltin("getenv", (args: TLispValue[]) => {
    if (args.length !== 1) return Either.left(evalError("getenv requires exactly 1 argument", { actual: args.length }));
    const nameResult = expectString(args[0], "getenv");
    if (Either.isLeft(nameResult)) return nameResult;
    const value = env[nameResult.right];
    return Either.right(value === undefined ? createNil() : createString(value));
  });

  interpreter.defineBuiltin("current-time", (args: TLispValue[]) => {
    if (args.length !== 0) return Either.left(evalError("current-time requires 0 arguments", { actual: args.length }));
    return Either.right(createNumber(Date.now()));
  });

  interpreter.defineBuiltin("exit", (args: TLispValue[]) => {
    if (!allowProcess) return Either.left(evalError("exit process access is disabled"));
    if (args.length > 1) return Either.left(evalError("exit requires 0 or 1 arguments", { actual: args.length }));
    const codeArg = args[0];
    const code = codeArg === undefined
      ? 0
      : codeArg.type === "number"
        ? codeArg.value as number
        : null;
    if (code === null || !Number.isInteger(code)) {
      return Either.left(typeError("exit requires an integer status code", { actual: codeArg?.type }));
    }
    exitFn(code);
    return Either.right(createNil());
  });

  interpreter.defineBuiltin("shell-command", (args: TLispValue[]) => {
    if (!allowShell) return Either.left(evalError("shell-command is disabled"));
    if (args.length !== 1) return Either.left(evalError("shell-command requires exactly 1 argument", { actual: args.length }));
    const commandResult = expectString(args[0], "shell-command");
    if (Either.isLeft(commandResult)) return commandResult;
    try {
      const output = execSync(commandResult.right, { encoding: "utf8" });
      return Either.right(createString(output));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Either.left(evalError("shell-command failed", { command: commandResult.right, error: message }));
    }
  });
}
