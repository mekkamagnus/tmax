/**
 * @file kill-ring.ts
 * @description Kill ring storage for Emacs-style yank/delete operations (US-1.9.1)
 *
 * CHORE-44 Change 1: the kill ring is per-editor session state. Each `Editor`
 * owns a `KillRingState` instance (via `createKillRingState` + `bindKillRing`);
 * the bound `KillRingOps` are shared with delete/yank/text-object/yank-pop ops
 * so two concurrent editors keep independent kill rings (AC1.2). No module-global
 * mutable state remains.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createString, createNil, createList } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import {
  createValidationError,
  AppError
} from "../../error/types.ts";

/**
 * Default maximum size of the kill ring
 */
const DEFAULT_KILL_RING_MAX = 5;

/**
 * Kill ring state — a circular buffer with rotation support.
 */
export interface KillRingState {
  items: string[];      // Array of strings, newest at index 0
  maxSize: number;      // Maximum number of items to store
}

/**
 * Construct a fresh, independent kill ring state.
 */
export function createKillRingState(maxSize: number = DEFAULT_KILL_RING_MAX): KillRingState {
  return { items: [], maxSize };
}

/**
 * Bound kill ring operations over one (per-editor) state instance.
 */
export interface KillRingOps {
  save(text: string): void;
  yank(): string;
  rotate(): void;
  list(): string[];
  setMax(max: number): void;
  getMax(): number;
  reset(): void;
}

/**
 * Bind kill ring operations to a specific (per-editor) state instance.
 */
export function bindKillRing(state: KillRingState): KillRingOps {
  return {
    save: (text: string): void => {
      state.items.unshift(text);
      while (state.items.length > state.maxSize) {
        state.items.pop();
      }
    },
    yank: (): string => {
      if (state.items.length === 0) {
        return "";
      }
      return state.items[0]!;
    },
    rotate: (): void => {
      if (state.items.length <= 1) {
        return;
      }
      const frontItem = state.items.shift()!;
      state.items.push(frontItem);
    },
    list: (): string[] => [...state.items],
    setMax: (max: number): void => {
      state.maxSize = Math.max(1, max);
      while (state.items.length > state.maxSize) {
        state.items.pop();
      }
    },
    getMax: (): number => state.maxSize,
    reset: (): void => {
      state.items = [];
      state.maxSize = DEFAULT_KILL_RING_MAX;
    },
  };
}

/**
 * Create kill ring API functions for T-Lisp, bound to one editor's kill ring.
 */
export function createKillRingOps(ops: KillRingOps): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  api.set("kill-ring-save", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError('ConstraintViolation', 'kill-ring-save requires 1 argument: text to save', 'args', args, '1 argument'));
    }
    const textArg = args[0]!
    if (textArg.type !== 'string') {
      return Either.left(createValidationError('TypeError', 'kill-ring-save argument must be a string', 'args[0]', textArg, 'string'));
    }
    ops.save(textArg.value as string);
    return Either.right(createNil());
  });

  api.set("kill-ring-yank", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError('ConstraintViolation', 'kill-ring-yank requires 0 arguments', 'args', args, '0 arguments'));
    }
    return Either.right(createString(ops.yank()));
  });

  api.set("kill-ring-rotate", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError('ConstraintViolation', 'kill-ring-rotate requires 0 arguments', 'args', args, '0 arguments'));
    }
    ops.rotate();
    return Either.right(createNil());
  });

  api.set("kill-ring-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError('ConstraintViolation', 'kill-ring-list requires 0 arguments', 'args', args, '0 arguments'));
    }
    return Either.right(createList(ops.list().map(item => createString(item))));
  });

  api.set("set-kill-ring-max", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError('ConstraintViolation', 'set-kill-ring-max requires 1 argument: max size', 'args', args, '1 argument'));
    }
    const maxArg = args[0]!
    if (maxArg.type !== 'number') {
      return Either.left(createValidationError('TypeError', 'set-kill-ring-max argument must be a number', 'args[0]', maxArg, 'number'));
    }
    ops.setMax(Math.max(1, maxArg.value as number));
    return Either.right(createNil());
  });

  api.set("get-kill-ring-max", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError('ConstraintViolation', 'get-kill-ring-max requires 0 arguments', 'args', args, '0 arguments'));
    }
    return Either.right({ type: 'number', value: ops.getMax() });
  });

  return api;
}
