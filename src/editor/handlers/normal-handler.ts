/**
 * @file normal-handler.ts
 * @description Normal mode key router for the editor
 */

import type { Editor } from "../editor.ts";
import { resolveMapping } from "../editor.ts";
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
import type { WhichKeyBinding } from "../../core/types.ts";

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

  const spaceActive = (editor as any).spacePressed === true;
  const legacyPrefixActive = spaceActive || currentPrefix !== "";
  const dispatchHandled = legacyPrefixActive
    ? false
    : await executeVimDispatcher(editor, normalizedKey, handlerLog);
  if (dispatchHandled) {
    deactivateWhichKey();
    state.whichKeyActive = false;
    const savedLastCommand = state.lastCommand;
    await maybeScheduleVimPrefixWhichKey(editor, state);
    // Restore lastCommand so it reflects the user-facing dispatch, not
    // the internal prefix-pending query from maybeScheduleVimPrefixWhichKey.
    state.lastCommand = savedLastCommand;
    return;
  }

  let lookupKey: string;
  if (currentPrefix) {
    lookupKey = `${currentPrefix} ${normalizedKey}`;
  } else if (spaceActive) {
    lookupKey = `SPC ${normalizedKey}`;
    (editor as any).spacePressed = false;
  } else {
    lookupKey = normalizedKey;
  }

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

  let mappings = keyMappings.get(lookupKey);
  // If the combined "SPC <key>" has no binding, fall back to the raw key
  // so T-Lisp functions like execute-extended-command-maybe can check the
  // space-prefix flag themselves. Restore spacePressed so the T-Lisp
  // function can detect it.
  if (!mappings && lookupKey.startsWith("SPC ") && keyMappings.has(normalizedKey)) {
    mappings = keyMappings.get(normalizedKey);
    (editor as any).spacePressed = true;
  }
  if (!mappings) {
    handlerLog.debug(`Unbound key in normal mode: ${lookupKey}`, {
      data: { key, normalizedKey, lookupKey }
    });
    state.statusMessage = `Unbound key: ${lookupKey}`;
    (editor as any).logMessage(`Unbound key: ${lookupKey}`, 'debug');
    return;
  }

  const currentMajorMode = (editor as any).getCurrentMajorMode?.() as string | undefined;
  const mapping = resolveMapping(mappings, "normal", currentMajorMode);
  if (!mapping) {
    handlerLog.debug(`No normal mode mapping for key: ${lookupKey}`, {
      data: { key, normalizedKey, lookupKey, availableModes: mappings.map((m: any) => m.mode) }
    });
    state.statusMessage = `Unbound key in normal mode: ${lookupKey}`;
    (editor as any).logMessage(`Unbound key in normal mode: ${lookupKey}`, 'debug');
    return;
  }

  try {
    await (editor as any).executeCommandAsync(mapping.command);
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
    (editor as any).logMessage(`Command error: ${err.message}`, 'error');
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

async function maybeScheduleVimPrefixWhichKey(editor: Editor, state: any): Promise<void> {
  const execute = (cmd: string) => (editor as any).executeCommandAsync(cmd);
  const isRight = (r: any) => r && typeof r === "object" && r._tag === "Right";

  const pendingResult = await execute("(vim-prefix-pending-p)");
  if (!isRight(pendingResult) || !isTruthy((pendingResult as any).right)) return;

  const prefixResult = await execute("(vim-current-prefix)");
  if (!isRight(prefixResult)) return;
  const prefix = (prefixResult as any).right;
  if (!prefix || prefix.type !== "string") return;
  const prefixStr = prefix.value as string;

  const bindingsResult = await execute(`(vim-prefix-bindings "${(editor as any).escapeKeyForTLisp(prefixStr)}")`);
  if (!isRight(bindingsResult)) return;
  const bindingsList = (bindingsResult as any).right;
  if (!bindingsList || bindingsList.type !== "list") return;

  const bindings: WhichKeyBinding[] = (bindingsList.value as any[]).map((entry: any) => {
    const items = entry.value as any[];
    return {
      key: `${prefixStr} ${items[0].value}`,
      command: items[1].value as string,
      mode: "normal",
    };
  });

  // Don't set whichKeyPrefix — vim prefix routing is handled by T-Lisp,
  // not the legacy keymap. Only store bindings for the callback.
  state.whichKeyBindings = bindings;

  scheduleWhichKey(prefixStr, bindings, () => {
    if (state.whichKeyPrefix) return;
    state.whichKeyActive = true;
    const formatted = formatWhichKeyBindings(bindings, prefixStr);
    const msg = `Which-key: ${formatted.join(", ")}`;
    state.statusMessage = msg;
  });
}

function clearLegacyPrefix(editor: Editor): void {
  deactivateWhichKey();
  (editor as any).state.whichKeyActive = false;
  (editor as any).state.whichKeyPrefix = "";
  (editor as any).state.whichKeyBindings = [];
}

async function executeVimDispatcher(editor: Editor, normalizedKey: string, handlerLog: ReturnType<ReturnType<typeof log.module>["fn"]>): Promise<boolean> {
  try {
    const escapedKey = (editor as any).escapeKeyForTLisp(normalizedKey);
    const result = await (editor as any).executeCommandAsync(`(vim-dispatch-key "${escapedKey}")`);

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
      (editor as any).logMessage(`Vim dispatch error: ${message}`, 'error');
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
    (editor as any).logMessage(`Vim dispatch error: ${message}`, 'error');
    return true;
  }
}
