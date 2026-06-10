import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Either } from "../utils/task-either.ts";
import type { AppError } from "../error/types.ts";
import { createValidationError } from "../error/types.ts";
import type { TLispValue } from "../tlisp/types.ts";

export interface ModeLoadResult {
  path: string;
}

export const discoverModeFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".tlisp"))
    .sort((a, b) => {
      if (a === "fundamental.tlisp") return -1;
      if (b === "fundamental.tlisp") return 1;
      return a.localeCompare(b);
    })
    .map((name) => join(directory, name));
};

export const loadTlispFile = (
  path: string,
  evalTlisp: (source: string) => Either<AppError, TLispValue>
): Either<AppError, ModeLoadResult> => {
  if (!existsSync(path)) {
    return Either.left(createValidationError(
      "ConstraintViolation",
      `mode-loader: file not found '${path}'`,
      "path",
      path,
      "existing T-Lisp file"
    ));
  }

  const source = readFileSync(path, "utf8");
  const result = evalTlisp(source);
  if (Either.isLeft(result)) return result;

  return Either.right({ path });
};
