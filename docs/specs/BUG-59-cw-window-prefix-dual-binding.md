# Bug: `C-w` window commands have a redundant dual-binding (TS prefix handler vs T-Lisp chords) and the chord path is unreliable

## Goals

- Make `C-w <key>` window chords (`C-w s`/`C-w v`/`C-w w`/`C-w q`) dispatch reliably in the live editor and under `tmax-use` key driving.
- Remove the architectural smell: window-prefix logic currently lives in TypeScript (`editor-window-prefix` + a `windowPrefixPressed` flag), which violates the `src/editor/CLAUDE.md` rule that this directory holds **primitives only** and editor logic lives in T-Lisp.
- Keep one, authoritative mechanism for the `C-w` window prefix — not two competing ones.

## Completion Criteria (Definition of Done)

- [ ] Pressing `C-w w` in the live editor cycles to the next window (`other-window`), confirmed by a `tmax-use` keys step (not eval) — restore the keypath coverage removed from `eval-38-window-ops.yaml` once this is fixed.
- [ ] `C-w s` / `C-w v` / `C-w q` likewise dispatch split-window-below / split-window-right / delete-window via real keystrokes in a playbook.
- [ ] Either the `editor-window-prefix` raw handler (`src/editor/editor.ts:1184`) and the `windowPrefixPressed` flag are removed, OR a documented reason is recorded for why the TS-side prefix must coexist with the T-Lisp chord bindings.
- [ ] No regression: `bun run typecheck`, `bun run test:unit`, `bun run test:integration`, and `bun run test:tmax-use` all pass.

## Bug Description

The `C-w` window commands are bound **two ways at once**:

1. A **terminal** binding of the bare prefix: `src/tlisp/core/commands/windows.tlisp:24` → `(key-bind "C-w" "(editor-window-prefix)" "normal")`, whose handler in `src/editor/editor.ts:1184` sets a TypeScript-side flag `this.windowPrefixPressed = true` and emits a status message `"C-w"`.
2. **Explicit chord** bindings in `src/tlisp/core/commands/motions.tlisp:511-514`:
   - `C-w s` → `split-window-below`
   - `C-w v` → `split-window-right`
   - `C-w w` → `other-window`
   - `C-w q` → `delete-window`

Observed behavior (via `tmax-use` key driving in `eval-38-window-ops.yaml` before this bug was filed): the step `keys: "C-w w"` did **not** cycle windows. Instead the keystroke leaked — the editor ended in `--INSERT--` mode with the literal characters typed into the buffer (`-w w` visible on the screen). The `other-window` *function* itself works (the preceding eval `(other-window)` step advanced `window-current` 0→1 correctly); only the `C-w w` **keypath** is unreliable.

## Problem Statement

Two issues compound:

1. **Ambiguous key resolution.** When `C-w` is both a terminal binding (fires `editor-window-prefix` immediately) and the prefix of longer chords (`C-w s/v/w/q`), the keymap's resolution is brittle. Empirically the terminal binding wins (or the prefix flag interferes with the following key), so the chord does not reach `other-window`/`split-window-below`/etc. — the trailing key is interpreted as a fresh normal-mode key (`w` = forward-word, then further keys leak).
2. **Architecture-rule violation.** `src/editor/CLAUDE.md` is explicit: *"TypeScript here provides primitives ONLY. Editor logic lives in T-Lisp."* and *"Key binding definitions → `src/tlisp/core/bindings/*.tlisp`"* and *"Operator-pending state machines → T-Lisp command libraries"*. The `editor-window-prefix` handler implements a prefix-wait state machine in TypeScript and stashes state in a `windowPrefixPressed` field — exactly the kind of editor decision the rule says belongs in T-Lisp. The T-Lisp chord bindings in `motions.tlisp` already express the same intent correctly; the TS handler is redundant.

## Solution Statement

Pick **one** mechanism. The T-Lisp chord bindings are the rule-compliant one, so:

1. Remove the bare `C-w` → `editor-window-prefix` binding from `src/tlisp/core/commands/windows.tlisp:24` (the chords in `motions.tlisp` already cover the dispatch), **or** keep `C-w` purely as a which-key-friendly prefix hint but ensure the keymap waits for the next key instead of firing a terminal handler.
2. Remove the `editor-window-prefix` raw handler (`src/editor/editor.ts:1183-1191`) and the `windowPrefixPressed` flag once no T-Lisp code reads it (grep first).
3. Add a `tmax-use` keys-based regression (re-asserting `C-w w`/`C-w s`/`C-w q` cycle/split/delete) — the coverage removed from `eval-38` pending this fix.

If, after investigation, the chord bindings turn out to be genuinely insufficient (e.g. which-key cannot discover a bare prefix without the TS handler), document that reason in this spec and in `src/editor/CLAUDE.md` rather than leaving a silent dual-binding.

## Relevant Files

- `src/tlisp/core/commands/windows.tlisp:24` — bare `C-w` → `editor-window-prefix` binding (candidate for removal).
- `src/tlisp/core/commands/motions.tlisp:511-514` — the `C-w s/v/w/q` chord bindings (the rule-compliant mechanism).
- `src/editor/editor.ts:1183-1191` — `editor-window-prefix` raw handler + `windowPrefixPressed` flag (TS logic; candidate for removal after confirming nothing reads the flag).
- `src/editor/key-resolution.ts` — chord vs terminal-binding resolution (the brittle path; confirm it waits for a longer chord when one exists).
- `src/editor/CLAUDE.md` — the "TS primitives only, logic in T-Lisp" rule this bug violates.
- `tmax-use/playbooks/eval-38-window-ops.yaml` — currently drives window ops via eval to avoid this keypath; restore keys steps once fixed.

## Severity / Notes

- **Priority:** low (the window *commands* all work via eval/M-x; only the `C-w` *keypath* is affected, and there are alternative bindings).
- **Confidence:** medium. The chord leak was observed via `tmax-use` key driving; it should be confirmed in the live TUI editor (tmux demo / manual) before committing to the removal, in case the runner's key tokenization contributes. Either way the dual-binding + TS-logic smell is real and worth resolving.
