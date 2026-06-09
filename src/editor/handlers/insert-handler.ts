/**
 * @file insert-handler.ts
 * @description Insert mode key handler for the editor
 */

import type { Editor } from "../editor.ts";
import { resolveMapping } from "../editor.ts";
import { log } from "../../utils/logger.ts";

/**
 * Handle key input in insert mode
 * @param editor - Editor instance
 * @param key - Raw key input
 * @param normalizedKey - Normalized key string
 * @returns Promise that resolves when key handling is complete
 */
export async function handleInsertMode(editor: Editor, key: string, normalizedKey: string): Promise<void> {
  const handlerLog = log.module('handlers').fn('handleInsertMode');

  // Log Escape key to return to normal mode
  if (normalizedKey === "Escape") {
    handlerLog.info('Returning to normal mode from insert mode', {
      data: { triggerKey: 'Escape', fromMode: 'insert' }
    });
  }

  // Handle printable characters in insert mode
  if (key.length === 1 && key >= " " && key <= "~") {
    const escapedKey = (editor as any).escapeKeyForTLisp(key);
    (editor as any).executeCommand(`(buffer-insert "${escapedKey}")`);
  }
  // Handle Enter key in insert mode with proper escaping
  else if (normalizedKey === "Enter") {
    (editor as any).executeCommand("(insert-newline)");
    // Auto-indent: set indent on the new line (cursor is now on it)
    try {
      const line = (editor as any).state.cursorPosition?.line ?? (editor as any).tlispState?.cursorLine ?? 0;
      (editor as any).executeCommand(`(indent-apply-line ${line})`);
    } catch (_) {
      // No indent rules set — silently skip
    }
    // List auto-continuation for markdown mode
    try {
      (editor as any).executeCommand("(markdown-list-continue)");
    } catch (_) {
      // Not in markdown mode or no list context — silently skip
    }
  }
  // Handle Backspace key in insert mode
  else if (normalizedKey === "Backspace") {
    handlerLog.debug('Deleting character in insert mode', {
      data: { key: 'Backspace' }
    });
    (editor as any).executeCommand("(insert-backspace)");
  }
  // Handle Tab key in insert mode
  else if (normalizedKey === "Tab") {
    (editor as any).executeCommand("(insert-tab)");
  }
  // Handle Escape key to return to normal mode
  else if (normalizedKey === "Escape") {
    (editor as any).state.mode = "normal";
    // Reset count prefix when switching modes (US-1.3.1)
    (editor as any).resetCount();
  }
  // For other keys in insert mode, treat as regular key mappings
  else {
    const keyMappings = (editor as any).keyMappings; // Access private property
    const mappings = keyMappings.get(normalizedKey);

    if (!mappings) {
      (editor as any).state.statusMessage = `Unbound key: ${normalizedKey}`;
      (editor as any).logMessage(`Unbound key: ${normalizedKey}`, 'debug');
    } else {
      // Find mapping for insert mode
      const currentMajorMode = (editor as any).getCurrentMajorMode?.() as string | undefined;
      const mapping = resolveMapping(mappings, "insert", currentMajorMode);
      if (!mapping) {
        (editor as any).state.statusMessage = `Unbound key in insert mode: ${normalizedKey}`;
        (editor as any).logMessage(`Unbound key in insert mode: ${normalizedKey}`, 'debug');
      } else {
        // Execute the mapped command
        try {
          (editor as any).executeCommand(mapping.command);
        } catch (error) {
          if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
            throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal to main loop
          }
          (editor as any).state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
          (editor as any).logMessage(`Command error: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
      }
    }
  }
}
