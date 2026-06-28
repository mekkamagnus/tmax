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
import { resolveMapping } from "../editor.ts";
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
  const state = editor.getModel();
  const wk = editor.getWhichKeyHandle();
  const interp = editor.getInterpreter();
  const exec = (cmd: string): any => interp.execute(cmd);
  const escape = (s: string) => editor.escapeKeyForTLisp(s);
  const isRight = (r: any) => r && typeof r === "object" && r._tag === "Right";

  const spaceActive = editor.spacePressed === true;
  const currentPrefix = state.whichKeyPrefix || "";

  // SPEC-044 Phase 1.F-1.H — macro pending states must be routed BEFORE the
  // generic Escape/C-g handler. q<Escape> is a quit command per spec MUST,
  // resolved by macro-dispatch-record calling editor-quit; if the generic
  // Escape branch ran first it would silently cancel the pending state and
  // swallow the quit. The dispatcher also handles @<Escape> as cancel.
  const macroRecordPending = isTruthyResult(exec("(macro-record-pending-p)"));
  if (macroRecordPending) {
    await executeCommand(editor, `(macro-dispatch-record "${escape(normalizedKey)}")`);
    clearWhichKey(state, wk);
    return;
  }
  const macroPlayPending = isTruthyResult(exec("(macro-play-pending-p)"));
  if (macroPlayPending) {
    await executeCommand(editor, `(macro-dispatch-play "${escape(normalizedKey)}")`);
    clearWhichKey(state, wk);
    return;
  }

  // SPEC-044 Phase 2.G — " register-prefix pending. Routed before Escape
  // so the dispatcher can interpret Escape/C-g as cancel; keymap and digit
  // branches would otherwise shadow the register letter (e.g. "a is a
  // valid register but also a binding).
  const registerPrefixPending = isTruthyResult(exec("(vim-register-prefix-pending-p)"));
  if (registerPrefixPending) {
    await executeCommand(editor, `(vim-dispatch-register "${escape(normalizedKey)}")`);
    clearWhichKey(state, wk);
    return;
  }

  // SPEC-044 Phase 2.B — r{char} two-key replace. Routed before Escape so
  // r<Esc> cancels cleanly; keymap/digit branches would otherwise shadow the
  // replacement char.
  const replaceCharPending = isTruthyResult(exec("(vim-replace-char-pending-p)"));
  if (replaceCharPending) {
    const macroRecordingInit = isTruthyResult(exec("(macro-record-active)"));
    if (macroRecordingInit) {
      try { exec(`(macro-record-key "${escape(normalizedKey)}")`); } catch {}
    }
    await executeCommand(editor, `(vim-replace-apply "${escape(normalizedKey)}")`);
    clearWhichKey(state, wk);
    return;
  }

  // C-g / Escape cancels any pending state and which-key. Recording itself
  // is NOT cancelled — only the stopping q ends a recording (vim semantics).
  // macro-record-pending was already handled above, so reaching here means
  // we are either idle or actively recording.
  if (normalizedKey === "C-g" || normalizedKey === "Escape") {
    wk.deactivate();
    state.whichKeyActive = false;
    state.whichKeyPrefix = "";
    state.whichKeyBindings = [];
    state.whichKeyPopup = null;
    editor.spacePressed = false;
    try { exec("(vim-reset-pending)"); } catch {}
    state.statusMessage = "";
    return;
  }

  // Route to pending state machine (find/operator awaiting next key).
  // Order matters: find → text-object → operator (the operator-g sub-state
  // lives inside `vim-dispatch-operator-key` and tracks the second `g` of
  // `dgg` itself). These states can be active WHILE recording; the recording
  // hook below still captures their dispatch keys.
  const findPending = isTruthyResult(exec("(vim-find-pending-p)"));
  if (findPending) {
    const macroRecordingInit = isTruthyResult(exec("(macro-record-active)"));
    if (macroRecordingInit) {
      try { exec(`(macro-record-key "${escape(normalizedKey)}")`); } catch {}
    }
    await executeCommand(editor, `(vim-dispatch-find-target "${escape(normalizedKey)}")`);
    clearWhichKey(state, wk);
    return;
  }
  const markPending = isTruthyResult(exec("(vim-mark-pending-p)"));
  if (markPending) {
    const macroRecordingInit = isTruthyResult(exec("(macro-record-active)"));
    if (macroRecordingInit) {
      try { exec(`(macro-record-key "${escape(normalizedKey)}")`); } catch {}
    }
    await executeCommand(editor, `(vim-dispatch-mark "${escape(normalizedKey)}")`);
    clearWhichKey(state, wk);
    return;
  }
  const textObjectPending = isTruthyResult(exec("(vim-text-object-pending-p)"));
  if (textObjectPending) {
    const macroRecordingInit = isTruthyResult(exec("(macro-record-active)"));
    if (macroRecordingInit) {
      try { exec(`(macro-record-key "${escape(normalizedKey)}")`); } catch {}
    }
    await executeCommand(editor, `(vim-dispatch-text-object "${escape(normalizedKey)}")`);
    clearWhichKey(state, wk);
    return;
  }
  const operatorPending = isTruthyResult(exec("(vim-operator-pending-p)"));
  if (operatorPending) {
    const macroRecordingInit = isTruthyResult(exec("(macro-record-active)"));
    if (macroRecordingInit) {
      try { exec(`(macro-record-key "${escape(normalizedKey)}")`); } catch {}
    }
    await executeCommand(editor, `(vim-dispatch-operator-key "${escape(normalizedKey)}")`);
    clearWhichKey(state, wk);
    return;
  }

  // If recording is active and the user pressed q, route directly to stop so
  // the stopping q is NOT captured by the recording hook below (vim records
  // literal keys but not the q that ends the recording).
  const macroRecording = isTruthyResult(exec("(macro-record-active)"));
  if (macroRecording && normalizedKey === "q") {
    await executeCommand(editor, `(macro-record-stop)`);
    clearWhichKey(state, wk);
    return;
  }

  // Build lookup key from current prefix context
  let lookupKey: string;
  if (currentPrefix) {
    lookupKey = `${currentPrefix} ${normalizedKey}`;
  } else if (spaceActive) {
    lookupKey = `SPC ${normalizedKey}`;
    editor.spacePressed = false;
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
  if (isRight(prefixResult) && isTruthy(prefixResult.right)) {
    const bindings = tLispPrefixBindings(exec, escape, lookupKey);
    state.whichKeyPrefix = lookupKey;
    state.whichKeyBindings = bindings;
    wk.schedule(lookupKey, bindings, () => {
      if (state.whichKeyPrefix !== lookupKey) return;
      state.whichKeyActive = true;
      const size = editor.getTerminal().getSize();
      state.whichKeyPopup = computeWhichKeyPopup(bindings, lookupKey, size.width, Math.max(1, size.height - 4), prefixLabel(lookupKey));
      state.statusMessage = `Which-key: ${bindings.map(b => `${b.key.substring(lookupKey.length + 1)} : ${b.command}`).join(", ")}`;
    });
    return;
  }

  // Major-mode prefix check: if lookupKey is the start of a major-mode
  // multi-key binding (e.g. "]" is a prefix of "] h"), set the prefix and
  // wait for the next key. Major-mode bindings are not in the T-Lisp keymap,
  // so they need their own prefix detection here.
  const majorMode = editor.getCurrentMajorMode();
  if (majorMode && majorMode !== "fundamental" && isMajorModePrefix(editor, lookupKey, majorMode)) {
    state.whichKeyPrefix = lookupKey;
    state.whichKeyBindings = [];
    state.statusMessage = "";
    return;
  }

  // Keymap binding lookup → execute command
  const cmdResult = exec(`(keymap-ref (current-keymap) "${escape(lookupKey)}")`);
  const cmdRight = isRight(cmdResult) ? cmdResult.right : null;
  if (cmdRight && cmdRight.type === "string") {
    clearWhichKey(state, wk);
    // SPEC-044 Phase 1.G — recording-capture hook. Vim records literal keys,
    // so we capture the keystroke BEFORE evaluating its bound command. The
    // stopping q is excluded by the macroRecording && normalizedKey === "q"
    // early-return above; pending-register keys are excluded because their
    // routing returns before reaching this block.
    if (macroRecording) {
      try { exec(`(macro-record-key "${escape(normalizedKey)}")`); } catch {}
    }
    await executeCommand(editor, cmdRight.value);

    // If the command activated the space prefix, schedule which-key for "SPC"
    if (editor.spacePressed === true) {
      schedulePrefixPopup(editor, state, wk, exec, escape, "SPC");
    }
    return;
  }

  // Major-mode-scoped bindings (e.g. "] h" in markdown). The T-Lisp mode
  // keymap above has no major-mode concept, so these live in the editor's
  // keyMappings table and are resolved here as the dispatch path of last
  // resort (after global/mode bindings). Precedence: mode+majorMode >
  // mode > majorMode > global (see resolveMapping).
  if (majorMode && majorMode !== "fundamental") {
    const mapping = lookupMajorModeBinding(editor, lookupKey, majorMode);
    if (mapping) {
      clearWhichKey(state, wk);
      await executeCommand(editor, mapping.command);
      return;
    }
  }

  // No prefix, no binding — report unbound. If we were in a prefix context,
  // clear which-key state so the abandoned prefix doesn't linger.
  if (currentPrefix || spaceActive) {
    clearWhichKey(state, wk);
    editor.spacePressed = false;
  }
  state.statusMessage = `Unbound key: ${lookupKey}`;
  // SPEC-055: log at 'warn' (elevated from SPEC-016's 'debug' for alpha
  // observability) so unbound keys mirror into *Messages*. This fills the
  // last-handler gap — the other three handlers already log unbound keys.
  editor.logMessage(`Unbound key: ${lookupKey}`, 'warn');
}

