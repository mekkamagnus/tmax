/**
 * @file which-key.ts
 * @description Which-key utility — thin wrapper for import compatibility
 *
 * State management moved to per-instance which-key-state.ts.
 * This file re-exports for backward compat during transition.
 */

export { DEFAULT_WHICH_KEY_TIMEOUT, createWhichKeyState } from "./which-key-state.ts";
export type { WhichKeyHandle } from "./which-key-state.ts";

import type { WhichKeyBinding } from "../../core/types.ts";

/**
 * Format which-key bindings for display
 */
export function formatWhichKeyBindings(bindings: WhichKeyBinding[], prefix: string): string[] {
  return bindings.map(binding => {
    const displayKey = binding.key === prefix ? binding.key : binding.key.substring(prefix.length + 1);
    return `${displayKey} : ${binding.command}`;
  });
}

// Module-level state for test compatibility only.
// Real per-instance state lives in the Editor's whichKeyHandle.

import { createWhichKeyState, type WhichKeyHandle } from "./which-key-state.ts";

let _globalHandle: WhichKeyHandle = createWhichKeyState();

export function resetWhichKeyState(timeout?: number): void {
  _globalHandle = createWhichKeyState(timeout);
}

export function getGlobalWhichKeyHandle(): WhichKeyHandle {
  return _globalHandle;
}

export function isWhichKeyActive(): boolean {
  return _globalHandle.isActive();
}

export function deactivateWhichKey(): void {
  _globalHandle.deactivate();
}

export function scheduleWhichKey(
  prefix: string,
  bindings: WhichKeyBinding[],
  callback: () => void
): void {
  _globalHandle.schedule(prefix, bindings, callback);
}
