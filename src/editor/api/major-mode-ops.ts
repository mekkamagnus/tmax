/**
 * @file major-mode-ops.ts
 * @description Major mode operations for T-Lisp editor API
 *
 * Major modes provide file-type-specific behavior. Exactly one is active
 * per buffer. State is injected (buffer-local) rather than module-level global.
 *
 * Available operations:
 * - major-mode-register: Register a new major mode
 * - major-mode-set: Activate a major mode for the current buffer
 * - major-mode-get: Get the current buffer's major mode name
 * - major-mode-list: List all registered mode names
 * - major-mode-auto-detect: Auto-detect mode from filename extension
 * - major-mode-hook-add: Add a function to a mode's activate hook
 * - major-mode-hook-run: Run a mode's activate hook
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createString, createList } from "../../tlisp/values.ts";
import type { FunctionalTextBuffer } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType,
} from "../../utils/validation.ts";
import {
  createValidationError,
  AppError,
} from "../../error/types.ts";
import type { MajorModeConfig } from "../mode-state.ts";
import { normalizeExtension } from "../mode-state.ts";
import { createExtensionRule, createRegexpRule, detectAutoMode } from "../auto-mode.ts";
import type { AutoModeRule } from "../mode-state.ts";

/**
 * Registry of all known major modes (shared across all buffers)
 */
const modeRegistry: Map<string, MajorModeConfig> = new Map();
let fallbackCurrentMode = "fundamental";
const autoModeRules: AutoModeRule[] = [];

// Register the default fundamental mode
modeRegistry.set("fundamental", { name: "fundamental", extensions: [] });

/**
 * Export the registry for mode-loader access
 */
export function getMajorModeRegistry(): Map<string, MajorModeConfig> {
  return modeRegistry;
}

export function getAutoModeRules(): AutoModeRule[] {
  return autoModeRules;
}

/**
 * Create major mode operations API functions
 */
