/**
 * @file normal-handler.ts
 * @description Normal mode key handler for the editor
 */

import type { Editor } from "../editor.ts";
import { Either } from "../../utils/task-either.ts";
import { log } from "../../utils/logger.ts";
import {
  scheduleWhichKey,
  deactivateWhichKey,
  isPrefixKey,
  findBindingsForPrefix,
  findBindingsForPrefixWithDocs,
  formatWhichKeyBindings,
  isWhichKeyActive
} from "../utils/which-key.ts";
import type { WhichKeyBinding } from "../../core/types.ts";

/**
 * Handle key input in normal mode
 * @param editor - Editor instance
 * @param key - Raw key input
 * @param normalizedKey - Normalized key string
 * @returns Promise that resolves when key handling is complete, or rejects with quit signal
 */
export async function handleNormalMode(editor: Editor, key: string, normalizedKey: string): Promise<void> {
  const handlerLog = log.module('handlers').fn('handleNormalMode');

  // Log important mode-changing keys
  if (normalizedKey === ':') {
    handlerLog.info('Entering command mode', {
      data: { triggerKey: ':', fromMode: 'normal' }
    });
  } else if (normalizedKey === 'i') {
    handlerLog.info('Entering insert mode', {
      data: { triggerKey: 'i', fromMode: 'normal' }
    });
  } else if (key === 'd') {
    // Could be single 'd' or start of 'dd'
    handlerLog.debug('Delete operation initiated', {
      data: { key, normalizedKey }
    });
  }

  // Handle C-g to cancel which-key popup (US-1.10.3)
  if (normalizedKey === "C-g") {
    handlerLog.debug('Cancelling which-key popup', {
      data: { whichKeyWasActive: isWhichKeyActive() }
    });

    if (isWhichKeyActive()) {
      deactivateWhichKey();
      (editor as any).state.whichKeyActive = false;
      (editor as any).state.whichKeyPrefix = "";
      (editor as any).state.whichKeyBindings = [];
      (editor as any).state.statusMessage = "";
      return;
    }
  }

  // Handle digit input for count prefix (US-1.3.1)
  if (/^[0-9]$/.test(normalizedKey)) {
    const digit = parseInt(normalizedKey, 10);

    // Accumulate count (multiply existing count by 10 and add digit)
    // Special case: 0 at start doesn't accumulate (0w should do nothing)
    const currentCount = (editor as any).countPrefix || 0;
    if (currentCount === 0 && digit === 0) {
      // 0 at start - keep count at 0 (will result in no operation when command executes)
      (editor as any).setCount(0);
      (editor as any).state.statusMessage = `Count: 0`;
    } else {
      (editor as any).setCount(currentCount * 10 + digit);
      (editor as any).state.statusMessage = `Count: ${currentCount * 10 + digit}`;
    }
    return;
  }

  // Handle which-key popup (US-1.10.3)
  const keyMappings = (editor as any).keyMappings;
  const currentPrefix = (editor as any).state.whichKeyPrefix || "";

  // Check if this key could be a prefix for other bindings
  if (isPrefixKey(normalizedKey, keyMappings, "normal")) {
    // Schedule which-key activation
    const newPrefix = currentPrefix ? `${currentPrefix} ${normalizedKey}` : normalizedKey;

    // Get bindings with documentation (US-1.10.4)
    const interpreter = (editor as any).interpreter;
    const bindings = findBindingsForPrefixWithDocs(newPrefix, keyMappings, "normal", interpreter);

    scheduleWhichKey(newPrefix, bindings, () => {
      // Update editor state when which-key activates
      (editor as any).state.whichKeyActive = true;
      (editor as any).state.whichKeyPrefix = newPrefix;
      (editor as any).state.whichKeyBindings = bindings;

      // Format bindings for display with documentation preview
      const formatted = formatWhichKeyBindings(bindings, newPrefix);
      (editor as any).state.statusMessage = `Which-key: ${formatted.join(", ")}`;
    });
  } else {
    // Not a prefix key, deactivate which-key
    deactivateWhichKey();
    (editor as any).state.whichKeyActive = false;
    (editor as any).state.whichKeyPrefix = "";
    (editor as any).state.whichKeyBindings = [];
  }

  // Handle regular key mappings in normal mode
  const mappings = keyMappings.get(normalizedKey);

  if (!mappings) {
    // Unbound key - reset count
    handlerLog.debug(`Unbound key in normal mode: ${normalizedKey}`, {
      data: { key, normalizedKey }
    });
    (editor as any).resetCount();
    (editor as any).state.statusMessage = `Unbound key: ${normalizedKey}`;
  } else {
    // Find mapping for normal mode
    const mapping = mappings.find((m: any) => !m.mode || m.mode === "normal");
    if (!mapping) {
      handlerLog.debug(`No normal mode mapping for key: ${normalizedKey}`, {
        data: { key, normalizedKey, availableModes: mappings.map((m: any) => m.mode) }
      });
      (editor as any).resetCount();
      (editor as any).state.statusMessage = `Unbound key in normal mode: ${normalizedKey}`;
    } else {
      // Log command execution
      handlerLog.debug(`Executing command: ${mapping.command}`, {
        data: {
          command: mapping.command,
          key: normalizedKey,
          count: (editor as any).countPrefix || 1
        }
      });

      // Execute the mapped command with count applied
      try {
        let command = mapping.command;
        const count = (editor as any).getCount();

        // Deactivate which-key before executing command (US-1.10.3)
        deactivateWhichKey();
        (editor as any).state.whichKeyActive = false;
        (editor as any).state.whichKeyPrefix = "";
        (editor as any).state.whichKeyBindings = [];

        // If count is active, repeat the command N times
        // For count=0, execute once with special handling (Vim behavior: 0w does nothing)
        if (count > 0) {
          // Execute command N times
          for (let i = 0; i < count; i++) {
            (editor as any).executeCommand(command);
          }
          // Reset count after use
          (editor as any).resetCount();
        } else {
          // count is 0 - execute once (commands should handle 0 appropriately)
          (editor as any).executeCommand(command);
        }
      } catch (error) {
        // Reset count on error
        (editor as any).resetCount();
        if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
          handlerLog.info('Quit signal received', {
            data: { signal: error.message }
          });
          throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal to main loop
        }

        const err = error instanceof Error ? error : new Error(String(error));
        handlerLog.error('Command execution failed', err, {
          operation: mapping.command,
          data: { key: normalizedKey, count: (editor as any).countPrefix || 1 }
        });

        (editor as any).state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }
}