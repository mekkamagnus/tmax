/**
 * @file load-ops.ts
 * @description Minimal T-Lisp load, provide, require, featurep APIs
 *
 * Provides the groundwork for Emacs-style feature loading:
 * - (load FILE) - Load a T-Lisp file
 * - (load-path-add DIR) - Add a directory to the load path
 * - (load-path-list) - List current load paths
 * - (provide FEATURE) - Mark a feature as loaded
 * - (featurep FEATURE) - Test if a feature has been provided
 * - (require FEATURE &optional FILE) - Load a feature if not yet loaded
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createString, createList, createBoolean } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";
import { existsSync, readFileSync } from "fs";
import { isAbsolute, join } from "path";

export function createLoadOps(
  getLoadedFeatures: () => Set<string>,
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

  // (provide FEATURE)
  api.set("provide", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "provide");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const featureArg = args[0]!
    const typeValidation = validateArgType(featureArg, "string", 0, "provide");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const feature = featureArg.value as string;
    getLoadedFeatures().add(feature);

    return Either.right(createString(feature));
  });

  // (featurep FEATURE)
  api.set("featurep", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "featurep");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const featureArg = args[0]!
    const typeValidation = validateArgType(featureArg, "string", 0, "featurep");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const feature = featureArg.value as string;
    return Either.right(createBoolean(getLoadedFeatures().has(feature)));
  });

  // (require FEATURE &optional FILE)
  api.set("require", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 1 || args.length > 2) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'require requires 1-2 arguments: feature, [file]',
        'args',
        args.length,
        '1-2 arguments'
      ));
    }

    const featureArg = args[0]!
    const typeValidation = validateArgType(featureArg, "string", 0, "require");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const feature = featureArg.value as string;

    // Already loaded - return nil
    if (getLoadedFeatures().has(feature)) {
      return Either.right(createNil());
    }

    // Determine file path
    let filePath: string | undefined;
    if (args.length > 1 && args[1] && args[1].type === "string") {
      filePath = args[1].value as string;
    } else {
      filePath = feature;
    }

    const before = new Set(getLoadedFeatures());
    const loadResult = evalFile(filePath);
    if (Either.isLeft(loadResult)) {
      return loadResult;
    }

    if (!getLoadedFeatures().has(feature)) {
      const features = getLoadedFeatures();
      for (const loaded of Array.from(features)) {
        if (!before.has(loaded)) features.delete(loaded);
      }
      return Either.left(createValidationError(
        "ConstraintViolation",
        `require: feature '${feature}' was not provided by '${filePath}'`,
        "feature",
        feature,
        "file that calls provide for the requested feature"
      ));
    }

    return Either.right(createNil());
  });

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
