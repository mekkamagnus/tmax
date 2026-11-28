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
 * 4. Major-mode binding for the exact key → execute command (#368). Runs
 *    before the keymap so a mode can bind a key that vim also uses, and a
 *    mode binding of a key shadows a global prefix on the same key.
 * 5. Keymap prefix (g/z/C-w/SPC/...) → schedule which-key, set prefix.
 * 6. Major-mode prefix ("]" of "] h") → set prefix.
 * 7. Keymap binding → execute command.
 * 8. Else → "Unbound key".
 *
 * Keys consumed BEFORE any lookup (a major mode cannot bind them):
 * macro record/play pending, register prefix pending, replace-char pending,
 * Escape / C-g, find / mark / text-object / operator pending, the `q` that
 * stops a running recording, digits 1-9 (and 0 inside a count).
 *
 * Operator-g sub-state (for `dgg`) is tracked inside the operator state
 * machine via `vim-operator-g-pending`.
 *
 * TypeScript only handles dispatch routing and timer scheduling.
 * All bindings, state machines, and logic live in T-Lisp.
 */

import type { EditorDispatchPort } from "./editor-dispatch-port.ts";
import { resolveMapping } from "../key-resolution.ts";
import { isTruthy } from "../../tlisp/values.ts";
import type { WhichKeyBinding } from "../../core/contracts/editor.ts";
import { computeWhichKeyPopup } from "../../frontend/render/which-key-overlay.ts";

const DIGIT_KEYS = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/** The start of the status line the which-key popup writes while it shows. */
const WHICH_KEY_STATUS_PREFIX = "Which-key: ";

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

export async function handleNormalMode(editor: EditorDispatchPort, key: string, normalizedKey: string): Promise<void> {
  const state = editor.getModel();
  const wk = editor.getWhichKeyHandle();
  const interp = editor.getInterpreter();
  const exec = (cmd: string): any => interp.execute(cmd);
  const escape = (s: string) => editor.escapeKeyForTLisp(s);
  const isRight = (r: any) => r && typeof r === "object" && r._tag === "Right";

  const spaceActive = editor.spacePressed === true;
  const currentPrefix = state.whichKeyPrefix || "";

  // BUG-76: Clear splash screen on first keystroke in normal mode (like vim).
  // The logic lives in T-Lisp (buffers.tlisp::clear-splash-if-present) — the
  // handler is a thin router (no buffer mutation inline).
  exec("(clear-splash-if-present)");

  // SPEC-044 Phase 1.F-1.H — macro pending states must be routed BEFORE the
  // generic Escape/C-g handler. q<Escape> is a quit command per spec MUST,
  // resolved by macro-dispatch-record calling editor-quit; if the generic
  // Escape branch ran first it would silently cancel the pending state and
  // swallow the quit. The dispatcher also handles @<Escape> as cancel.
  const macroRecordPending = isTruthyResult(exec("(macro-record-pending-p)"));
  if (macroRecordPending) {
    await executeCommand(editor, `(macro-dispatch-record "${escape(normalizedKey)}")`);
    clearWhichKey(editor, wk);
    return;
  }
  const macroPlayPending = isTruthyResult(exec("(macro-play-pending-p)"));
  if (macroPlayPending) {
    await executeCommand(editor, `(macro-dispatch-play "${escape(normalizedKey)}")`);
    clearWhichKey(editor, wk);
    return;
  }

  // SPEC-044 Phase 2.G — " register-prefix pending. Routed before Escape
  // so the dispatcher can interpret Escape/C-g as cancel; keymap and digit
  // branches would otherwise shadow the register letter (e.g. "a is a
  // valid register but also a binding).
  const registerPrefixPending = isTruthyResult(exec("(vim-register-prefix-pending-p)"));
  if (registerPrefixPending) {
    await executeCommand(editor, `(vim-dispatch-register "${escape(normalizedKey)}")`);
    clearWhichKey(editor, wk);
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
    clearWhichKey(editor, wk);
    return;
  }

  // C-g / Escape cancels any pending state and which-key. Recording itself
  // is NOT cancelled — only the stopping q ends a recording (vim semantics).
  // macro-record-pending was already handled above, so reaching here means
  // we are either idle or actively recording.
  if (normalizedKey === "C-g" || normalizedKey === "Escape") {
    // A BUFFER-LOCAL C-g binding wins over the generic cancel (#206's
    // normative chain: buffer-local is the innermost tier — the fikra
    // chat binds C-g to gate-abort/turn-interrupt). Escape keeps its
    // global meaning everywhere; only C-g is overridable.
    if (normalizedKey === "C-g") {
      const localCg = exec(`(keymap-ref (buffer-keymap (buffer-name)) "C-g")`);
      if (isRight(localCg) && localCg.right && (localCg.right as { type?: string }).type === "string") {
        clearWhichKey(editor, wk);
        await executeCommand(editor, (localCg.right as { value: string }).value);
        return;
      }
    }
    wk?.deactivate();
    editor.applyUpdate({ type: "SetWhichKeyActive", active: false });
    editor.applyUpdate({ type: "SetWhichKeyPrefix", prefix: "" });
    editor.applyUpdate({ type: "SetWhichKeyBindings", bindings: [] });
    editor.applyUpdate({ type: "SetWhichKeyPopup", popup: null });
    editor.applyUpdate({ type: "SetStatusMessage", message: "" });
    editor.spacePressed = false;
    try { exec("(vim-reset-pending)"); } catch {}
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
    clearWhichKey(editor, wk);
    return;
  }
  const markPending = isTruthyResult(exec("(vim-mark-pending-p)"));
  if (markPending) {
    const macroRecordingInit = isTruthyResult(exec("(macro-record-active)"));
    if (macroRecordingInit) {
      try { exec(`(macro-record-key "${escape(normalizedKey)}")`); } catch {}
    }
    await executeCommand(editor, `(vim-dispatch-mark "${escape(normalizedKey)}")`);
    clearWhichKey(editor, wk);
    return;
  }
  const textObjectPending = isTruthyResult(exec("(vim-text-object-pending-p)"));
  if (textObjectPending) {
    const macroRecordingInit = isTruthyResult(exec("(macro-record-active)"));
    if (macroRecordingInit) {
      try { exec(`(macro-record-key "${escape(normalizedKey)}")`); } catch {}
    }
    await executeCommand(editor, `(vim-dispatch-text-object "${escape(normalizedKey)}")`);
    clearWhichKey(editor, wk);
    return;
  }
  const operatorPending = isTruthyResult(exec("(vim-operator-pending-p)"));
  if (operatorPending) {
    const macroRecordingInit = isTruthyResult(exec("(macro-record-active)"));
    if (macroRecordingInit) {
      try { exec(`(macro-record-key "${escape(normalizedKey)}")`); } catch {}
    }
    await executeCommand(editor, `(vim-dispatch-operator-key "${escape(normalizedKey)}")`);
    clearWhichKey(editor, wk);
    return;
  }

  // If recording is active and the user pressed q, route directly to stop so
  // the stopping q is NOT captured by the recording hook below (vim records
  // literal keys but not the q that ends the recording).
  const macroRecording = isTruthyResult(exec("(macro-record-active)"));
  if (macroRecording && normalizedKey === "q") {
    await executeCommand(editor, `(macro-record-stop)`);
    clearWhichKey(editor, wk);
    return;
  }

  // Build lookup key from current prefix context
  let lookupKey: string;
  if (currentPrefix) {
    lookupKey = `${currentPrefix} ${normalizedKey}`;
    // The SPC leader (spacePressed) is now tracked by whichKeyPrefix; clear the
    // transient flag so a completed SPC sequence does not re-trigger the SPC
    // popup via the post-command schedulePrefixPopup below (#125: stale popup
    // after completion). The legitimate bare-SPC path is unaffected: a command
    // that freshly sets spacePressed runs before whichKeyPrefix is set this
    // press, so the post-command check still sees it.
    editor.spacePressed = false;
    // #247: clear the transient "SPC-" status indicator with the leader
    // state — logic in T-Lisp (clear-leader-indicator guards to the bare
    // indicator so real status messages win).
    exec("(clear-leader-indicator)");
  } else if (spaceActive) {
    lookupKey = `SPC ${normalizedKey}`;
    editor.spacePressed = false;
    exec("(clear-leader-indicator)");
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

  // Major-mode binding for the EXACT key (#368). info, help, helpgrep and
  // man bind keys that vim also uses (n, i, q, Enter, ...); read after the
  // keymap they never ran. Only a binding the major mode ITSELF declares
  // counts (a table row with no major mode is the global binding below).
  const majorMode = editor.getCurrentMajorMode();
  if (majorMode && majorMode !== "fundamental") {
    const own = lookupMajorModeOwnBinding(editor, lookupKey, majorMode);
    if (own) {
      clearWhichKey(editor, wk);
      // Recorded like any other bound key (vim records literal keys); a mode
      // binding is excluded from a macro no longer than a global one.
      if (macroRecording) {
        try { exec(`(macro-record-key "${escape(normalizedKey)}")`); } catch {}
      }
      await executeCommand(editor, own.command);
      // A count typed before the key (`3` `n`) is discarded once the command
      // of the mode has run. No command of a mode reads the count; left
      // behind, it reached the next edit in the buffer the user went back
      // to (grading round 2: `3 n q x` deleted three characters). The rule
      // is in T-Lisp: it clears a message only when that is the count line.
      try { exec("(vim-count-discard)"); } catch {}
      return;
    }
  }

  // Keymap prefix check → schedule which-key, set prefix
  const prefixResult = exec(`(keymap-prefix-p (current-keymap) "${escape(lookupKey)}")`);
  if (isRight(prefixResult) && isTruthy(prefixResult.right)) {
    const bindings = tLispPrefixBindings(exec, escape, lookupKey);
    editor.applyUpdate({ type: "SetWhichKeyPrefix", prefix: lookupKey });
    editor.applyUpdate({ type: "SetWhichKeyBindings", bindings });
    wk?.schedule(lookupKey, bindings, () => {
      if (editor.getModel().whichKeyPrefix !== lookupKey) return;
      const size = editor.getTerminal().getSize();
      editor.applyUpdate({ type: "SetWhichKeyActive", active: true });
      editor.applyUpdate({ type: "SetWhichKeyPopup", popup: computeWhichKeyPopup(bindings, lookupKey, size.width, Math.max(1, size.height - 4), prefixLabel(lookupKey)) });
      editor.applyUpdate({ type: "SetStatusMessage", message: whichKeyStatus(bindings, lookupKey) });
    });
    return;
  }

  // Major-mode prefix check: if lookupKey is the start of a major-mode
  // multi-key binding (e.g. "]" is a prefix of "] h"), set the prefix and
  // wait for the next key. Major-mode bindings are not in the T-Lisp keymap,
  // so they need their own prefix detection here.
  if (majorMode && majorMode !== "fundamental" && isMajorModePrefix(editor, lookupKey, majorMode)) {
    // The first key of a mode sequence is recorded here, the last one when
    // its binding runs (above), so `] h` replays as `] h`.
    if (macroRecording) {
      try { exec(`(macro-record-key "${escape(normalizedKey)}")`); } catch {}
    }
    editor.applyUpdate({ type: "SetWhichKeyPrefix", prefix: lookupKey });
    editor.applyUpdate({ type: "SetWhichKeyBindings", bindings: [] });
    editor.applyUpdate({ type: "SetStatusMessage", message: "" });
    return;
  }

  // Keymap binding lookup → execute command
  const cmdResult = exec(`(keymap-ref (current-keymap) "${escape(lookupKey)}")`);
  const cmdRight = isRight(cmdResult) ? cmdResult.right : null;
  if (cmdRight && cmdRight.type === "string") {
    clearWhichKey(editor, wk);
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
      schedulePrefixPopup(editor, wk, exec, escape, "SPC");
    }
    return;
  }

  // Fallback for a keyMappings row the T-Lisp keymap above does not hold
  // (a binding whose keymap entry is missing or was rebound, so the keymap
  // lookup missed it). A major-mode binding for the exact key already ran
  // above (#368), so what is left here is the wider table precedence:
  // mode+majorMode > mode > majorMode > global (see resolveMapping).
  if (majorMode && majorMode !== "fundamental") {
    const mapping = lookupMajorModeBinding(editor, lookupKey, majorMode);
    if (mapping) {
      clearWhichKey(editor, wk);
      await executeCommand(editor, mapping.command);
      // Same rule as the mode binding above (grading round 2).
      try { exec("(vim-count-discard)"); } catch {}
      return;
    }
  }

  // No prefix, no binding — report unbound. If we were in a prefix context,
  // clear which-key state so the abandoned prefix doesn't linger.
  if (currentPrefix || spaceActive) {
    clearWhichKey(editor, wk);
    editor.spacePressed = false;
  }
  editor.applyUpdate({ type: "SetStatusMessage", message: `Unbound key: ${lookupKey}` });
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
 * The binding the major mode ITSELF declares for `lookupKey` (a row whose
 * majorMode is `majorMode`, in the normal mode or in no editor mode).
 * Returns the mapping, or undefined when the mode does not bind this key.
 */
function lookupMajorModeOwnBinding(editor: EditorDispatchPort, lookupKey: string, majorMode: string) {
  for (const form of majorModeLookupKeys(lookupKey)) {
    const mappings = editor.getKeyMappings().get(form);
    const own = mappings?.find(m => m.majorMode === majorMode && (m.mode === "normal" || !m.mode));
    if (own) return own;
  }
  return undefined;
}

/**
 * Resolve a complete major-mode binding for `lookupKey`. Returns the mapping
 * (precedence via resolveMapping) or undefined.
 */
function lookupMajorModeBinding(editor: EditorDispatchPort, lookupKey: string, majorMode: string) {
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
function isMajorModePrefix(editor: EditorDispatchPort, lookupKey: string, majorMode: string): boolean {
  // #157 gap 6: a key is a "complete major-mode binding" (not a prefix) only if
  // the major mode defines it SPECIFICALLY. A global/mode-only binding (e.g. ","
  // = vim-repeat-find-reverse) must NOT exclude the key from acting as a
  // major-mode prefix — otherwise it shadows the whole major-mode leader (the
  // comma-prefixed bindings never dispatched). lookupMajorModeBinding falls through to
  // global via resolveMapping, so it cannot be used for this check.
  const candidates = majorModeLookupKeys(lookupKey);
  const hasMajorModeSpecific = candidates.some(form => {
    const ms = editor.getKeyMappings().get(form);
    return !!ms && ms.some(m => m.majorMode === majorMode);
  });
  if (hasMajorModeSpecific) return false; // major mode defines this exact key → complete binding
  for (const [key, ms] of editor.getKeyMappings()) {
    if (!candidates.some(c => key.startsWith(`${c} `))) continue;
    if (ms.some(m => m.majorMode === majorMode && (m.mode === "normal" || !m.mode))) {
      return true;
    }
  }
  return false;
}

function feedDigit(editor: EditorDispatchPort, exec: (cmd: string) => any, key: string): void {
  const digitResult = exec(`(vim-key-digit-value "${editor.escapeKeyForTLisp(key)}")`);
  if (digitResult && digitResult._tag === "Right" && digitResult.right?.type === "number") {
    exec(`(vim-count-add-digit ${digitResult.right.value})`);
  }
}

function clearWhichKey(editor: EditorDispatchPort, wk: any): void {
  wk?.deactivate();
  editor.applyUpdate({ type: "SetWhichKeyActive", active: false });
  editor.applyUpdate({ type: "SetWhichKeyPrefix", prefix: "" });
  editor.applyUpdate({ type: "SetWhichKeyBindings", bindings: [] });
  editor.applyUpdate({ type: "SetWhichKeyPopup", popup: null });
  // #372: while the popup showed, its callback put the candidate list on
  // the status line. A sequence that is completed takes the popup off, and
  // must take that line off too — a command that sets no message of its
  // own (dired) otherwise left "Which-key: ..." as its status. A message
  // that is not the which-key line (the command's own, or a real one that
  // landed meanwhile) is kept.
  if ((editor.getModel().statusMessage ?? "").startsWith(WHICH_KEY_STATUS_PREFIX)) {
    editor.applyUpdate({ type: "SetStatusMessage", message: "" });
  }
}

async function executeCommand(editor: EditorDispatchPort, tLispCmd: string): Promise<void> {
  try {
    await editor.executeCommandAsync(tLispCmd);
  } catch (error) {
    if (error instanceof Error && error.message.includes("EDITOR_QUIT_SIGNAL")) {
      throw new Error("EDITOR_QUIT_SIGNAL");
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    editor.applyUpdate({ type: "SetStatusMessage", message: `Command error: ${errorMsg}` });
    // SPEC-055: command errors log at 'error' so they mirror into *Messages*.
    editor.logMessage(`Command error: ${errorMsg}`, 'error');
  }
}

function schedulePrefixPopup(
  editor: EditorDispatchPort, wk: any,
  exec: (cmd: string) => any, escape: (s: string) => string, prefix: string
): void {
  const bindings = tLispPrefixBindings(exec, escape, prefix);
  if (bindings.length === 0) return;
  editor.applyUpdate({ type: "SetWhichKeyPrefix", prefix });
  editor.applyUpdate({ type: "SetWhichKeyBindings", bindings });
  wk?.schedule(prefix, bindings, () => {
    if (editor.getModel().whichKeyPrefix !== prefix) return;
    const size = editor.getTerminal().getSize();
    editor.applyUpdate({ type: "SetWhichKeyActive", active: true });
    editor.applyUpdate({ type: "SetWhichKeyPopup", popup: computeWhichKeyPopup(bindings, prefix, size.width, Math.max(1, size.height - 4), prefixLabel(prefix)) });
    editor.applyUpdate({ type: "SetStatusMessage", message: whichKeyStatus(bindings, prefix) });
  });
}

/** The one-line candidate list that replaces the status line while the popup shows. */
function whichKeyStatus(bindings: WhichKeyBinding[], prefix: string): string {
  return WHICH_KEY_STATUS_PREFIX + bindings.map(b => `${b.key.substring(prefix.length + 1)} : ${b.command}`).join(", ");
}

function tLispPrefixBindings(exec: (cmd: string) => any, escape: (s: string) => string, prefix: string): WhichKeyBinding[] {
  const result = exec(`(keymap-prefix-bindings (current-keymap) "${escape(prefix)}")`);
  if (!result || result._tag !== "Right" || !result.right || result.right.type !== "list") return [];
  return (result.right.value as { value: { value: string }[] }[]).map((entry) => {
    const items = entry.value;
    return { key: items[0]!.value, command: items[1]!.value as string, mode: "normal" };
  });
}
