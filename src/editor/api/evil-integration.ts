/**
 * @file evil-integration.ts
 * @description Evil Integration - Vim register system with Emacs kill ring (US-1.9.3)
 *
 * CHORE-44 Change 1: register storage is per-editor session state. Each `Editor`
 * owns a `RegisterState` (via `createRegisterState` + `bindRegisters`), bound to
 * that editor's `KillRingOps` so deletes/yanks land in the right kill ring.
 * No module-global mutable state remains.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createString, createNil, createList } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import {
  createValidationError,
  AppError
} from "../../error/types.ts";
import type { KillRingOps } from "./kill-ring.ts";

export const REGISTER_UNNAMED = -1;
export const REGISTER_YANK = 0;
export const REGISTER_NUMBERED_COUNT = 9;
export const REGISTER_NUMBERED_START = 1;
export const REGISTER_NUMBERED_END = 9;
export const REGISTER_NAMED_START = 10;
export const REGISTER_NAMED_END = 35; // 10 + 26 - 1
export const REGISTER_CLIPBOARD = 36;
export const REGISTER_COUNT = 38;

/**
 * Per-editor register storage.
 */
export interface RegisterState {
  storage: string[];
  unnamed: string;
}

export function createRegisterState(): RegisterState {
  return { storage: new Array(REGISTER_COUNT).fill(""), unnamed: "" };
}

/**
 * Map register character to storage index. Returns -1 for the unnamed register.
 */
export function getRegisterIndex(register: string): number {
  if (register.length !== 1) {
    return REGISTER_UNNAMED;
  }
  const char = register[0]!;
  if (char === '"') return REGISTER_UNNAMED;
  if (char === '0') return REGISTER_YANK;
  if (char >= '1' && char <= '9') return parseInt(char, 10);
  if (char >= 'a' && char <= 'z') return REGISTER_NAMED_START + (char.charCodeAt(0) - 'a'.charCodeAt(0));
  if (char >= 'A' && char <= 'Z') return REGISTER_NAMED_START + (char.charCodeAt(0) - 'A'.charCodeAt(0));
  if (char === '+') return REGISTER_CLIPBOARD;
  return REGISTER_UNNAMED;
}

/**
 * Bound register operations over one (per-editor) state instance, wired to the
 * same editor's kill ring for yank/delete storage.
 */
export interface RegisterOps {
  get(register: string): string;
  set(register: string, content: string, append?: boolean): void;
  yank(text: string): void;
  del(text: string, isLineDelete?: boolean): void;
  paste(register: string): string;
  reset(): void;
  /** Formatted `"X: content"` entries for `(register-list)`. */
  listEntries(): string[];
}

export function bindRegisters(state: RegisterState, killRing: KillRingOps): RegisterOps {
  const get = (register: string): string => {
    const index = getRegisterIndex(register);
    if (index === REGISTER_UNNAMED) return state.unnamed;
    if (index >= 0 && index < state.storage.length) return state.storage[index]!;
    return "";
  };

  const set = (register: string, content: string, append: boolean = false): void => {
    const index = getRegisterIndex(register);
    const isUppercase = register.length === 1 && register[0]! >= 'A' && register[0]! <= 'Z';
    const shouldAppend = append || isUppercase;
    if (index === REGISTER_UNNAMED) {
      state.unnamed = content;
      return;
    }
    if (index >= 0 && index < state.storage.length) {
      state.storage[index] = shouldAppend ? state.storage[index]! + content : content;
    }
  };

  return {
    get,
    set,
    yank: (text: string): void => {
      state.unnamed = text;
      state.storage[REGISTER_YANK] = text;
      killRing.save(text);
    },
    del: (text: string, isLineDelete: boolean = false): void => {
      state.unnamed = text;
      if (isLineDelete) {
        for (let i = REGISTER_NUMBERED_END; i > REGISTER_NUMBERED_START; i--) {
          state.storage[i] = state.storage[i - 1]!;
        }
        state.storage[REGISTER_NUMBERED_START] = text;
      }
      killRing.save(text);
    },
    paste: (register: string): string => get(register),
    reset: (): void => {
      state.storage = new Array(REGISTER_COUNT).fill("");
      state.unnamed = "";
    },
    listEntries: (): string[] => {
      const entries: string[] = [];
      if (state.unnamed) entries.push(`": ${state.unnamed}`);
      if (state.storage[REGISTER_YANK]) entries.push(`0: ${state.storage[REGISTER_YANK]}`);
      for (let i = REGISTER_NUMBERED_START; i <= REGISTER_NUMBERED_END; i++) {
        if (state.storage[i]) entries.push(`${i}: ${state.storage[i]}`);
      }
      for (let i = 0; i < 26; i++) {
        const content = state.storage[REGISTER_NAMED_START + i];
        if (content) {
          const char = String.fromCharCode('a'.charCodeAt(0) + i);
          entries.push(`${char}: ${content}`);
        }
      }
      if (state.storage[REGISTER_CLIPBOARD]) entries.push(`+: ${state.storage[REGISTER_CLIPBOARD]}`);
      return entries;
    },
  };
}

