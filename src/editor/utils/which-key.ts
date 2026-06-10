/**
 * @file which-key.ts
 * @description Which-key popup utility for discovering key bindings (US-1.10.3)
 *
 * Implements Emacs-style which-key functionality that shows available key bindings
 * after pausing on a key prefix.
 *
 * Extended with command documentation preview (US-1.10.4)
 */

import type { WhichKeyBinding, KeyBinding as KeyMapping } from "../../core/types.ts";
import type { TLispInterpreterImpl } from "../../tlisp/interpreter.ts";

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
 * Module-level which-key state.
 *
 * SINGLETON LIMITATION: This state is shared across all editor instances.
 * Currently the daemon runs one editor per frame, so this works in practice.
 * If multi-frame support requires per-instance state, refactor to accept
 * state as a parameter or use a factory pattern.
 */
let whichKeyState: WhichKeyState = {
  active: false,
  prefix: "",
  bindings: [],
  timeout: DEFAULT_WHICH_KEY_TIMEOUT,
  timerId: null,
};

/**
 * Reset which-key state to initial values.
 *
 * Call this when tearing down an editor/Frame to avoid stale timers leaking
 * across Frame lifecycles. Accepts an optional timeout override (used by
 * tests to set a short timeout).
 */
export function resetWhichKeyState(timeout?: number): void {
  if (whichKeyState.timerId) {
    clearTimeout(whichKeyState.timerId);
  }
  whichKeyState = {
    active: false,
    prefix: "",
    bindings: [],
    timeout: timeout ?? DEFAULT_WHICH_KEY_TIMEOUT,
    timerId: null,
  };
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
function activateWhichKey(prefix: string, bindings: WhichKeyBinding[]): void {
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
function findBindingsForPrefix(
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
function getDisplayKey(fullKey: string, prefix: string): string {
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
 * Fetch documentation for a command from the T-Lisp interpreter
 * @param commandName - The name of the command/function
 * @param interpreter - The T-Lisp interpreter instance
 * @returns Documentation string or "No documentation available"
 */
function getCommandDocumentation(commandName: string, interpreter: TLispInterpreterImpl): string {
  try {
    // Look up the function in the global environment
    const func = interpreter.globalEnv.lookup(commandName);

    if (!func || func.type !== "function") {
      return "No documentation available";
    }

    // Return docstring if available
    const funcValue = func as { docstring?: string };
    if (funcValue.docstring) {
      return funcValue.docstring;
    }

    return "No documentation available";
  } catch (error) {
    return "No documentation available";
  }
}

/**
 * Truncate documentation to specified length with ellipsis
 * @param documentation - The full documentation string
 * @param maxLength - Maximum length before truncation
 * @returns Truncated documentation with "..." if needed
 */
function truncateDocumentation(documentation: string, maxLength: number = 80): string {
  if (documentation.length <= maxLength) {
    return documentation;
  }

  // Truncate and add ellipsis
  return documentation.substring(0, maxLength - 3) + "...";
}

/**
 * Find all key bindings that start with the given prefix, including documentation
 * @param prefix - The key prefix to search for
 * @param keyMappings - All key mappings
 * @param mode - Current editor mode
 * @param interpreter - T-Lisp interpreter for fetching documentation
 * @returns Array of WhichKeyBinding with documentation
 */
export function findBindingsForPrefixWithDocs(
  prefix: string,
  keyMappings: Map<string, KeyMapping[]>,
  mode: string,
  interpreter: TLispInterpreterImpl
): WhichKeyBinding[] {
  const bindings: WhichKeyBinding[] = [];

  // Iterate through all key mappings
  for (const [key, mappings] of keyMappings) {
    // Check if this key binding starts with the prefix (plus a space for multi-key sequences)
    if (key.startsWith(prefix + " ") || key === prefix) {
      // Find mappings for the current mode
      const modeMappings = mappings.filter(m => !m.mode || m.mode === mode);

      for (const mapping of modeMappings) {
        // Fetch documentation for the command
        const fullDocumentation = getCommandDocumentation(mapping.command, interpreter);

        // Truncate documentation for which-key preview (US-1.10.4)
        // Use 60 character limit for which-key display to keep it concise
        const documentation = truncateDocumentation(fullDocumentation, 60);

        bindings.push({
          key: mapping.key,
          command: mapping.command,
          mode: mapping.mode || mode,
          documentation,  // Include truncated documentation for preview (US-1.10.4)
        });
      }
    }
  }

  return bindings;
}
