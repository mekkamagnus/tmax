/**
 * @file normal-handler.ts
 * @description Normal mode key router for the editor
 */

import type { Editor } from "../editor.ts";
import { Either } from "../../utils/task-either.ts";
import { log } from "../../utils/logger.ts";
import { isTruthy } from "../../tlisp/values.ts";
import {
  scheduleWhichKey,
  deactivateWhichKey,
  findBindingsForPrefixWithDocs,
  formatWhichKeyBindings,
  isWhichKeyActive
} from "../utils/which-key.ts";

/**
 * Handle key input in normal mode.
 *
 * Vim editing semantics are owned by T-Lisp via `vim-dispatch-key`. This
 * handler only routes normalized keys into T-Lisp and then falls back to the
 * legacy keymap for non-Vim bindings.
 */
export async function handleNormalMode(editor: Editor, key: string, normalizedKey: string): Promise<void> {
  const handlerLog = log.module('handlers').fn('handleNormalMode');
  const state = (editor as any).state;
  const keyMappings = (editor as any).keyMappings;
  const currentPrefix = state.whichKeyPrefix || "";

  if (normalizedKey === "C-g" && (isWhichKeyActive() || currentPrefix)) {
    clearLegacyPrefix(editor);
    state.statusMessage = "";
    return;
  }

  const legacyPrefixActive = (editor as any).spacePressed === true || currentPrefix !== "";
  const dispatchHandled = legacyPrefixActive
    ? false
    : executeVimDispatcher(editor, normalizedKey, handlerLog);
  if (dispatchHandled) {
    return;
  }

  const lookupKey = currentPrefix ? `${currentPrefix} ${normalizedKey}` : normalizedKey;

  if (hasLegacyPrefix(lookupKey, keyMappings)) {
    const interpreter = (editor as any).interpreter;
    const bindings = findBindingsForPrefixWithDocs(lookupKey, keyMappings, "normal", interpreter);
    state.whichKeyPrefix = lookupKey;
    state.whichKeyBindings = bindings;

    scheduleWhichKey(lookupKey, bindings, () => {
      if (state.whichKeyPrefix !== lookupKey) {
        return;
      }
      state.whichKeyActive = true;

      const formatted = formatWhichKeyBindings(bindings, lookupKey);
      state.statusMessage = `Which-key: ${formatted.join(", ")}`;
    });
    return;
  }

  clearLegacyPrefix(editor);

  const mappings = keyMappings.get(lookupKey);
  if (!mappings) {
    handlerLog.debug(`Unbound key in normal mode: ${lookupKey}`, {
      data: { key, normalizedKey, lookupKey }
    });
    state.statusMessage = `Unbound key: ${lookupKey}`;
    (editor as any).logMessage(`Unbound key: ${lookupKey}`);
    return;
  }

  const mapping = mappings.find((m: any) => !m.mode || m.mode === "normal");
  if (!mapping) {
    handlerLog.debug(`No normal mode mapping for key: ${lookupKey}`, {
      data: { key, normalizedKey, lookupKey, availableModes: mappings.map((m: any) => m.mode) }
    });
    state.statusMessage = `Unbound key in normal mode: ${lookupKey}`;
    (editor as any).logMessage(`Unbound key in normal mode: ${lookupKey}`);
    return;
  }

  try {
    (editor as any).executeCommand(mapping.command);
  } catch (error) {
    if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
      handlerLog.info('Quit signal received', {
        data: { signal: error.message }
      });
      throw new Error("EDITOR_QUIT_SIGNAL");
    }

    const err = error instanceof Error ? error : new Error(String(error));
    handlerLog.error('Command execution failed', err, {
      operation: mapping.command,
      data: { key: lookupKey }
    });
    state.statusMessage = `Command error: ${err.message}`;
    (editor as any).logMessage(`Command error: ${err.message}`);
  }
}

function hasLegacyPrefix(key: string, keyMappings: Map<string, any[]>): boolean {
  for (const [mappedKey, mappings] of keyMappings) {
    if (
      mappedKey.startsWith(`${key} `) &&
      mappings.some((mapping: any) => !mapping.mode || mapping.mode === "normal")
    ) {
      return true;
    }
  }
  return false;
}

function clearLegacyPrefix(editor: Editor): void {
  deactivateWhichKey();
  (editor as any).state.whichKeyActive = false;
  (editor as any).state.whichKeyPrefix = "";
  (editor as any).state.whichKeyBindings = [];
}

function executeVimDispatcher(editor: Editor, normalizedKey: string, handlerLog: ReturnType<ReturnType<typeof log.module>["fn"]>): boolean {
  try {
    const escapedKey = (editor as any).escapeKeyForTLisp(normalizedKey);
    const result = (editor as any).executeCommand(`(vim-dispatch-key "${escapedKey}")`);

    if (!result || typeof result !== "object" || !("_tag" in result)) {
      return false;
    }

    if (Either.isLeft(result as any)) {
      const error = (result as any).left;
      const message = error?.message ? String(error.message) : String(error);
      if (message.includes("vim-dispatch-key")) {
        return false;
      }
      (editor as any).state.statusMessage = `Vim dispatch error: ${message}`;
      (editor as any).logMessage(`Vim dispatch error: ${message}`);
      return true;
    }

    return isTruthy((result as any).right);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("vim-dispatch-key")) {
      return false;
    }

    if (error instanceof Error && (error.message === "EDITOR_QUIT_SIGNAL" || error.message.includes("EDITOR_QUIT_SIGNAL"))) {
      throw new Error("EDITOR_QUIT_SIGNAL");
    }

    handlerLog.error('Vim dispatcher failed', error instanceof Error ? error : new Error(message), {
      operation: 'vim-dispatch-key',
      data: { key: normalizedKey }
    });
    (editor as any).state.statusMessage = `Vim dispatch error: ${message}`;
    (editor as any).logMessage(`Vim dispatch error: ${message}`);
    return true;
  }
}
