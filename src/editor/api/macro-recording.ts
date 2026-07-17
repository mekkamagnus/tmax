/**
 * @file macro-recording.ts
 * @description Vim-style keyboard macro recording functionality (US-2.4.1)
 *
 * CHORE-44 Change 1: macro recording state is per-editor. Each `Editor` owns a
 * `MacroState` (via `createMacroState` + `bindMacros`); the bound `MacroOps` are
 * used by the editor.ts macro T-Lisp primitives and macro-persistence. No
 * module-global mutable state remains.
 */

import { Either } from "../../utils/task-either.ts";

/**
 * Macro recording state
 */
export interface MacroState {
  isRecording: boolean;
  currentRegister: string | null;
  recordedKeys: string[];
  macros: Map<string, string[]>;  // Register -> list of keys
  lastExecutedMacro: string | null;
}

/**
 * Construct a fresh, independent macro recording state.
 */
export function createMacroState(): MacroState {
  return {
    isRecording: false,
    currentRegister: null,
    recordedKeys: [],
    macros: new Map(),
    lastExecutedMacro: null,
  };
}

/**
 * Bound macro operations over one (per-editor) state instance.
 */
export interface MacroOps {
  start(register: string): Either<string, string>;
  stop(): Either<string, string>;
  record(key: string): Either<string, string>;
  isActive(): boolean;
  currentRegister(): string | null;
  all(): Map<string, string[]>;
  get(register: string): Either<string, string[]>;
  execute(register: string): Either<string, string>;
  executeLast(): Either<string, string>;
  lastExecuted(): string | null;
  clearAll(): void;
  clear(register: string): Either<string, string>;
  set(register: string, keys: string[]): Either<string, string>;
  recordedKeys(): string[];
  setLastExecuted(register: string): void;
  reset(): void;
}

function isValidRegister(register: string): boolean {
  return /^[a-z0-9]$/.test(register);
}

export function bindMacros(state: MacroState): MacroOps {
  return {
    start: (register: string): Either<string, string> => {
      if (!isValidRegister(register)) return Either.left(`Invalid register: ${register}`);
      if (state.isRecording) return Either.left(`Already recording to register ${state.currentRegister}`);
      state.isRecording = true;
      state.currentRegister = register;
      state.recordedKeys = [];
      return Either.right(register);
    },
    stop: (): Either<string, string> => {
      if (!state.isRecording) return Either.left("Not recording");
      const register = state.currentRegister!;
      state.macros.set(register, [...state.recordedKeys]);
      state.isRecording = false;
      state.currentRegister = null;
      state.recordedKeys = [];
      return Either.right(register);
    },
    record: (key: string): Either<string, string> => {
      if (!state.isRecording) return Either.left("Not recording");
      state.recordedKeys.push(key);
      return Either.right(key);
    },
    isActive: (): boolean => state.isRecording,
    currentRegister: (): string | null => state.currentRegister,
    all: (): Map<string, string[]> => new Map(state.macros),
    get: (register: string): Either<string, string[]> => {
      if (!state.macros.has(register)) return Either.left(`No macro in register ${register}`);
      return Either.right(state.macros.get(register)!);
    },
    execute: (register: string): Either<string, string> => {
      if (!isValidRegister(register)) return Either.left(`Invalid register: ${register}`);
      if (!state.macros.has(register)) return Either.left(`No macro in register ${register}`);
      state.lastExecutedMacro = register;
      return Either.right(register);
    },
    executeLast: (): Either<string, string> => {
      if (!state.lastExecutedMacro) return Either.left("No last macro to execute");
      // Reuse execute() but it reads lastExecutedMacro after we capture it.
      const reg = state.lastExecutedMacro;
      if (!state.macros.has(reg)) return Either.left(`No macro in register ${reg}`);
      return Either.right(reg);
    },
    lastExecuted: (): string | null => state.lastExecutedMacro,
    clearAll: (): void => {
      state.macros.clear();
      state.lastExecutedMacro = null;
    },
    clear: (register: string): Either<string, string> => {
      if (!state.macros.has(register)) return Either.left(`No macro in register ${register}`);
      state.macros.delete(register);
      if (state.lastExecutedMacro === register) state.lastExecutedMacro = null;
      return Either.right(register);
    },
    set: (register: string, keys: string[]): Either<string, string> => {
      if (!isValidRegister(register)) return Either.left(`Invalid register: ${register}`);
      state.macros.set(register, keys);
      return Either.right(register);
    },
    recordedKeys: (): string[] => [...state.recordedKeys],
    setLastExecuted: (register: string): void => {
      state.lastExecutedMacro = register;
    },
    reset: (): void => {
      state.isRecording = false;
      state.currentRegister = null;
      state.recordedKeys = [];
      state.macros = new Map();
      state.lastExecutedMacro = null;
    },
  };
}
