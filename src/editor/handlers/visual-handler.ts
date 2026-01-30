/**
 * @file visual-handler.ts
 * @description Visual mode key handler for the editor
 */

import type { Editor } from "../editor.ts";

/**
 * Handle key input in visual mode
 * @param editor - Editor instance
 * @param key - Raw key input
 * @param normalizedKey - Normalized key string
 * @returns Promise that resolves when key handling is complete, or rejects with quit signal
 */
export async function handleVisualMode(editor: Editor, key: string, normalizedKey: string): Promise<void> {
  // Handle regular key mappings in visual mode
  const keyMappings = (editor as any).keyMappings; // Access private property
  const mappings = keyMappings.get(normalizedKey);

  if (!mappings) {
    (editor as any).state.statusMessage = `Unbound key: ${normalizedKey}`;
  } else {
    // Find mapping for visual mode
    const mapping = mappings.find((m: any) => !m.mode || m.mode === "visual");
    if (!mapping) {
      (editor as any).state.statusMessage = `Unbound key in visual mode: ${normalizedKey}`;
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