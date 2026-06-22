/**
 * @file replace-handler.ts
 * @description SPEC-044 Phase 2.C — R replace-mode key handler.
 *
 * R mode overwrites the char at cursor and advances; at EOL it appends
 * (delegates to insert). Backspace moves the cursor left without deleting.
 * Escape returns to normal mode.
 */

import type { Editor } from "../editor.ts";
import { resolveMapping } from "../editor.ts";
import { log } from "../../utils/logger.ts";

export async function handleReplaceMode(editor: Editor, key: string, normalizedKey: string): Promise<void> {
  const handlerLog = log.module('handlers').fn('handleReplaceMode');

  if (normalizedKey === "Escape") {
    handlerLog.info('Returning to normal mode from replace mode', {
      data: { triggerKey: 'Escape', fromMode: 'replace' }
    });
    try {
      (editor as any).executeCommand("(undo-commit \"R\")");
    } catch (_) {
      // No active undo session — silently skip
    }
    (editor as any).state.mode = "normal";
    (editor as any).resetCount();
    return;
  }

  if (key.length === 1 && key >= " " && key <= "~") {
    const escapedKey = (editor as any).escapeKeyForTLisp(key);
    (editor as any).executeCommand(`(vim-replace-mode-insert-char "${escapedKey}")`);
    return;
  }

  if (normalizedKey === "Enter") {
    (editor as any).executeCommand("(insert-newline)");
    return;
  }

  if (normalizedKey === "Backspace") {
    (editor as any).executeCommand("(cursor-move (cursor-line) (max 0 (- (cursor-column) 1)))");
    return;
  }

  if (normalizedKey === "Tab") {
    (editor as any).executeCommand("(insert-tab)");
    return;
  }

  const keyMappings = (editor as any).keyMappings;
  const mappings = keyMappings.get(normalizedKey);

  if (!mappings) {
    (editor as any).state.statusMessage = `Unbound key: ${normalizedKey}`;
    (editor as any).logMessage(`Unbound key: ${normalizedKey}`, 'warn');
    return;
  }

  const currentMajorMode = editor.getCurrentMajorMode?.() as string | undefined;
  const mapping = resolveMapping(mappings, "replace", currentMajorMode);
  if (!mapping) {
    (editor as any).state.statusMessage = `Unbound key in replace mode: ${normalizedKey}`;
    (editor as any).logMessage(`Unbound key in replace mode: ${normalizedKey}`, 'warn');
    return;
  }

  try {
    (editor as any).executeCommand(mapping.command);
  } catch (error) {
    if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
      throw new Error("EDITOR_QUIT_SIGNAL");
    }
    (editor as any).state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
    (editor as any).logMessage(`Command error: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}
