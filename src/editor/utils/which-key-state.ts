/**
 * @file which-key-state.ts
 * @description Per-editor which-key state factory
 *
 * Creates isolated which-key state for each editor instance, eliminating the
 * module-level singleton that caused cross-frame contamination.
 */

import type { WhichKeyBinding } from "../../core/types.ts";

export const DEFAULT_WHICH_KEY_TIMEOUT = 1000;

interface WhichKeyState {
  active: boolean;
  prefix: string;
  bindings: WhichKeyBinding[];
  timeout: number;
  timerId: ReturnType<typeof setTimeout> | null;
}

export interface WhichKeyHandle {
  isActive(): boolean;
  schedule(prefix: string, bindings: WhichKeyBinding[], callback: () => void): void;
  deactivate(): void;
  reset(timeout?: number): void;
  getState(): Readonly<WhichKeyState>;
}

export function createWhichKeyState(timeout: number = DEFAULT_WHICH_KEY_TIMEOUT): WhichKeyHandle {
  let state: WhichKeyState = {
    active: false,
    prefix: "",
    bindings: [],
    timeout,
    timerId: null,
  };

  return {
    isActive() {
      return state.active;
    },

    schedule(prefix: string, bindings: WhichKeyBinding[], callback: () => void) {
      if (state.timerId) {
        clearTimeout(state.timerId);
      }
      state.timerId = setTimeout(() => {
        state.active = true;
        state.prefix = prefix;
        state.bindings = bindings;
        state.timerId = null;
        callback();
      }, state.timeout);
    },

    deactivate() {
      if (state.timerId) {
        clearTimeout(state.timerId);
        state.timerId = null;
      }
      state.active = false;
      state.prefix = "";
      state.bindings = [];
    },

    reset(newTimeout?: number) {
      if (state.timerId) {
        clearTimeout(state.timerId);
      }
      state = {
        active: false,
        prefix: "",
        bindings: [],
        timeout: newTimeout ?? state.timeout,
        timerId: null,
      };
    },

    getState() {
      return state;
    },
  };
}
