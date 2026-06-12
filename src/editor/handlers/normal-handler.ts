/**
 * @file normal-handler.ts
 * @description Thin normal-mode key router — keymap-first dispatch.
 *
 * Dispatch order (each step returns early when it consumes the key):
 * 1. C-g/Escape — must run first so cancellation wins even when an operator
 *    or find is pending (otherwise the pending state's dispatch would swallow
 *    the key and the user couldn't bail out).
 * 2. Pending state (operator/find awaiting next key) → route to state machine.
 * 3. Digit 1-9 (or 0 when count active) → feed count state machine; must run
 *    before keymap lookup so count-building isn't shadowed by a binding.
 * 4. Keymap prefix (g/z/C-w/SPC/...) → schedule which-key, set prefix.
 * 5. Keymap binding → execute command.
 * 6. Else → "Unbound key".
 *
 * Operator-g sub-state (for `dgg`) is tracked inside the operator state
 * machine via `vim-operator-g-pending`.
 *
 * TypeScript only handles dispatch routing and timer scheduling.
 * All bindings, state machines, and logic live in T-Lisp.
 */

import type { Editor } from "../editor.ts";
import { isTruthy } from "../../tlisp/values.ts";
import type { WhichKeyBinding } from "../../core/types.ts";
import { computeWhichKeyPopup } from "../../frontend/render/which-key-overlay.ts";

const DIGIT_KEYS = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);

const PREFIX_LABELS: Record<string, string> = {
  "z": "z — scroll/viewport",
  "g": "g — goto",
  "C-w": "C-w — window",
  "SPC": "SPC — leader",
};

function prefixLabel(prefix: string): string {
  if (PREFIX_LABELS[prefix]) return PREFIX_LABELS[prefix]!;
  if (prefix.startsWith("SPC ")) return `${prefix} — leader`;
  return prefix;
}

export async function handleNormalMode(editor: Editor, key: string, normalizedKey: string): Promise<void> {
  const state = (editor as any).state;
  const wk = editor.getWhichKeyHandle();
  const interp = (editor as any).getInterpreter();
  const exec = (cmd: string) => interp.execute(cmd);
  const escape = (s: string) => (editor as any).escapeKeyForTLisp(s);
  const isRight = (r: any) => r && typeof r === "object" && r._tag === "Right";

  const spaceActive = (editor as any).spacePressed === true;
  const currentPrefix = state.whichKeyPrefix || "";

  // C-g / Escape cancels any pending state and which-key
  if (normalizedKey === "C-g" || normalizedKey === "Escape") {
    wk.deactivate();
    state.whichKeyActive = false;
    state.whichKeyPrefix = "";
    state.whichKeyBindings = [];
    state.whichKeyPopup = null;
    (editor as any).spacePressed = false;
    try { exec("(vim-reset-pending)"); } catch {}
    state.statusMessage = "";
    return;
  }

  // Route to pending state machine (find/operator awaiting next key).
  // Order matters: find → operator (the operator-g sub-state lives inside
  // `vim-dispatch-operator-key` and tracks the second `g` of `dgg` itself).
  const findPending = isTruthyResult(exec("(vim-find-pending-p)"));
  if (findPending) {
    await executeCommand(editor, `(vim-dispatch-find-target "${escape(normalizedKey)}")`);
    clearWhichKey(state, wk);
    return;
  }
  const operatorPending = isTruthyResult(exec("(vim-operator-pending-p)"));
  if (operatorPending) {
    await executeCommand(editor, `(vim-dispatch-operator-key "${escape(normalizedKey)}")`);
    clearWhichKey(state, wk);
    return;
  }

  // Build lookup key from current prefix context
  let lookupKey: string;
  if (currentPrefix) {
    lookupKey = `${currentPrefix} ${normalizedKey}`;
  } else if (spaceActive) {
    lookupKey = `SPC ${normalizedKey}`;
    (editor as any).spacePressed = false;
  } else {
    lookupKey = normalizedKey;
  }

  // Digits 1-9 always feed the count state machine (never bindings).
  // Digit 0 feeds the count ONLY when count is already active; otherwise it's
  // the "go to column 0" motion (handled by keymap below).
  if (!currentPrefix && !spaceActive) {
    if (DIGIT_KEYS.has(normalizedKey)) {
      feedDigit(editor, exec, normalizedKey);
      return;
    }
    if (normalizedKey === "0" && isTruthyResult(exec("(vim-count-active-p)"))) {
      feedDigit(editor, exec, normalizedKey);
      return;
    }
  }

  // Keymap prefix check → schedule which-key, set prefix
  const prefixResult = exec(`(keymap-prefix-p (current-keymap) "${escape(lookupKey)}")`);
  if (isRight(prefixResult) && isTruthy((prefixResult as any).right)) {
    const bindings = tLispPrefixBindings(exec, escape, lookupKey);
    state.whichKeyPrefix = lookupKey;
    state.whichKeyBindings = bindings;
    wk.schedule(lookupKey, bindings, () => {
      if (state.whichKeyPrefix !== lookupKey) return;
      state.whichKeyActive = true;
      const size = (editor as any).terminal.getSize();
      state.whichKeyPopup = computeWhichKeyPopup(bindings, lookupKey, size.width, Math.max(1, size.height - 4), prefixLabel(lookupKey));
      state.statusMessage = `Which-key: ${bindings.map(b => `${b.key.substring(lookupKey.length + 1)} : ${b.command}`).join(", ")}`;
    });
    return;
  }

  // Keymap binding lookup → execute command
  const cmdResult = exec(`(keymap-ref (current-keymap) "${escape(lookupKey)}")`);
  const cmdRight = isRight(cmdResult) ? (cmdResult as any).right : null;
  if (cmdRight && cmdRight.type === "string") {
    clearWhichKey(state, wk);
    await executeCommand(editor, cmdRight.value);

    // If the command activated the space prefix, schedule which-key for "SPC"
    if ((editor as any).spacePressed === true) {
      schedulePrefixPopup(editor, state, wk, exec, escape, "SPC");
    }
    return;
  }

  // No prefix, no binding — report unbound. If we were in a prefix context,
  // clear which-key state so the abandoned prefix doesn't linger.
  if (currentPrefix || spaceActive) {
    clearWhichKey(state, wk);
    (editor as any).spacePressed = false;
  }
  state.statusMessage = `Unbound key: ${lookupKey}`;
}