function isTruthyResult(result: any): boolean {
  if (!result || result._tag !== "Right") return false;
  return isTruthy(result.right);
}

/**
 * The candidate forms a normalized lookup key can be stored under in
 * keyMappings. key-bind stores the key verbatim from the .tlisp source, which
 * uses angle brackets for special keys ("<Tab>"), while the handler normalizes
 * the incoming byte to the bare name ("Tab"). Try both.
 */
function majorModeLookupKeys(lookupKey: string): string[] {
  const forms = new Set<string>([lookupKey]);
  if (lookupKey.startsWith("<") && lookupKey.endsWith(">")) {
    forms.add(lookupKey.slice(1, -1)); // "<Tab>" → "Tab"
  } else if (/^[A-Z][a-zA-Z]+$/.test(lookupKey) || lookupKey === "SPC") {
    forms.add(`<${lookupKey}>`); // "Tab" → "<Tab>"
  }
  return [...forms];
}

/**
 * Resolve a complete major-mode binding for `lookupKey`. Returns the mapping
 * (precedence via resolveMapping) or undefined.
 */
function lookupMajorModeBinding(editor: Editor, lookupKey: string, majorMode: string) {
  for (const form of majorModeLookupKeys(lookupKey)) {
    const mappings = editor.getKeyMappings().get(form);
    if (mappings && mappings.length > 0) {
      const mapping = resolveMapping(mappings, "normal", majorMode);
      if (mapping) return mapping;
    }
  }
  return undefined;
}

