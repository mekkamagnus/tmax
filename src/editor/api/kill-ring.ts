/**
 * @file kill-ring.ts
 * @description Kill ring storage for Emacs-style yank/delete operations (US-1.9.1)
 *
 * Implements Emacs-style kill ring:
 * - Deleted text added to front of kill-ring
 * - New deletions push older items back
 * - Ring size limit (default 5) removes oldest when full
 * - p pastes item from front of kill-ring
 * - (kill-ring-rotate) rotates ring items
 * - (kill-ring-list) shows all items
 *
 * The kill ring is a circular buffer that stores multiple text entries
 * for convenient pasting and cycling through previous deletions/yanks.
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
 * Kill ring state
 * Implements a circular buffer with rotation support
 */
interface KillRingState {
  items: string[];      // Array of strings, newest at index 0
  maxSize: number;      // Maximum number of items to store
}

/**
 * Global kill ring state
 */
let killRingState: KillRingState = {
  items: [],
  maxSize: DEFAULT_KILL_RING_MAX
};

/**
 * Reset the kill ring to initial state
 * Useful for testing and cleanup
 */
export function resetKillRing(): void {
  killRingState = {
    items: [],
    maxSize: DEFAULT_KILL_RING_MAX
  };
}

/**
 * Add a new item to the front of the kill ring
 * If the ring is full, the oldest item is removed
 */
export function killRingSave(text: string): void {
  // Add new item to front
  killRingState.items.unshift(text);

  // Remove oldest items if we exceed max size
  while (killRingState.items.length > killRingState.maxSize) {
    killRingState.items.pop();
  }
}

/**
 * Get the most recent item from the kill ring (front of ring)
 * Returns empty string if kill ring is empty
 */
export function killRingYank(): string {
  if (killRingState.items.length === 0) {
    return "";
  }
  return killRingState.items[0]!;
}

/**
 * Rotate the kill ring: move front item to back
 * This enables cycling through kill ring history with M-y
 */
export function killRingRotate(): void {
  if (killRingState.items.length <= 1) {
    return; // Nothing to rotate
  }

  // Move first item to end
  const frontItem = killRingState.items.shift()!;
  killRingState.items.push(frontItem);
}

/**
 * Get all items in the kill ring
 * Returns a copy of the items array (newest first)
 */
export function killRingList(): string[] {
  return [...killRingState.items];
}

/**
 * Set the maximum size of the kill ring
 */
export function setKillRingMax(max: number): void {
  killRingState.maxSize = Math.max(1, max); // Ensure at least 1

  // Trim existing items if needed
  while (killRingState.items.length > killRingState.maxSize) {
    killRingState.items.pop();
  }
}

/**
 * Get the current maximum size of the kill ring
 */
export function getKillRingMax(): number {
  return killRingState.maxSize;
}

/**
 * Create kill ring API functions for T-Lisp
 * @returns Map of kill ring function names to implementations
 */
export function createKillRingOps(): Map<string, TLispFunctionImpl> {
  const api = new Map<string, TLispFunctionImpl>();

  /**
   * kill-ring-save - save text to kill ring
   * Usage: (kill-ring-save "text")
   */
  api.set("kill-ring-save", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'kill-ring-save requires 1 argument: text to save',
        'args',
        args,
        '1 argument'
      ));
    }

    const textArg = args[0];
    if (textArg.type !== 'string') {
      return Either.left(createValidationError(
        'TypeError',
        'kill-ring-save argument must be a string',
        'args[0]',
        textArg,
        'string'
      ));
    }

    killRingSave(textArg.value);
    return Either.right(createNil());
  });

  /**
   * kill-ring-yank - get most recent item from kill ring
   * Usage: (kill-ring-yank)
   */
  api.set("kill-ring-yank", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'kill-ring-yank requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    const text = killRingYank();
    return Either.right(createString(text));
  });

  /**
   * kill-ring-rotate - rotate kill ring items
   * Usage: (kill-ring-rotate)
   */
  api.set("kill-ring-rotate", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'kill-ring-rotate requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    killRingRotate();
    return Either.right(createNil());
  });

  /**
   * kill-ring-list - list all items in kill ring
   * Usage: (kill-ring-list)
   */
  api.set("kill-ring-list", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'kill-ring-list requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    const items = killRingList();
    const tlispItems = items.map(item => createString(item));
    return Either.right(createList(tlispItems));
  });

  /**
   * set-kill-ring-max - set maximum size of kill ring
   * Usage: (set-kill-ring-max 10)
   */
  api.set("set-kill-ring-max", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'set-kill-ring-max requires 1 argument: max size',
        'args',
        args,
        '1 argument'
      ));
    }

    const maxArg = args[0];
    if (maxArg.type !== 'number') {
      return Either.left(createValidationError(
        'TypeError',
        'set-kill-ring-max argument must be a number',
        'args[0]',
        maxArg,
        'number'
      ));
    }

    const max = Math.max(1, maxArg.value as number); // Ensure at least 1
    setKillRingMax(max);
    return Either.right(createNil());
  });

  /**
   * get-kill-ring-max - get current maximum size of kill ring
   * Usage: (get-kill-ring-max)
   */
  api.set("get-kill-ring-max", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      return Either.left(createValidationError(
        'ConstraintViolation',
        'get-kill-ring-max requires 0 arguments',
        'args',
        args,
        '0 arguments'
      ));
    }

    return Either.right({ type: 'number', value: getKillRingMax() });
  });

  return api;
}
