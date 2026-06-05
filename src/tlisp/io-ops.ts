/**
 * @file io-ops.ts
 * @description Standalone T-Lisp I/O primitives.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppError } from "../error/types.ts";
import { Either } from "../utils/task-either.ts";
import type { TLispInterpreter, TLispValue } from "./types.ts";
import { createBoolean, createList, createNil, createString, valueToString } from "./values.ts";

export interface StandaloneIOOptions {
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  stdin?: NodeJS.ReadStream;
  allowFilesystem?: boolean;
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

const ensureFilesystem = (name: string, allowFilesystem: boolean): Either<AppError, null> => {
  if (!allowFilesystem) {
    return Either.left(evalError(`${name} filesystem access is disabled`));
  }
  return Either.right(null);
};

export function registerIOPrimitives(interpreter: TLispInterpreter, options: StandaloneIOOptions = {}): void {
  const stdout = options.stdout ?? process.stdout;
  const allowFilesystem = options.allowFilesystem ?? true;

  interpreter.defineBuiltin("print", (args: TLispValue[]) => {
    const text = args.map(valueToString).join(" ");
    stdout.write(`${text}\n`);
    return Either.right(createNil());
  });

  interpreter.defineBuiltin("princ", (args: TLispValue[]) => {
    const text = args.map((arg) => arg.type === "string" ? arg.value as string : valueToString(arg)).join("");
    stdout.write(text);
    return Either.right(createNil());
  });

  interpreter.defineBuiltin("read-line", () => {
    try {
      const input = readFileSync(0, "utf8");
      return Either.right(createString(input.split(/\r?\n/, 1)[0] ?? ""));
    } catch (error) {
      return Either.left(evalError("read-line failed", { error: error instanceof Error ? error.message : String(error) }));
    }
  });

  interpreter.defineBuiltin("read-file", (args: TLispValue[]) => {
    if (args.length !== 1) return Either.left(evalError("read-file requires exactly 1 argument", { actual: args.length }));
    const allowed = ensureFilesystem("read-file", allowFilesystem);
    if (Either.isLeft(allowed)) return allowed;
    const pathResult = expectString(args[0], "read-file");
    if (Either.isLeft(pathResult)) return pathResult;
    try {
      return Either.right(createString(readFileSync(pathResult.right, "utf8")));
    } catch (error) {
      return Either.left(evalError("read-file failed", { path: pathResult.right, error: error instanceof Error ? error.message : String(error) }));
    }
  });

  interpreter.defineBuiltin("write-file", (args: TLispValue[]) => {
    if (args.length !== 2) return Either.left(evalError("write-file requires exactly 2 arguments", { actual: args.length }));
    const allowed = ensureFilesystem("write-file", allowFilesystem);
    if (Either.isLeft(allowed)) return allowed;
    const pathResult = expectString(args[0], "write-file");
    if (Either.isLeft(pathResult)) return pathResult;
    const contentResult = expectString(args[1], "write-file");
    if (Either.isLeft(contentResult)) return contentResult;
    try {
      writeFileSync(pathResult.right, contentResult.right, "utf8");
      return Either.right(createNil());
    } catch (error) {
      return Either.left(evalError("write-file failed", { path: pathResult.right, error: error instanceof Error ? error.message : String(error) }));
    }
  });

  interpreter.defineBuiltin("file-exists?", (args: TLispValue[]) => {
    if (args.length !== 1) return Either.left(evalError("file-exists? requires exactly 1 argument", { actual: args.length }));
    const allowed = ensureFilesystem("file-exists?", allowFilesystem);
    if (Either.isLeft(allowed)) return allowed;
    const pathResult = expectString(args[0], "file-exists?");
    if (Either.isLeft(pathResult)) return pathResult;
    return Either.right(createBoolean(existsSync(pathResult.right)));
  });

  interpreter.defineBuiltin("directory-files", (args: TLispValue[]) => {
    if (args.length !== 1) return Either.left(evalError("directory-files requires exactly 1 argument", { actual: args.length }));
    const allowed = ensureFilesystem("directory-files", allowFilesystem);
    if (Either.isLeft(allowed)) return allowed;
    const pathResult = expectString(args[0], "directory-files");
    if (Either.isLeft(pathResult)) return pathResult;
    try {
      const entries = readdirSync(pathResult.right)
        .map((entry) => {
          const entryPath = join(pathResult.right, entry);
          const suffix = statSync(entryPath).isDirectory() ? "/" : "";
          return createString(`${entry}${suffix}`);
        });
      return Either.right(createList(entries));
    } catch (error) {
      return Either.left(evalError("directory-files failed", { path: pathResult.right, error: error instanceof Error ? error.message : String(error) }));
    }
  });
}
