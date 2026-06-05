/**
 * @file load-ops.ts
 * @description Minimal raw T-Lisp file loading APIs
 *
 * - (load FILE) - Load a T-Lisp file
 * - (load-path-add DIR) - Add a directory to the load path
 * - (load-path-list) - List current load paths
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createString, createList } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";
import { existsSync, readFileSync } from "fs";
import { isAbsolute, join } from "path";

export function createRawLoadOps(
  getLoadPaths: () => string[],
  evalTlisp: (expr: string) => Either<any, any>,
  _loadFile: (path: string) => Promise<boolean>,
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  const resolveCandidate = (file: string): string | undefined => {
    const names = file.endsWith(".tlisp") ? [file] : [file, `${file}.tlisp`];
    for (const name of names) {
      if (isAbsolute(name) && existsSync(name)) return name;
      if (existsSync(name)) return name;
      for (const dir of getLoadPaths()) {
        const direct = join(dir, name);
        if (existsSync(direct)) return direct;
        const mode = join(dir, "modes", name);
        if (existsSync(mode)) return mode;
        const command = join(dir, "commands", name);
        if (existsSync(command)) return command;
      }
    }
    return undefined;
  };

  const evalFile = (file: string): Either<AppError, TLispValue> => {
    const resolved = resolveCandidate(file);
    if (!resolved) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        `load: file not found '${file}'`,
        "file",
        file,
        "existing T-Lisp file on load path"
      ));
    }

    try {
      const content = readFileSync(resolved, "utf8");
      const result = evalTlisp(content);
      if (Either.isLeft(result)) {
        return Either.left(result.left);
      }
      return Either.right(createString(resolved));
    } catch (error) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        `load: failed to read '${resolved}': ${error instanceof Error ? error.message : String(error)}`,
        "file",
        resolved,
        "readable T-Lisp file"
      ));
    }
  };

  // (load FILE)
  api.set("load", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "load");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const fileArg = args[0]!
    const typeValidation = validateArgType(fileArg, "string", 0, "load");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const file = fileArg.value as string;
    const result = evalFile(file);

    return Either.isLeft(result) ? result : Either.right(createNil());
  });

  // (load-path-add DIR)
  api.set("load-path-add", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "load-path-add");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const dirArg = args[0]!
    const typeValidation = validateArgType(dirArg, "string", 0, "load-path-add");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const dir = dirArg.value as string;
    const paths = getLoadPaths();
    if (!paths.includes(dir)) {
      paths.push(dir);
    }

    return Either.right(createNil());
  });

  // (load-path-list)
  api.set("load-path-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "load-path-list");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createList(getLoadPaths().map((p) => createString(p))));
  });

  return api;
}