function isTruthyResult(result: any): boolean {
  if (!result || result._tag !== "Right") return false;
  return isTruthy(result.right);
}

function feedDigit(editor: Editor, exec: (cmd: string) => any, key: string): void {
  const digitResult = exec(`(vim-key-digit-value "${(editor as any).escapeKeyForTLisp(key)}")`);
  if (digitResult && digitResult._tag === "Right" && digitResult.right?.type === "number") {
    exec(`(vim-count-add-digit ${digitResult.right.value})`);
  }
}

function clearWhichKey(state: any, wk: any): void {
  wk.deactivate();
  state.whichKeyActive = false;
  state.whichKeyPrefix = "";
  state.whichKeyBindings = [];
  state.whichKeyPopup = null;
}

async function executeCommand(editor: Editor, tLispCmd: string): Promise<void> {
  try {
    await (editor as any).executeCommandAsync(tLispCmd);
  } catch (error) {
    if (error instanceof Error && error.message.includes("EDITOR_QUIT_SIGNAL")) {
      throw new Error("EDITOR_QUIT_SIGNAL");
    }
    (editor as any).state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function schedulePrefixPopup(
  editor: Editor, state: any, wk: any,
  exec: (cmd: string) => any, escape: (s: string) => string, prefix: string
): void {
  const bindings = tLispPrefixBindings(exec, escape, prefix);
  if (bindings.length === 0) return;
  state.whichKeyPrefix = prefix;
  state.whichKeyBindings = bindings;
  wk.schedule(prefix, bindings, () => {
    if (state.whichKeyPrefix !== prefix) return;
    state.whichKeyActive = true;
    const size = (editor as any).terminal.getSize();
    state.whichKeyPopup = computeWhichKeyPopup(bindings, prefix, size.width, Math.max(1, size.height - 4), prefixLabel(prefix));
    state.statusMessage = `Which-key: ${bindings.map(b => `${b.key.substring(prefix.length + 1)} : ${b.command}`).join(", ")}`;
  });
}

function tLispPrefixBindings(exec: (cmd: string) => any, escape: (s: string) => string, prefix: string): WhichKeyBinding[] {
  const result = exec(`(keymap-prefix-bindings (current-keymap) "${escape(prefix)}")`);
  if (!result || result._tag !== "Right" || !result.right || result.right.type !== "list") return [];
  return (result.right.value as any[]).map((entry: any) => {
    const items = entry.value as any[];
    return { key: items[0].value, command: items[1].value as string, mode: "normal" };
  });
}
