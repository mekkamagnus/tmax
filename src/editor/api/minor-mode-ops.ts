/**
 * @file minor-mode-ops.ts
 * @description Minor mode operations for T-Lisp editor API
 *
 * Minor modes are feature-specific and any number can be active per buffer.
 * Some modes can be globalized (active across all buffers).
 *
 * Available operations:
 * - minor-mode-register: Register a new minor mode
 * - minor-mode-set-keymap: Associate a keymap with a minor mode
 * - minor-mode-toggle: Toggle a minor mode for the current buffer
 * - minor-mode-set: Explicitly enable or disable a minor mode
 * - minor-mode-active-p: Check if a minor mode is active for the current buffer
 * - minor-mode-list-active: List active minor modes for the current buffer
 * - minor-mode-list-all: List all registered minor mode names
 * - minor-mode-lighter: Get a mode's status-line lighter
 * - minor-mode-list-lighters: Get lighters for currently active minor modes
 * - minor-mode-global-p: Check if a mode has globalized behavior
 * - global-minor-mode-set: Enable/disable a minor mode across all buffers
 * - global-minor-mode-active-p: Check if a globalized minor mode is active
 * - global-minor-mode-list-active: List active globalized minor modes
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createString, createList, createBoolean } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { runModel, readModelField, setModelField, type EditorModelAccess } from "./state-context.ts";
import { validateArgsCount, validateArgType } from "../../utils/validation.ts";
import { createValidationError, AppError } from "../../error/types.ts";
import type { EditorConfig } from "../../core/types.ts";
import type { MinorModeConfig, BufferModeState } from "../mode-state.ts";
import {
  getOrCreateModeState,
  activateMinorMode,
  deactivateMinorMode,
  computeLighters,
  applyGlobalMinorModes,
} from "../mode-state.ts";

export function createMinorModeOps(
  getMinorModeRegistry: () => Map<string, MinorModeConfig>,
  getBufferModeStates: () => Map<string, BufferModeState>,
  getCurrentBufferKey: () => string,
  getGlobalizedMinorModes: () => Set<string>,
  evalTlisp: (expr: string) => Either<any, any>,
  configAccess?: {
    getConfig: () => EditorConfig;
    setConfig: (config: EditorConfig) => void;
  },
  /** CHORE-39 Phase 4: when provided, config reads/writes use the State monad against EditorModel. */
  access?: EditorModelAccess,
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: prefer State-monad config access when access is supplied
  // (real editor runtime); fall back to configAccess otherwise (legacy tests).
  const hasConfigAccess = !!(access || configAccess);
  const getConfig = (): EditorConfig =>
    access ? runModel(access, readModelField("config")) : configAccess!.getConfig();
  const setConfig = (c: EditorConfig): void => {
    if (access) runModel(access, setModelField("config", c));
    else configAccess!.setConfig(c);
  };
  const api = new Map<string, TLispFunctionImpl>();

  // Helper to get current buffer's mode state
  const currentModeState = (): BufferModeState => {
    const key = getCurrentBufferKey();
    const state = getOrCreateModeState(getBufferModeStates(), key);
    const applied = applyGlobalMinorModes(state, getGlobalizedMinorModes());
    if (applied !== state) Object.assign(state, applied);
    return state;
  };

  const shouldEnable = (value: TLispValue): boolean =>
    value.type !== "nil" &&
    (value.type === "boolean" ? value.value === true : true) &&
    (value.type === "number" ? (value.value as number) > 0 : true);

  const applyBuiltinModeEffect = (
    state: BufferModeState,
    name: string,
    enable: boolean
  ): void => {
    if (!hasConfigAccess) return;
    if (name !== "line-numbers" && name !== "auto-fill") return;

    const key = name === "line-numbers" ? "showLineNumbers" : "wordWrap";
    const config = getConfig();
    const saved = state.minorModeSavedConfig[name] ?? {};

    if (enable) {
      if (!(key in saved)) {
        state.minorModeSavedConfig[name] = { ...saved, [key]: Boolean(config[key]) };
      }
      setConfig({ ...config, [key]: true });
      return;
    }

    const previous = state.minorModeSavedConfig[name]?.[key];
    if (previous !== undefined) {
      setConfig({ ...config, [key]: previous });
      const nextSaved = { ...state.minorModeSavedConfig[name] };
      delete nextSaved[key];
      if (Object.keys(nextSaved).length === 0) {
        delete state.minorModeSavedConfig[name];
      } else {
        state.minorModeSavedConfig[name] = nextSaved;
      }
    } else {
      setConfig({ ...config, [key]: false });
    }
  };

  const activate = (state: BufferModeState, name: string, source: "local" | "global"): void => {
    const config = getMinorModeRegistry().get(name)!;
    const wasActive = state.activeMinorModes.includes(name);
    const newState = activateMinorMode(state, name, source);
    Object.assign(state, newState);
    applyBuiltinModeEffect(state, name, true);
    if (!wasActive) evalTlisp(`(run-hooks "${config.activateHook}")`);
  };

  const deactivate = (state: BufferModeState, name: string): void => {
    const config = getMinorModeRegistry().get(name)!;
    const wasActive = state.activeMinorModes.includes(name);
    const newState = deactivateMinorMode(state, name);
    Object.assign(state, newState);
    applyBuiltinModeEffect(state, name, false);
    if (wasActive) evalTlisp(`(run-hooks "${config.deactivateHook}")`);
  };

  // (minor-mode-register NAME DESCRIPTION &optional LIGHTER)
  api.set("minor-mode-register", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2 || args.length > 3) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'minor-mode-register requires 2-3 arguments: name, description, [lighter]',
        'args',
        args.length,
        '2-3 arguments'
      ));
    }

    const nameArg = args[0]!
    const nameValidation = validateArgType(nameArg, "string", 0, "minor-mode-register");
    if (Either.isLeft(nameValidation)) return Either.left(nameValidation.left);

    const descArg = args[1]!
    const descValidation = validateArgType(descArg, "string", 1, "minor-mode-register");
    if (Either.isLeft(descValidation)) return Either.left(descValidation.left);

    const name = nameArg.value as string;
    const description = descArg.value as string;
    const lighter = args.length > 2 && args[2] && args[2].type === "string"
      ? args[2].value as string
      : name;

    const registry = getMinorModeRegistry();
    registry.set(name, {
      name,
      description,
      lighter,
      global: false,
      initValue: false,
      activateHook: `minor-mode-${name}-activate-hook`,
      deactivateHook: `minor-mode-${name}-deactivate-hook`,
    });

    return Either.right(createNil());
  });

  // (define-minor-mode NAME DESCRIPTION &optional LIGHTER GLOBAL)
  api.set("define-minor-mode", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length < 2 || args.length > 4) {
      return Either.left(createValidationError(
        "ConstraintViolation",
        "define-minor-mode requires 2-4 arguments: name, description, [lighter], [global]",
        "args",
        args.length,
        "2-4 arguments"
      ));
    }

    const nameValidation = validateArgType(args[0], "string", 0, "define-minor-mode");
    if (Either.isLeft(nameValidation)) return Either.left(nameValidation.left);
    const descValidation = validateArgType(args[1], "string", 1, "define-minor-mode");
    if (Either.isLeft(descValidation)) return Either.left(descValidation.left);

    const name = args[0]!.value as string;
    const description = args[1]!.value as string;
    const lighter = args[2]?.type === "string" ? args[2].value as string : name;
    const global = args[3] ? shouldEnable(args[3]!) : false;

    getMinorModeRegistry().set(name, {
      name,
      description,
      lighter,
      global,
      initValue: false,
      activateHook: `minor-mode-${name}-activate-hook`,
      deactivateHook: `minor-mode-${name}-deactivate-hook`,
    });

    return Either.right(createString(name));
  });

  // (minor-mode-set-keymap NAME KEYMAP)
  api.set("minor-mode-set-keymap", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "minor-mode-set-keymap");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const nameArg = args[0]!
    const nameValidation = validateArgType(nameArg, "string", 0, "minor-mode-set-keymap");
    if (Either.isLeft(nameValidation)) return Either.left(nameValidation.left);

    const keymapArg = args[1]!
    const keymapValidation = validateArgType(keymapArg, "string", 1, "minor-mode-set-keymap");
    if (Either.isLeft(keymapValidation)) return Either.left(keymapValidation.left);

    const name = nameArg.value as string;
    const registry = getMinorModeRegistry();
    const config = registry.get(name);

    if (!config) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        `minor-mode-set-keymap: unknown mode '${name}'`,
        'name',
        name,
        'registered mode name'
      ));
    }

    config.keymap = keymapArg.value as string;

    return Either.right(createNil());
  });

  // (minor-mode-toggle NAME)
  api.set("minor-mode-toggle", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "minor-mode-toggle");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const nameArg = args[0]!
    const nameValidation = validateArgType(nameArg, "string", 0, "minor-mode-toggle");
    if (Either.isLeft(nameValidation)) return Either.left(nameValidation.left);

    const name = nameArg.value as string;
    const registry = getMinorModeRegistry();
    if (!registry.has(name)) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        `minor-mode-toggle: unknown mode '${name}'`,
        'name',
        name,
        'registered mode name'
      ));
    }

    const state = currentModeState();
    const isActive = state.activeMinorModes.includes(name);

    if (isActive) {
      state.localMinorModeOverrides[name] = "disabled";
      deactivate(state, name);
    } else {
      state.localMinorModeOverrides[name] = "enabled";
      activate(state, name, "local");
    }

    return Either.right(createBoolean(!isActive));
  });

  // (minor-mode-set NAME STATE)
  api.set("minor-mode-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "minor-mode-set");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const nameArg = args[0]!
    const nameValidation = validateArgType(nameArg, "string", 0, "minor-mode-set");
    if (Either.isLeft(nameValidation)) return Either.left(nameValidation.left);

    const name = nameArg.value as string;
    const registry = getMinorModeRegistry();
    if (!registry.has(name)) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        `minor-mode-set: unknown mode '${name}'`,
        'name',
        name,
        'registered mode name'
      ));
    }

    const enable = shouldEnable(args[1]!);

    const state = currentModeState();
    const isActive = state.activeMinorModes.includes(name);

    if (enable && !isActive) {
      state.localMinorModeOverrides[name] = "enabled";
      activate(state, name, "local");
    } else if (!enable && isActive) {
      state.localMinorModeOverrides[name] = "disabled";
      deactivate(state, name);
    } else if (!enable) {
      state.localMinorModeOverrides[name] = "disabled";
    } else {
      state.localMinorModeOverrides[name] = "enabled";
    }

    return Either.right(createNil());
  });

  // (minor-mode-active-p NAME)
  api.set("minor-mode-active-p", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "minor-mode-active-p");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const nameArg = args[0]!
    const nameValidation = validateArgType(nameArg, "string", 0, "minor-mode-active-p");
    if (Either.isLeft(nameValidation)) return Either.left(nameValidation.left);

    const name = nameArg.value as string;
    const state = currentModeState();

    return Either.right(createBoolean(state.activeMinorModes.includes(name)));
  });

  // (minor-mode-list-active)
  api.set("minor-mode-list-active", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "minor-mode-list-active");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const state = currentModeState();
    return Either.right(createList(state.activeMinorModes.map((n) => createString(n))));
  });

  // (minor-mode-list-all)
  api.set("minor-mode-list-all", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "minor-mode-list-all");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const registry = getMinorModeRegistry();
    return Either.right(createList(Array.from(registry.keys()).map((n) => createString(n))));
  });

  // (minor-mode-lighter NAME)
  api.set("minor-mode-lighter", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "minor-mode-lighter");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const nameArg = args[0]!
    const nameValidation = validateArgType(nameArg, "string", 0, "minor-mode-lighter");
    if (Either.isLeft(nameValidation)) return Either.left(nameValidation.left);

    const name = nameArg.value as string;
    const config = getMinorModeRegistry().get(name);

    return Either.right(createString(config ? config.lighter : ""));
  });

  // (minor-mode-list-lighters)
  api.set("minor-mode-list-lighters", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "minor-mode-list-lighters");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const state = currentModeState();
    const lighters = computeLighters(state.activeMinorModes, getMinorModeRegistry());

    return Either.right(createList(lighters.map((l) => createString(l))));
  });

  // (minor-mode-global-p NAME)
  api.set("minor-mode-global-p", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "minor-mode-global-p");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const nameArg = args[0]!
    const nameValidation = validateArgType(nameArg, "string", 0, "minor-mode-global-p");
    if (Either.isLeft(nameValidation)) return Either.left(nameValidation.left);

    const name = nameArg.value as string;
    const config = getMinorModeRegistry().get(name);

    return Either.right(createBoolean(config?.global ?? false));
  });

  // (global-minor-mode-set NAME STATE)
  api.set("global-minor-mode-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "global-minor-mode-set");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const nameArg = args[0]!
    const nameValidation = validateArgType(nameArg, "string", 0, "global-minor-mode-set");
    if (Either.isLeft(nameValidation)) return Either.left(nameValidation.left);

    const name = nameArg.value as string;
    const registry = getMinorModeRegistry();
    if (!registry.has(name)) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        `global-minor-mode-set: unknown mode '${name}'`,
        'name',
        name,
        'registered mode name'
      ));
    }

    const enable = shouldEnable(args[1]!);

    const globalModes = getGlobalizedMinorModes();
    const config = registry.get(name)!;

    if (enable) {
      globalModes.add(name);
      // Activate in all existing buffers
      for (const [, state] of getBufferModeStates()) {
        if (state.localMinorModeOverrides[name] === "disabled") {
          continue;
        }
        if (!state.activeMinorModes.includes(name)) {
          activate(state, name, "global");
        }
      }
    } else {
      globalModes.delete(name);
      // Deactivate only global-sourced activations.
      for (const [, state] of getBufferModeStates()) {
        if (state.localMinorModeOverrides[name] === "enabled") {
          state.minorModeSources[name] = "local";
          continue;
        }
        if (state.minorModeSources[name] === "global") {
          deactivate(state, name);
        }
      }
    }

    return Either.right(createNil());
  });

  // (global-minor-mode-active-p NAME)
  api.set("global-minor-mode-active-p", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 1, "global-minor-mode-active-p");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const nameArg = args[0]!
    const nameValidation = validateArgType(nameArg, "string", 0, "global-minor-mode-active-p");
    if (Either.isLeft(nameValidation)) return Either.left(nameValidation.left);

    const name = nameArg.value as string;
    return Either.right(createBoolean(getGlobalizedMinorModes().has(name)));
  });

  // (global-minor-mode-list-active)
  api.set("global-minor-mode-list-active", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "global-minor-mode-list-active");
    if (Either.isLeft(argsValidation)) return Either.left(argsValidation.left);

    const modes = Array.from(getGlobalizedMinorModes());
    return Either.right(createList(modes.map((n) => createString(n))));
  });

  return api;
}
