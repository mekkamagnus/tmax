/**
 * @file which-key.ts
 * @description Which-key popup utility for discovering key bindings (US-1.10.3)
 *
 * Implements Emacs-style which-key functionality that shows available key bindings
 * after pausing on a key prefix.
 */

import type { KeyMapping, WhichKeyBinding } from "../../core/types.ts";

/**
 * Default which-key timeout in milliseconds
 */
export const DEFAULT_WHICH_KEY_TIMEOUT = 1000;

/**
 * Which-key state tracker
 */
interface WhichKeyState {
  active: boolean;
  prefix: string;
  bindings: WhichKeyBinding[];
  timeout: number;
  timerId: ReturnType<typeof setTimeout> | null;
}

/**
 * Global which-key state
 */
let whichKeyState: WhichKeyState = {
  active: false,
  prefix: "",
  bindings: [],
  timeout: DEFAULT_WHICH_KEY_TIMEOUT,
  timerId: null,
};

/**
 * Get current which-key state
 */
export function getWhichKeyState(): WhichKeyState {
  return whichKeyState;
}

/**
 * Set which-key timeout
 */
export function setWhichKeyTimeout(timeout: number): void {
  whichKeyState.timeout = timeout;
}

/**
 * Check if which-key is active
 */
export function isWhichKeyActive(): boolean {
  return whichKeyState.active;
}

/**
 * Activate which-key with given prefix and bindings
 */
export function activateWhichKey(prefix: string, bindings: WhichKeyBinding[]): void {
  whichKeyState.active = true;
  whichKeyState.prefix = prefix;
  whichKeyState.bindings = bindings;
  whichKeyState.timerId = null;
}

/**
 * Deactivate which-key
 */
export function deactivateWhichKey(): void {
  if (whichKeyState.timerId) {
    clearTimeout(whichKeyState.timerId);
    whichKeyState.timerId = null;
  }
  whichKeyState.active = false;
  whichKeyState.prefix = "";
  whichKeyState.bindings = [];
}

/**
 * Schedule which-key activation after timeout
 */
export function scheduleWhichKey(
  prefix: string,
  bindings: WhichKeyBinding[],
  callback: () => void
): void {
  // Clear any existing timer
  if (whichKeyState.timerId) {
    clearTimeout(whichKeyState.timerId);
  }

  // Schedule new timer
  whichKeyState.timerId = setTimeout(() => {
    activateWhichKey(prefix, bindings);
    callback();
  }, whichKeyState.timeout);
}

/**
 * Find all key bindings that start with the given prefix
 */
export function findBindingsForPrefix(
  prefix: string,
  keyMappings: Map<string, KeyMapping[]>,
  mode: string
): WhichKeyBinding[] {
  const bindings: WhichKeyBinding[] = [];

  // Iterate through all key mappings
  for (const [key, mappings] of keyMappings) {
    // Check if this key binding starts with the prefix (plus a space for multi-key sequences)
    if (key.startsWith(prefix + " ") || key === prefix) {
      // Find mappings for the current mode
      const modeMappings = mappings.filter(m => !m.mode || m.mode === mode);

      for (const mapping of modeMappings) {
        bindings.push({
          key: mapping.key,
          command: mapping.command,
          mode: mapping.mode || mode,
        });
      }
    }
  }

  return bindings;
}

/**
 * Get the display key for a binding (removes the prefix)
 */
export function getDisplayKey(fullKey: string, prefix: string): string {
  if (fullKey === prefix) {
    return fullKey;
  }
  // Remove prefix and following space
  return fullKey.substring(prefix.length + 1);
}

/**
 * Format which-key bindings for display
 */
export function formatWhichKeyBindings(bindings: WhichKeyBinding[], prefix: string): string[] {
  return bindings.map(binding => {
    const displayKey = getDisplayKey(binding.key, prefix);
    return `${displayKey} : ${binding.command}`;
  });
}

/**
 * Find next-level bindings after typing another key
 */
export function findNextLevelBindings(
  currentPrefix: string,
  nextKey: string,
  keyMappings: Map<string, KeyMapping[]>,
  mode: string
): WhichKeyBinding[] {
  const newPrefix = currentPrefix ? `${currentPrefix} ${nextKey}` : nextKey;
  return findBindingsForPrefix(newPrefix, keyMappings, mode);
}

/**
 * Check if a key is a prefix for other bindings
 */
export function isPrefixKey(
  key: string,
  keyMappings: Map<string, KeyMapping[]>,
  mode: string
): boolean {
  for (const [mappedKey, mappings] of keyMappings) {
    // Check if any binding starts with this key (as a prefix)
    if (mappedKey.startsWith(key + " ") || mappedKey === key) {
      // Check if there's a binding for current mode
      const hasModeBinding = mappings.some(m => !m.mode || m.mode === mode);
      if (hasModeBinding) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Enable which-key functionality
 */
export function enableWhichKey(): void {
  whichKeyState.timeout = DEFAULT_WHICH_KEY_TIMEOUT;
}

/**
 * Disable which-key functionality
 */
export function disableWhichKey(): void {
  deactivateWhichKey();
  whichKeyState.timeout = 0;
}

/**
 * Get current which-key timeout
 */
export function getWhichKeyTimeout(): number {
  return whichKeyState.timeout;
}