export function createMajorModeOps(
  getCurrentBuffer: () => FunctionalTextBuffer | null,
  getCurrentFilename: () => string | undefined,
  getBufferModified: () => boolean,
  evalTlisp: (expr: string) => Either<any, any>,
  getCurrentMajorMode?: () => string,
  setCurrentMajorMode?: (mode: string) => void,
): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();
  const readCurrentMode = (): string =>
    getCurrentMajorMode ? getCurrentMajorMode() : fallbackCurrentMode;
  const writeCurrentMode = (mode: string): void => {
    if (setCurrentMajorMode) {
      setCurrentMajorMode(mode);
    } else {
      fallbackCurrentMode = mode;
    }
  };

  // (major-mode-register NAME EXTENSIONS &optional SYNTAX-LANGUAGE INDENT-INCREASE INDENT-DECREASE)
  api.set("major-mode-register", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2 || args.length > 5) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'major-mode-register requires 2-5 arguments: name, extensions, [syntax-language, indent-increase, indent-decrease]',
        'args',
        args.length,
        '2-5 arguments'
      ));
    }

    const nameArg = args[0];
    const nameValidation = validateArgType(nameArg, "string", 0, "major-mode-register");
    if (Either.isLeft(nameValidation)) {
      return Either.left(nameValidation.left);
    }

    const extArg = args[1];
    const extValidation = validateArgType(extArg, "list", 1, "major-mode-register");
    if (Either.isLeft(extValidation)) {
      return Either.left(extValidation.left);
    }

    const name = nameArg.value as string;
    const extensions = (extArg.value as TLispValue[])
      .map((v) => {
        if (v.type === "string") return normalizeExtension(v.value as string);
        return "";
      })
      .filter((s) => s !== "");

    const config: MajorModeConfig = { name, extensions };

    // Optional: syntax language (arg 2)
    if (args.length > 2 && args[2] && args[2].type !== "nil") {
      const syntaxValidation = validateArgType(args[2], "string", 2, "major-mode-register");
      if (Either.isLeft(syntaxValidation)) {
        return Either.left(syntaxValidation.left);
      }
      config.syntaxLanguage = args[2].value as string;
    }

    // Optional: indent increase rules (arg 3)
    if (args.length > 3 && args[3] && args[3].type !== "nil") {
      const indentIncValidation = validateArgType(args[3], "list", 3, "major-mode-register");
      if (Either.isLeft(indentIncValidation)) {
        return Either.left(indentIncValidation.left);
      }
      config.indentIncrease = (args[3].value as TLispValue[])
        .map((v) => v.type === "string" ? v.value as string : "")
        .filter((s) => s !== "");
    }

    // Optional: indent decrease rules (arg 4)
    if (args.length > 4 && args[4] && args[4].type !== "nil") {
      const indentDecValidation = validateArgType(args[4], "list", 4, "major-mode-register");
      if (Either.isLeft(indentDecValidation)) {
        return Either.left(indentDecValidation.left);
      }
      config.indentDecrease = (args[4].value as TLispValue[])
        .map((v) => v.type === "string" ? v.value as string : "")
        .filter((s) => s !== "");
    }

    modeRegistry.set(name, config);
    for (const extension of extensions) {
      if (!autoModeRules.some((rule) => !rule.isRegexp && rule.pattern === extension && rule.mode === name)) {
        autoModeRules.push(createExtensionRule(extension, name));
      }
    }

    return Either.right(createNil());
  });

  // (major-mode-set MODE-NAME)
  api.set("major-mode-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "major-mode-set");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const nameArg = args[0];
    const typeValidation = validateArgType(nameArg, "string", 0, "major-mode-set");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const modeName = nameArg.value as string;
    const config = modeRegistry.get(modeName);
    if (!config) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        `major-mode-set: unknown mode '${modeName}'`,
        'mode-name',
        modeName,
        'registered mode name'
      ));
    }

    writeCurrentMode(modeName);

    // If the mode has a syntax language, activate it
    if (config.syntaxLanguage) {
      evalTlisp(`(syntax-set-language "${config.syntaxLanguage}")`);
    }

    // If the mode has indent rules, set them
    if (config.indentIncrease && config.indentIncrease.length > 0) {
      const incStr = config.indentIncrease.map((s) => `"${s}"`).join(" ");
      const decStr = config.indentDecrease && config.indentDecrease.length > 0
        ? config.indentDecrease.map((s) => `"${s}"`).join(" ")
        : "";
      evalTlisp(`(indent-set-rules '(${incStr}) '(${decStr}))`);
    }

    // Run the mode's activate hook
    evalTlisp(`(run-hooks "mode-${modeName}-activate-hook")`);

    return Either.right(createString(modeName));
  });

  // (major-mode-get)
  api.set("major-mode-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "major-mode-get");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    return Either.right(createString(readCurrentMode()));
  });

  // (major-mode-list)
  api.set("major-mode-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "major-mode-list");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const modeNames = Array.from(modeRegistry.keys()).map((name) => createString(name));
    return Either.right(createList(modeNames));
  });

  // (major-mode-auto-detect)
  api.set("major-mode-auto-detect", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "major-mode-auto-detect");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const filename = getCurrentFilename();
    if (!filename) {
      return Either.right(createString("fundamental"));
    }

    const detected = detectAutoMode(filename, autoModeRules);
    if (detected) {
      const config = modeRegistry.get(detected);
      if (config) {
        writeCurrentMode(config.name);

        if (config.syntaxLanguage) {
          evalTlisp(`(syntax-set-language "${config.syntaxLanguage}")`);
        }

        if (config.indentIncrease && config.indentIncrease.length > 0) {
          const incStr = config.indentIncrease.map((s) => `"${s}"`).join(" ");
          const decStr = config.indentDecrease && config.indentDecrease.length > 0
            ? config.indentDecrease.map((s) => `"${s}"`).join(" ")
            : "";
          evalTlisp(`(indent-set-rules '(${incStr}) '(${decStr}))`);
        }

        // Run the mode's activate hook
        evalTlisp(`(run-hooks "mode-${config.name}-activate-hook")`);

        return Either.right(createString(config.name));
      }
    }

    return Either.right(createString("fundamental"));
  });

  // (auto-mode-add PATTERN MODE &optional KIND)
  api.set("auto-mode-add", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2 || args.length > 3) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "auto-mode-add requires 2-3 arguments: pattern, mode, [kind]",
        "args",
        args.length,
        "2-3 arguments"
      ));
    }

    const patternValidation = validateArgType(args[0], "string", 0, "auto-mode-add");
    if (Either.isLeft(patternValidation)) return Either.left(patternValidation.left);
    const modeValidation = validateArgType(args[1], "string", 1, "auto-mode-add");
    if (Either.isLeft(modeValidation)) return Either.left(modeValidation.left);

    const pattern = args[0].value as string;
    const mode = args[1].value as string;
    const kind = args[2]?.type === "string" ? args[2].value as string : "extension";
    const rule = kind === "regexp"
      ? createRegexpRule(pattern, mode)
      : createExtensionRule(pattern, mode);

    autoModeRules.push(rule);
    return Either.right(createNil());
  });

  // (auto-mode-list)
  api.set("auto-mode-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "auto-mode-list");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    return Either.right(createList(autoModeRules.map((rule) =>
      createList([
        createString(rule.pattern),
        createString(rule.mode),
        createString(rule.isRegexp ? "regexp" : "extension"),
      ])
    )));
  });

  // (auto-mode-detect FILENAME)
  api.set("auto-mode-detect", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "auto-mode-detect");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);
    const filenameValidation = validateArgType(args[0], "string", 0, "auto-mode-detect");
    if (Either.isLeft(filenameValidation)) return Either.left(filenameValidation.left);

    return Either.right(createString(detectAutoMode(args[0].value as string, autoModeRules) ?? "fundamental"));
  });

  // (major-mode-hook-add MODE HOOK-FN)
  api.set("major-mode-hook-add", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "major-mode-hook-add");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const modeArg = args[0];
    const modeValidation = validateArgType(modeArg, "string", 0, "major-mode-hook-add");
    if (Either.isLeft(modeValidation)) {
      return Either.left(modeValidation.left);
    }

    const hookFnArg = args[1];
    const hookFnValidation = validateArgType(hookFnArg, "string", 1, "major-mode-hook-add");
    if (Either.isLeft(hookFnValidation)) {
      return Either.left(hookFnValidation.left);
    }

    const mode = modeArg.value as string;
    const hookFn = hookFnArg.value as string;

    evalTlisp(`(add-hook "mode-${mode}-activate-hook" "${hookFn}")`);

    return Either.right(createNil());
  });

  // (major-mode-hook-run MODE)
  api.set("major-mode-hook-run", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "major-mode-hook-run");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const modeArg = args[0];
    const typeValidation = validateArgType(modeArg, "string", 0, "major-mode-hook-run");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const mode = modeArg.value as string;

    evalTlisp(`(run-hooks "mode-${mode}-activate-hook")`);

    return Either.right(createNil());
  });

  return api;
}