/**
 * True if `lookupKey` is a proper prefix of any multi-key major-mode binding
 * (e.g. "]" is a prefix of "] h"). A key that is itself a complete binding is
 * not a prefix — that case is handled by the binding lookup.
 */
function isMajorModePrefix(editor: Editor, lookupKey: string, majorMode: string): boolean {
  if (lookupMajorModeBinding(editor, lookupKey, majorMode)) return false; // complete binding, not a prefix
  const candidates = majorModeLookupKeys(lookupKey);
  for (const [key, ms] of editor.getKeyMappings()) {
    if (!candidates.some(c => key.startsWith(`${c} `))) continue;
    if (ms.some(m => m.majorMode === majorMode && (m.mode === "normal" || !m.mode))) {
      return true;
    }
  }
  return false;
}

function feedDigit(editor: Editor, exec: (cmd: string) => any, key: string): void {
  const digitResult = exec(`(vim-key-digit-value "${editor.escapeKeyForTLisp(key)}")`);
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
    await editor.executeCommandAsync(tLispCmd);
  } catch (error) {
    if (error instanceof Error && error.message.includes("EDITOR_QUIT_SIGNAL")) {
      throw new Error("EDITOR_QUIT_SIGNAL");
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    editor.getModel().statusMessage = `Command error: ${errorMsg}`;
    // SPEC-055: command errors log at 'error' so they mirror into *Messages*.
    editor.logMessage(`Command error: ${errorMsg}`, 'error');
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
    const size = editor.getTerminal().getSize();
    state.whichKeyPopup = computeWhichKeyPopup(bindings, prefix, size.width, Math.max(1, size.height - 4), prefixLabel(prefix));
    state.statusMessage = `Which-key: ${bindings.map(b => `${b.key.substring(prefix.length + 1)} : ${b.command}`).join(", ")}`;
  });
}

function tLispPrefixBindings(exec: (cmd: string) => any, escape: (s: string) => string, prefix: string): WhichKeyBinding[] {
  const result = exec(`(keymap-prefix-bindings (current-keymap) "${escape(prefix)}")`);
  if (!result || result._tag !== "Right" || !result.right || result.right.type !== "list") return [];
  return (result.right.value as { value: { value: string }[] }[]).map((entry) => {
    const items = entry.value;
    return { key: items[0]!.value, command: items[1]!.value as string, mode: "normal" };
  });
}
