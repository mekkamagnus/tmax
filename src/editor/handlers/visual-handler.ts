/**
 * @file visual-handler.ts
 * @description Visual mode key handler for the editor
 */

import type { EditorDispatchPort } from "./editor-dispatch-port.ts";
import { resolveMapping } from "../key-resolution.ts";
import { isTruthy } from "../../tlisp/values.ts";

/**
 * Handle key input in visual mode
 * @param editor - Editor instance
 * @param key - Raw key input
 * @param normalizedKey - Normalized key string
 * @returns Promise that resolves when key handling is complete, or rejects with quit signal
 */
export async function handleVisualMode(editor: EditorDispatchPort, key: string, normalizedKey: string): Promise<void> {
  const interpreter = editor.getInterpreter();

  // SPEC-069 Phase 3 — visual text-object (vi/va + class) pending routing.
  // i/a in visual mode stash the inner/around choice; the NEXT key is the
  // text-object class and is routed to visual-dispatch-text-object instead of
  // its normal visual binding (e.g. "w" → word selection, not word-next).
  // Escape/C-g cancels the pending state and falls through to visual-exit.
  const pendingResult = interpreter ? interpreter.execute("(visual-text-object-pending-p)") as any : null;
  const visualTextObjectPending = !!(pendingResult && pendingResult._tag === "Right" && isTruthy(pendingResult.right));

  if (visualTextObjectPending && normalizedKey !== "Escape" && normalizedKey !== "C-g") {
    try {
      editor.executeCommand(`(visual-dispatch-text-object "${editor.escapeKeyForTLisp(normalizedKey)}")`);
    } catch (error) {
      if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
        throw new Error("EDITOR_QUIT_SIGNAL");
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      editor.applyUpdate({ type: "SetStatusMessage", message: `Command error: ${errorMsg}` });
      editor.logMessage(`Command error: ${errorMsg}`, 'error');
    }
    return;
  }

  if (normalizedKey === "Escape" || normalizedKey === "C-g") {
    try {
      interpreter?.execute("(visual-reset-text-object-pending)");
    } catch {
      // Pending reset is best-effort; fall through to the mapped visual-exit.
    }
  }

  // Handle regular key mappings in visual mode
  const mappings = editor.getKeyMappings().get(normalizedKey);

  if (!mappings) {
    editor.applyUpdate({ type: "SetStatusMessage", message: `Unbound key: ${normalizedKey}` });
    editor.logMessage(`Unbound key: ${normalizedKey}`, 'warn');
  } else {
    // Find mapping for visual mode
    const currentMajorMode = editor.getCurrentMajorMode();
    const mapping = resolveMapping(mappings, "visual", currentMajorMode);
    if (!mapping) {
      editor.applyUpdate({ type: "SetStatusMessage", message: `Unbound key in visual mode: ${normalizedKey}` });
      editor.logMessage(`Unbound key in visual mode: ${normalizedKey}`, 'warn');
    } else {
      // Execute the mapped command
      try {
        editor.executeCommand(mapping.command);

        // Update visual selection end position after command execution
        // This allows cursor movement to expand the selection
        if (interpreter) {
          interpreter.execute("(visual-update-end)");
          // Ignore errors - visual-update-end only works if in visual mode
        }
      } catch (error) {
        if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
          throw new Error("EDITOR_QUIT_SIGNAL"); // Re-throw clean quit signal to main loop
        }
        const errorMsg = error instanceof Error ? error.message : String(error);
        editor.applyUpdate({ type: "SetStatusMessage", message: `Command error: ${errorMsg}` });
        editor.logMessage(`Command error: ${errorMsg}`, 'error');
      }
    }
  }
}
