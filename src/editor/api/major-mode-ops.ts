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
import { createNil, createString, createList, createBoolean } from "../../tlisp/values.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import { indentRulesByBuffer } from "./indent-ops.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
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
import { findFileLocalMode } from "../local-variables.ts";
import { detectMagicMode, detectShebang } from "../magic-mode.ts";
import { createExtensionRule, createRegexpRule, detectAutoMode } from "../auto-mode.ts";
import type { AutoModeRule } from "../mode-state.ts";

/**
 * CHORE-44 Change 1: the major-mode registry and auto-mode rules are
 * per-editor model state (lives at `model.session.majorMode`). The previous
 * module-globals meant registering a custom mode on one editor leaked into
 * every other editor — a real isolation bug fixed here. The `fundamental`
 * default is seeded by `createEditorSessionState()` in
 * `functional/domain-state.ts`.
 */

/**
 * Create major mode operations API functions
 */
export function createMajorModeOps(
  access: EditorModelAccess,
  evalTlisp: (expr: string) => Either<any, any>,
  getCurrentMajorMode?: () => string,
  setCurrentMajorMode?: (mode: string) => void,
): Map<string, TLispFunctionImpl> {
  // CHORE-44 Change 1: per-editor major-mode state (registry, auto-mode
  // rules, fallback) lives on the model-held `mm` object; mutated in place.
  const mm = access.getModel().session.majorMode;
  // CHORE-39 Phase 4: buffer/filename/modified reads flow through the State
  // monad against EditorModel; mode read/write + eval stay on callbacks.
  const getCurrentBuffer = (): TextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const getCurrentFilename = (): string | undefined => runModel(access, readModelField("currentFilename"));
  const getBufferModified = (): boolean => runModel(access, readModelField("bufferModified")) ?? false;
  const api = new Map<string, TLispFunctionImpl>();
  const readCurrentMode = (): string =>
    getCurrentMajorMode ? getCurrentMajorMode() : mm.fallback;
  const writeCurrentMode = (mode: string): void => {
    if (setCurrentMajorMode) {
      setCurrentMajorMode(mode);
    } else {
      mm.fallback = mode;
    }
  };

  // Fully activate a registered mode config: set it current, apply its syntax
  // language + indent rules, and run its activate hook. Returns the mode name.
  const activateConfig = (config: MajorModeConfig): string => {
    writeCurrentMode(config.name);
    if (config.syntaxLanguage) {
      evalTlisp(`(syntax-set-language "${config.syntaxLanguage}")`);
    }
    if (config.indentIncrease && config.indentIncrease.length > 0) {
      // #151: direct-store (see major-mode-set) — no evalTlisp re-embed.
      const buf = getCurrentBuffer();
      if (buf) {
        indentRulesByBuffer.set(buf, {
          increase: config.indentIncrease,
          decrease: config.indentDecrease ?? [],
        });
      }
    }
    evalTlisp(`(run-hooks "mode-${config.name}-activate-hook")`);
    return config.name;
  };

  // SPEC-104: resolve the no-match fallback. Uses the user-configurable
  // default-major-mode when it names a registered mode; otherwise fundamental.
  // An unregistered configured default warns (surfaces in *Messages*) and
  // falls back to fundamental rather than crashing.
  const resolveDefault = (): string => {
    const configured = mm.defaultMajorMode;
    if (configured && configured !== "fundamental" && mm.registry.has(configured)) {
      return activateConfig(mm.registry.get(configured)!);
    }
    if (configured && configured !== "fundamental" && !mm.registry.has(configured)) {
      evalTlisp(`(message "default-major-mode '${configured}' is not registered; using fundamental-mode")`);
    }
    writeCurrentMode("fundamental");
    return "fundamental";
  };

  // SPEC-102: the highest-precedence signal — the file declares its own mode via
  // a file-local `mode:` variable (`-*- mode: X; -*-` or a `Local Variables:`
  // block). Returns the activated mode name, or undefined when no (registered)
  // declaration is present (so the caller falls through to filename detection).
  // Only the `mode:` variable is honored; `eval:`-style locals are NOT.
  const resolveFileLocal = (): string | undefined => {
    if (!mm.enableLocalVariables) return undefined;
    const buf = getCurrentBuffer();
    if (!buf) return undefined;
    const contentResult = buf.getContent();
    if (!contentResult || (contentResult as any)._tag !== "Right") return undefined;
    const declared = findFileLocalMode((contentResult as any).right as string);
    if (!declared) return undefined;
    // An unregistered declared mode falls through (do not error) — filename
    // detection then has its chance.
    if (!mm.registry.has(declared)) return undefined;
    return activateConfig(mm.registry.get(declared)!);
  };

  // SPEC-103: content-based (magic) detection — used when no filename rule
  // matched. Sniffs the buffer head: a shebang (interpreter → mode) first, then
  // user magic rules, then fallback magic rules (e.g. markup signatures). User
  // rules beat fallback. An unmatched/unregistered result falls through to the
  // default. Only the buffer HEAD is scanned (bounded).
  const resolveMagic = (): string | undefined => {
    const buf = getCurrentBuffer();
    if (!buf) return undefined;
    const contentResult = buf.getContent();
    if (!contentResult || (contentResult as any)._tag !== "Right") return undefined;
    const text = (contentResult as any).right as string;
    const registered = new Set(mm.registry.keys());
    const shebang = detectShebang(text, registered);
    if (shebang) return activateConfig(mm.registry.get(shebang)!);
    const magic = detectMagicMode(text, mm.magicUserRules, mm.magicFallbackRules);
    if (magic && mm.registry.has(magic)) return activateConfig(mm.registry.get(magic)!);
    return undefined;
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

    const nameArg = args[0]!
    const nameValidation = validateArgType(nameArg, "string", 0, "major-mode-register");
    if (Either.isLeft(nameValidation)) {
      return Either.left(nameValidation.left);
    }

    const extArg = args[1]!
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

    mm.registry.set(name, config);
    for (const extension of extensions) {
      if (!mm.autoModeRules.some((rule) => !rule.isRegexp && rule.pattern === extension && rule.mode === name)) {
        mm.autoModeRules.push(createExtensionRule(extension, name));
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

    const nameArg = args[0]!
    const typeValidation = validateArgType(nameArg, "string", 0, "major-mode-set");
    if (Either.isLeft(typeValidation)) {
      return Either.left(typeValidation.left);
    }

    const modeName = nameArg.value as string;
    const config = mm.registry.get(modeName);
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

    // #151: store the mode's indent rules DIRECTLY (the as-registered config
    // values), bypassing the evalTlisp `(indent-set-rules ...)` re-embed. That
    // re-embedded the regexes into a new source string and re-parsed them,
    // corrupting backslashes a second time. Direct storage preserves them.
    if (config.indentIncrease && config.indentIncrease.length > 0) {
      const buf = getCurrentBuffer();
      if (buf) {
        
        indentRulesByBuffer.set(buf, {
          increase: config.indentIncrease,
          decrease: config.indentDecrease ?? [],
        });
      }
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

    const modeNames = Array.from(mm.registry.keys()).map((name) => createString(name));
    return Either.right(createList(modeNames));
  });

  // (major-mode-auto-detect)
  api.set("major-mode-auto-detect", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "major-mode-auto-detect");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    // SPEC-102: file-local `mode:` declaration has the highest precedence — a
    // file can override filename/content detection by declaring its own mode.
    const fileLocal = resolveFileLocal();
    if (fileLocal) {
      return Either.right(createString(fileLocal));
    }

    const filename = getCurrentFilename();
    if (filename) {
      const detected = detectAutoMode(filename, mm.autoModeRules);
      if (detected) {
        const config = mm.registry.get(detected);
        if (config) {
          return Either.right(createString(activateConfig(config)));
        }
      }
    }
    // Filename matched nothing → try content-based (magic) detection (SPEC-103).
    const magic = resolveMagic();
    if (magic) {
      return Either.right(createString(magic));
    }
    // No file-local declaration, no filename, no magic → fall back to the
    // configurable default-major-mode (SPEC-104), then fundamental.
    return Either.right(createString(resolveDefault()));
  });

  // SPEC-104: getter for the configurable no-match fallback. Deliberately NOT
  // named `default-major-mode`: T-Lisp is Lisp-1 (one namespace for variables
  // and functions), so a user `(setq default-major-mode "text")` would shadow a
  // same-named function and corrupt the session. tmax therefore exposes the
  // Emacs-`default-major-mode` equivalent via setter/getter primitives (the same
  // idiom as `set-expand-tabs` / `set-tab-width`, #144), not a setq-able var.
  api.set("default-major-mode-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "default-major-mode-get");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    return Either.right(createString(mm.defaultMajorMode));
  });

  // SPEC-104: setter. Does not validate registration here — the check runs at
  // use time (resolveDefault) so a mode can be set before it is registered.
  api.set("set-default-major-mode", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "set-default-major-mode");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    const nameArg = args[0]!;
    const nameValidation = validateArgType(nameArg, "string", 0, "set-default-major-mode");
    if (Either.isLeft(nameValidation)) {
      return Either.left(nameValidation.left);
    }
    mm.defaultMajorMode = nameArg.value as string;
    return Either.right(createString(mm.defaultMajorMode));
  });

  // SPEC-102: gate for file-local variable detection. Default true. When false,
  // `-*- mode: X; -*-` / `Local Variables:` blocks are ignored (filename
  // detection only). Like default-major-mode, exposed via primitives, not a
  // setq-able variable (T-Lisp is Lisp-1).
  api.set("enable-local-variables-p", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "enable-local-variables-p");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    return Either.right(createBoolean(mm.enableLocalVariables));
  });

  api.set("set-enable-local-variables", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "set-enable-local-variables");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    const flagArg = args[0]!;
    let flag: boolean;
    if (flagArg.type === "boolean") {
      flag = flagArg.value as boolean;
    } else if (flagArg.type === "nil") {
      flag = false;
    } else if (flagArg.type === "symbol" && flagArg.value === "t") {
      flag = true;
    } else {
      return Either.left(createValidationError(
        'TypeError',
        'set-enable-local-variables requires a boolean argument',
        'flag',
        String(flagArg.value),
        't or nil',
      ));
    }
    mm.enableLocalVariables = flag;
    return Either.right(createBoolean(mm.enableLocalVariables));
  });

  // SPEC-103: a mode registers a fallback magic signature (regexp matched
  // against the buffer head). Used by modes like html (`<!DOCTYPE html`).
  api.set("major-mode-magic", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "major-mode-magic");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    const modeArg = args[0]!;
    const reArg = args[1]!;
    const modeV = validateArgType(modeArg, "string", 0, "major-mode-magic");
    if (Either.isLeft(modeV)) return Either.left(modeV.left);
    const reV = validateArgType(reArg, "string", 1, "major-mode-magic");
    if (Either.isLeft(reV)) return Either.left(reV.left);
    const regexp = reArg.value as string;
    const mode = modeArg.value as string;
    if (!mm.magicFallbackRules.some((r) => r.regexp === regexp && r.mode === mode)) {
      mm.magicFallbackRules.push({ regexp, mode });
    }
    return Either.right(createString(mode));
  });

  // SPEC-103: user magic rule. User rules take precedence over fallback rules.
  api.set("magic-mode-add", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "magic-mode-add");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    const reArg = args[0]!;
    const modeArg = args[1]!;
    const reV = validateArgType(reArg, "string", 0, "magic-mode-add");
    if (Either.isLeft(reV)) return Either.left(reV.left);
    const modeV = validateArgType(modeArg, "string", 1, "magic-mode-add");
    if (Either.isLeft(modeV)) return Either.left(modeV.left);
    const regexp = reArg.value as string;
    const mode = modeArg.value as string;
    if (!mm.magicUserRules.some((r) => r.regexp === regexp && r.mode === mode)) {
      mm.magicUserRules.push({ regexp, mode });
    }
    return Either.right(createString(mode));
  });

  // SPEC-103: list all magic rules (user then fallback), for introspection.
  api.set("magic-mode-rules", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "magic-mode-rules");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    const toList = (rules: readonly { regexp: string; mode: string }[]) =>
      rules.map((r) => createList([createString(r.regexp), createString(r.mode)]));
    return Either.right(createList([...toList(mm.magicUserRules), ...toList(mm.magicFallbackRules)]));
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

    const pattern = args[0]!.value as string;
    const mode = args[1]!.value as string;
    const kind = args[2]?.type === "string" ? args[2].value as string : "extension";
    const rule = kind === "regexp"
      ? createRegexpRule(pattern, mode)
      : createExtensionRule(pattern, mode);

    mm.autoModeRules.push(rule);
    return Either.right(createNil());
  });

  // (auto-mode-list)
  api.set("auto-mode-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "auto-mode-list");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    return Either.right(createList(mm.autoModeRules.map((rule) =>
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

    return Either.right(createString(detectAutoMode(args[0]!.value as string, mm.autoModeRules) ?? "fundamental"));
  });

  // (major-mode-hook-add MODE HOOK-FN)
  api.set("major-mode-hook-add", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "major-mode-hook-add");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const modeArg = args[0]!
    const modeValidation = validateArgType(modeArg, "string", 0, "major-mode-hook-add");
    if (Either.isLeft(modeValidation)) {
      return Either.left(modeValidation.left);
    }

    const hookFnArg = args[1]!
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

    const modeArg = args[0]!
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