/**
 * Bound register callback shape used by text-object helpers (delete/change).
 */
export type RegisterDeleteFn = (text: string, isLineDelete?: boolean) => void;

/**
 * Create Evil Integration API functions for T-Lisp, bound to one editor's registers.
 */
export function createEvilIntegrationOps(ops: RegisterOps): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  const requireStringArg = (args: TLispValue[], count: number, name: string, position: number): Either<AppError, string> => {
    const arg = args[position];
    if (!arg || arg.type !== 'string') {
      return Either.left(createValidationError('TypeError', `${name} argument must be a string`, `args[${position}]`, arg, 'string'));
    }
    return Either.right(arg.value as string);
  };

  api.set("get-register", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) return Either.left(createValidationError('ConstraintViolation', 'get-register requires 1 argument: register name', 'args', args, '1 argument'));
    const r = requireStringArg(args, 1, "get-register", 0);
    if (Either.isLeft(r)) return Either.left(r.left);
    return Either.right(createString(ops.get(r.right)));
  });

  api.set("set-register", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2) return Either.left(createValidationError('ConstraintViolation', 'set-register requires 2 arguments: register name and content', 'args', args, '2 arguments'));
    const reg = requireStringArg(args, 2, "set-register", 0);
    if (Either.isLeft(reg)) return Either.left(reg.left);
    const content = requireStringArg(args, 2, "set-register", 1);
    if (Either.isLeft(content)) return Either.left(content.left);
    const register = reg.right;
    const isAppend = register.length === 1 && register[0]! >= 'A' && register[0]! <= 'Z';
    ops.set(register, content.right, isAppend);
    return Either.right(createNil());
  });

  api.set("register-get", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) return Either.left(createValidationError('ConstraintViolation', 'register-get requires 1 argument: register name', 'args', args, '1 argument'));
    const r = requireStringArg(args, 1, "register-get", 0);
    if (Either.isLeft(r)) return Either.left(r.left);
    return Either.right(createString(ops.get(r.right)));
  });

  api.set("register-set", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2) return Either.left(createValidationError('ConstraintViolation', 'register-set requires 2 arguments: register name and content', 'args', args, '2 arguments'));
    const reg = requireStringArg(args, 2, "register-set", 0);
    if (Either.isLeft(reg)) return Either.left(reg.left);
    const content = requireStringArg(args, 2, "register-set", 1);
    if (Either.isLeft(content)) return Either.left(content.left);
    const register = reg.right;
    const isAppend = register.length === 1 && register[0]! >= 'A' && register[0]! <= 'Z';
    ops.set(register, content.right, isAppend);
    return Either.right(createNil());
  });

  api.set("yank-delete-store", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 2) return Either.left(createValidationError('ConstraintViolation', 'yank-delete-store requires 2 arguments: register name and content', 'args', args, '2 arguments'));
    const reg = requireStringArg(args, 2, "yank-delete-store", 0);
    if (Either.isLeft(reg)) return Either.left(reg.left);
    const content = requireStringArg(args, 2, "yank-delete-store", 1);
    if (Either.isLeft(content)) return Either.left(content.left);
    ops.set(reg.right, content.right);
    return Either.right(createNil());
  });

  api.set("register-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) return Either.left(createValidationError('ConstraintViolation', 'register-list requires 0 arguments', 'args', args, '0 arguments'));
    return Either.right(createList(ops.listEntries().map(entry => createString(entry))));
  });

  api.set("paste-from-register", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) return Either.left(createValidationError('ConstraintViolation', 'paste-from-register requires 1 argument: register name', 'args', args, '1 argument'));
    const r = requireStringArg(args, 1, "paste-from-register", 0);
    if (Either.isLeft(r)) return Either.left(r.left);
    return Either.right(createString(ops.paste(r.right)));
  });

  return api;
}
