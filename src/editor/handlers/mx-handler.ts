/** @file mx-handler.ts Generic minibuffer key router. */

import type { EditorDispatchPort } from "./editor-dispatch-port.ts";

/**
 * Route one normalized key into the Lisp-owned minibuffer state machine.
 */
export async function handleMxMode(editor: EditorDispatchPort, key: string, normalizedKey: string): Promise<void> {
  const routedKey = key.length === 1 && key >= " " && key !== "\x7f"
    ? key
    : normalizedKey;
  const escaped = editor.escapeKeyForTLisp(routedKey);
  await editor.executeCommandAsync(`(minibuffer-dispatch-key "${escaped}")`);
}
