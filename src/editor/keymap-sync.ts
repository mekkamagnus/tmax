/**
 * @file keymap-sync.ts
 * @description Bidirectional synchronization layer between T-Lisp keymaps and Editor
 *
 * This class provides a bridge between T-Lisp keymap data structures and the
 * Editor's TypeScript key handling system. It allows T-Lisp code to define
 * keybindings that are respected by the editor's key dispatch system.
 *
 * Architecture:
 * - T-Lisp keymaps are registered for specific modes (normal, insert, visual, etc.)
 * - During key dispatch, Editor queries KeymapSync for the current mode
 * - If a T-Lisp keymap has a binding, it takes precedence over TypeScript registry
 * - If no T-Lisp binding exists, Editor falls back to TypeScript key registry
 *
 * Usage:
 *   const keymapSync = new KeymapSync(interpreter);
 *   keymapSync.registerTlispKeymap("normal", myKeymap);
 *   const command = await keymapSync.lookupKeyBinding("normal", "j");
 */

import type { TLispInterpreter, TLispValue } from "../tlisp/types.ts";
import { isHashmap, isNil } from "../tlisp/values.ts";
import { log } from "../utils/logger.ts";

/**
 * KeymapSync manages the synchronization between T-Lisp keymaps and Editor
 */
export class KeymapSync {
  private interpreter: TLispInterpreter;
  private registeredKeymaps: Map<string, TLispValue>;
  private logger;

  /**
   * Create a new KeymapSync instance
   * @param interpreter - T-Lisp interpreter instance for executing keymap lookups
   */
  constructor(interpreter: TLispInterpreter) {
    this.interpreter = interpreter;
    this.registeredKeymaps = new Map();
    this.logger = log.module('keymap-sync');
  }

  /**
   * Register a T-Lisp keymap for a specific editor mode
   * @param mode - Editor mode (normal, insert, visual, command, mx)
   * @param keymap - T-Lisp keymap value (hashmap with mode, parent, bindings)
   *
   * This registers a T-Lisp keymap so that the editor will check it during
   * key dispatch. If a key is pressed in the specified mode, the keymap
   * will be queried for a binding before falling back to TypeScript bindings.
   */
  registerTlispKeymap(mode: string, keymap: TLispValue): void {
    this.logger.debug(`Registering T-Lisp keymap for mode: ${mode}`, {
      data: { mode, keymapType: keymap.type }
    });

    this.registeredKeymaps.set(mode, keymap);
  }

  /**
   * Look up a key binding in the T-Lisp keymap for a mode
   * @param mode - Editor mode to query
   * @param key - Key string to look up
   * @returns Promise resolving to command string, or null if no binding found
   *
   * This method is called during key dispatch to check if a T-Lisp keymap
   * has a binding for the given key in the current mode.
   */
  async lookupKeyBinding(mode: string, key: string): Promise<string | null> {
    const keymap = this.registeredKeymaps.get(mode);

    if (!keymap) {
      this.logger.debug(`No keymap registered for mode: ${mode}`);
      return null;
    }

    // Validate keymap structure
    if (!isHashmap(keymap)) {
      this.logger.warn(`Registered keymap for mode ${mode} is not a hashmap`, {
        data: { keymapType: keymap.type }
      });
      return null;
    }

    try {
      // Get the bindings hashmap from the keymap
      const bindingsValue = keymap.value.get("bindings");

      if (!bindingsValue || !isHashmap(bindingsValue)) {
        this.logger.debug(`Keymap for mode ${mode} has no valid bindings`, {
          data: { bindingsType: bindingsValue?.type }
        });
        return null;
      }

      // Look up the key in the bindings
      const commandValue = bindingsValue.value.get(key);

      if (!commandValue) {
        this.logger.debug(`No binding found for key "${key}" in mode ${mode}`);
        return null;
      }

      // Extract command string
      if (commandValue.type === "string") {
        const command = commandValue.value;
        this.logger.debug(`Found binding: ${key} -> ${command} in mode ${mode}`);
        return command;
      }

      // Binding exists but is not a string
      this.logger.warn(`Invalid binding type for key "${key}" in mode ${mode}`, {
        data: { bindingType: commandValue.type }
      });
      return null;

    } catch (error) {
      this.logger.error(`Error looking up key binding in T-Lisp keymap`, undefined, {
        operation: 'lookupKeyBinding',
        data: { mode, key, error: error instanceof Error ? error.message : String(error) }
      });
      return null;
    }
  }

  /**
   * Get the active keymap for a mode
   * @param mode - Editor mode to query
   * @returns The registered T-Lisp keymap value, or null if none registered
   *
   * This method is useful for debugging and for querying which keymap
   * is currently active for a given mode.
   */
  getActiveKeymap(mode: string): TLispValue | null {
    const keymap = this.registeredKeymaps.get(mode);
    return keymap ?? null;
  }

  /**
   * Check if a mode has a registered T-Lisp keymap
   * @param mode - Editor mode to check
   * @returns true if a keymap is registered for the mode
   */
  hasKeymap(mode: string): boolean {
    return this.registeredKeymaps.has(mode);
  }

  /**
   * Unregister a T-Lisp keymap for a mode
   * @param mode - Editor mode to unregister
   *
   * This removes the T-Lisp keymap for a mode, causing the editor to
   * fall back to TypeScript bindings for that mode.
   */
  unregisterKeymap(mode: string): void {
    this.logger.debug(`Unregistering keymap for mode: ${mode}`);
    this.registeredKeymaps.delete(mode);
  }

  /**
   * Clear all registered T-Lisp keymaps
   *
   * This removes all T-Lisp keymaps, causing the editor to use only
   * TypeScript bindings for all modes.
   */
  clearAllKeymaps(): void {
    this.logger.debug('Clearing all registered keymaps');
    this.registeredKeymaps.clear();
  }
}
