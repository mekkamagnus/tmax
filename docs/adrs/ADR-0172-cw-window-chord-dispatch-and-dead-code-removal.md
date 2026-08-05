# ADR-0172 — C-w window chords were correct; root cause was tmax-use tokenization + dead TS prefix code (#108 / BUG-59)

## Status

Accepted

## Context

BUG-59 reported that the `C-w` window chords (`C-w s` / `C-w v` / `C-w w` /
`C-w q`) were "unreliable": a `tmax-use` playbook step `keys: "C-w w"` leaked the
literal characters `-w w` into the buffer instead of cycling windows. Two prior
investigation attempts concluded the editor keymap had a deep defect — that
`C-w <key>` two-key lookups did not resolve the way `SPC <key>` lookups do — and
that the fix was "a focused keymap-internals session, not a quick fix."

A third investigation (spec
`docs/specs/BUG-59-cw-window-prefix-dual-binding.md`, 2026-08-06) disproved both
prior diagnoses with direct runtime probes, and this change re-verified them
independently before touching code. The verified facts:

1. **The editor dispatches the chords correctly.** Driving `editor.handleKey`
   with the real control byte — `handleKey("\x17")` (C-w) then `handleKey("s")`
   — sets `whichKeyPrefix="C-w"`, then resolves `lookupKey="C-w s"` via
   `keymap-ref` (`src/editor/handlers/normal-handler.ts:172-173,196-209,224`) and
   runs `(split-window-below)`. All four chords were re-verified end-to-end:
   `<C-w>s`→count 1→2, `<C-w>v`→count up, `<C-w>w`→current 0→1, `<C-w>q`→count
   down (`test/unit/cw-window-chords.test.ts`).

2. **The "leak" was a `tmax-use` tokenizer rule, not an editor bug.**
   `tmax-use/src/keys.ts` `parseKeys` only recognizes a Ctrl key in the
   **angle-bracket** form `<C-w>` (→ byte `\x17`). A bare `C-w` is tokenized as
   five literal characters `C - w <space> w`, each dispatched as its own
   keypress. Every other Ctrl-key playbook in the repo uses the angle-bracket
   form; `eval-38-window-ops.yaml` had not adopted it and instead drove window
   ops via `eval:` "because the keypath is unreliable" — a self-fulfilling
   misdiagnosis.

3. **The TypeScript-side window-prefix machinery was dead weight.**
   `(key-bind "C-w" "(editor-window-prefix)" "normal")` (in
   `src/tlisp/core/commands/windows.tlisp` and the fallback in
   `src/editor/runtime/binding-runtime.ts`) bound a raw handler whose only job
   was to set a `windowPrefixPressed` flag. But `C-w` is a keymap *prefix*
   (because the `C-w s/v/w/q/+/-/>/<=` chords exist), so `normal-handler.ts`
   intercepts it via the which-key prefix path **before** binding lookup — the
   `editor-window-prefix` handler never executes, and `windowPrefixPressed` is
   written once (`editor.ts`) and **never read**. This violated
   `src/editor/CLAUDE.md` ("TypeScript here provides primitives ONLY. Editor
   logic lives in T-Lisp.").

## Decision

Treat the editor/keymap as correct (no behavior change for correctly-driven
chords) and fix the two real defects: the playbook authoring gap and the dead
TS-side prefix machinery.

1. **Drive the window chords through the real keypath in
   `tmax-use/playbooks/eval-38-window-ops.yaml`.** Replace the `eval:`-only
   split/cycle/delete steps with `keys:` steps using the angle-bracket form
   (`<C-w>s`, `<C-w>w`, `<C-w>v`, `<C-w>q`), keeping the read-only
   `(window-count)`/`(window-current)`/`(window-list)` `eval:` assertions as
   oracles. Rewrite the two comment blocks that propagated the wrong root cause.
   The resize primitives stay `eval:`-driven (their coverage target is the
   primitive, not the keypath); the last-window guard stays `eval:` so its null
   return value is asserted directly.

2. **Lock the behavior with regression tests.**
   - `test/unit/cw-window-chords.test.ts` (new) drives `handleKey("\x17")` +
     trailing key and asserts `(window-count)` / `(window-current)` change for
     each chord.
   - `test/unit/tmax-use/keys.test.ts` gains two contract assertions:
     `compileHeadless("<C-w>s")` === `["\x17","s"]` (correct) and
     `compileHeadless("C-w s")` === `["C","-","w"," ","s"]` (the leak) — so a
     future bare-form playbook step fails with a clear diff.

3. **Remove the dead TS-side window-prefix machinery.** Delete the
   `editor-window-prefix` raw handler, the `windowPrefixPressed` field
   (`src/editor/editor.ts`), and the redundant bare-`C-w` binding (from
   `src/tlisp/core/commands/windows.tlisp` and the fallback in
   `src/editor/runtime/binding-runtime.ts`). `C-w` remains a which-key prefix
   purely because the chord bindings exist; `windows.tlisp` now carries a
   comment documenting that `C-w` is prefix-only by design. Grep confirms no
   remaining references to `editor-window-prefix` or `windowPrefixPressed`.

The `editor-window-prefix` primitive was a `defineRaw` (registered on the
editor's interpreter), **not** part of `createEditorAPI`'s contributed key set,
so its removal does not change the CHORE-44 baseline inventory (the asserted
`api-names-static.txt` / 366-name count is unaffected; the unread
`api-names-current.txt` snapshot is not asserted by any test).

## Consequences

- The `C-w` window chords are now covered by the real keypath in e2e
  (`eval-38`) and locked by a unit test, so the "is the chord reliable?"
  question never needs re-investigation — the bisect trail lives in the spec.
- The `src/editor/CLAUDE.md` architecture smell (a TS prefix-wait state machine
  + a dead flag) is resolved; the T-Lisp chord bindings are the single
  authoritative `C-w` mechanism.
- No observable behavior change for any client that sends the `\x17` control
  byte (the daemon, the TUI, a correctly-authored playbook). A client that
  sends literal `C-w` text was never going to dispatch a chord regardless.
- `defineRaw` primitives remain outside `createEditorAPI`'s contributed
  inventory, so future removals of standalone raw handlers do not churn the
  CHORE-44 baseline (only contributions added via `registerContributions` do).
