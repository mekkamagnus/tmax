/**
 * @file visual-handler.ts
 * @description Visual mode key handler for the editor
 */

import type { Editor } from "../editor.ts";
import { resolveMapping } from "../editor.ts";

/**
 * Handle key input in visual mode
 * @param editor - Editor instance
 * @param key - Raw key input
 * @param normalizedKey - Normalized key string
 * @returns Promise that resolves when key handling is complete, or rejects with quit signal
 */
export async function handleVisualMode(editor: Editor, key: string, normalizedKey: string): Promise<void> {
  // Handle regular key mappings in visual mode
  const mappings = editor.getKeyMappings().get(normalizedKey);

  if (!mappings) {
    editor.patchModel({ statusMessage: `Unbound key: ${normalizedKey}` });
    editor.logMessage(`Unbound key: ${normalizedKey}`, 'warn');
  } else {
    // Find mapping for visual mode
    const currentMajorMode = editor.getCurrentMajorMode();
    const mapping = resolveMapping(mappings, "visual", currentMajorMode);
    if (!mapping) {
      editor.patchModel({ statusMessage: `Unbound key in visual mode: ${normalizedKey}` });
      editor.logMessage(`Unbound key in visual mode: ${normalizedKey}`, 'warn');
    } else {
      // Execute the mapped command
      try {
        editor.executeCommand(mapping.command);

        // Update visual selection end position after command execution
        // This allows cursor movement to expand the selection
        const interpreter = editor.getInterpreter();
        if (interpreter) {
          interpreter.execute("(visual-update-end)");
          // Ignore errors - visual-update-end only works if in visual mode
        }
      } catch (error) {
        if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
          throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal to main loop
        }
        const errorMsg = error instanceof Error ? error.message : String(error);
        editor.patchModel({ statusMessage: `Command error: ${errorMsg}` });
        editor.logMessage(`Command error: ${errorMsg}`, 'error');
      }
    }
  }
}
