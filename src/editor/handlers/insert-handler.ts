/**
 * @file insert-handler.ts
 * @description Insert mode key handler for the editor
 */

import type { Editor } from "../editor.ts";

/**
 * Handle key input in insert mode
 * @param editor - Editor instance
 * @param key - Raw key input
 * @param normalizedKey - Normalized key string
 * @returns Promise that resolves when key handling is complete
 */
export async function handleInsertMode(editor: Editor, key: string, normalizedKey: string): Promise<void> {
  // Handle printable characters in insert mode
  if (key.length === 1 && key >= " " && key <= "~") {
    const escapedKey = (editor as any).escapeKeyForTLisp(key);
    (editor as any).executeCommand(`(buffer-insert "${escapedKey}")`);
  }
  // Handle Enter key in insert mode with proper escaping
  else if (normalizedKey === "Enter") {
    const escapedNewline = (editor as any).escapeKeyForTLisp("\n");
    (editor as any).executeCommand(`(buffer-insert "${escapedNewline}")`);
  }
  // Handle Backspace key in insert mode
  else if (normalizedKey === "Backspace") {
    (editor as any).executeCommand("(buffer-delete 1)");
  }
  // Handle Escape key to return to normal mode
  else if (normalizedKey === "Escape") {
    (editor as any).state.mode = "normal";
  }
  // For other keys in insert mode, treat as regular key mappings
  else {
    const keyMappings = (editor as any).keyMappings; // Access private property
    const mappings = keyMappings.get(normalizedKey);

    if (!mappings) {
      (editor as any).state.statusMessage = `Unbound key: ${normalizedKey}`;
    } else {
      // Find mapping for insert mode
      const mapping = mappings.find((m: any) => !m.mode || m.mode === "insert");
      if (!mapping) {
        (editor as any).state.statusMessage = `Unbound key in insert mode: ${normalizedKey}`;
      } else {
        // Execute the mapped command
        try {
          (editor as any).executeCommand(mapping.command);
        } catch (error) {
          if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
            throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal to main loop
          }
          (editor as any).state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    }
  }
}