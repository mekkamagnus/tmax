/**
 * @file replace-handler.ts
 * @description SPEC-044 Phase 2.C — R replace-mode key handler.
 *
 * R mode overwrites the char at cursor and advances; at EOL it appends
 * (delegates to insert). Backspace moves the cursor left without deleting.
 * Escape returns to normal mode.
 */

import type { EditorDispatchPort } from "./editor-dispatch-port.ts";
import { resolveMapping } from "../key-resolution.ts";
import { log } from "../../utils/logger.ts";

export async function handleReplaceMode(editor: EditorDispatchPort, key: string, normalizedKey: string): Promise<void> {
  const handlerLog = log.module('handlers').fn('handleReplaceMode');

  if (normalizedKey === "Escape") {
    handlerLog.info('Returning to normal mode from replace mode', {
      data: { triggerKey: 'Escape', fromMode: 'replace' }
    });
    try {
      editor.executeCommand("(undo-commit \"R\")");
    } catch (_) {
      // No active undo session — silently skip
    }
    editor.applyUpdate({ type: "SetMode", mode: "normal" });
    editor.resetCount();
    return;
  }

  if (key.length === 1 && key >= " " && key <= "~") {
    const escapedKey = editor.escapeKeyForTLisp(key);
    editor.executeCommand(`(vim-replace-mode-insert-char "${escapedKey}")`);
    return;
  }

  if (normalizedKey === "Enter") {
    editor.executeCommand("(insert-newline)");
    return;
  }

  if (normalizedKey === "Backspace") {
    editor.executeCommand("(cursor-move (cursor-line) (max 0 (- (cursor-column) 1)))");
    return;
  }

  if (normalizedKey === "Tab") {
    editor.executeCommand("(insert-tab)");
    return;
  }

  const mappings = editor.getKeyMappings().get(normalizedKey);

  if (!mappings) {
    editor.applyUpdate({ type: "SetStatusMessage", message: `Unbound key: ${normalizedKey}` });
    editor.logMessage(`Unbound key: ${normalizedKey}`, 'warn');
    return;
  }

  const currentMajorMode = editor.getCurrentMajorMode();
  const mapping = resolveMapping(mappings, "replace", currentMajorMode);
  if (!mapping) {
    editor.applyUpdate({ type: "SetStatusMessage", message: `Unbound key in replace mode: ${normalizedKey}` });
    editor.logMessage(`Unbound key in replace mode: ${normalizedKey}`, 'warn');
    return;
  }

  try {
    editor.executeCommand(mapping.command);
  } catch (error) {
    if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
      throw new Error("EDITOR_QUIT_SIGNAL");
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    editor.applyUpdate({ type: "SetStatusMessage", message: `Command error: ${errorMsg}` });
    editor.logMessage(`Command error: ${errorMsg}`, 'error');
  }
}
