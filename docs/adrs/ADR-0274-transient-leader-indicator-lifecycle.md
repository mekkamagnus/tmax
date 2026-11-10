# ADR-0274: The SPC- leader indicator is transient input state, cleared when the sequence resolves

- **Status**: Accepted (verify-gate PASS round 1; landed pending CI green)
- **Date**: 2026-11-11
- **Issue**: [#247](https://github.com/mekkamagnus/tmax/issues/247)
- **Spec**: [BUG-247](../specs/BUG-247-stale-spc-prefix-status.md)

## Context

`editor-handle-space` (the bare-`SPC` key binding) announces the pending
leader with `setStatusMessage("SPC-")`. Nothing ever cleared that message on
the M-x path: entering mx mode and opening the minibuffer merely *covers* the
status area (the minibuffer occupies those rows while a session is open), and
`minibuffer-close` restores the mode without touching the status. When the
session closed, the still-`"SPC-"` message became visible again — reported as
"a leftover `SPC-` prefix indicator" needing a second Escape. Synthetic repro
showed the CLEAN exit path (`SPC ;` → immediate `Escape`) leaves it too (the
issue's clean-path control observation was imprecise), and the same
leave-behind existed for any SPC-prefixed command opening a minibuffer
(`SPC x b` → switch-buffer). The issue's restore-snapshot hypothesis was
disproven: no snapshot restore exists — the indicator is simply never
cleared.

## Decision

Treat the `"SPC-"` indicator as transient leader-key input state — the same
lifecycle class as the `spacePressed` flag, which #125 already clears when a
leader sequence resolves. Clear it at the same two places in
`normal-handler.ts` (the `currentPrefix` and `spaceActive` lookup branches),
immediately after `editor.spacePressed = false`.

Per the architecture split, the guard is editor logic in T-Lisp, not the
router: `clear-leader-indicator` in `execute-extended-command.tlisp` (the
module already owning SPC-prefix semantics via
`execute-extended-command-maybe`) clears the status iff `(editor-status)` is
exactly `"SPC-"`. The handler invokes it with the file's existing
`exec("(…)")` dispatch idiom — it reads no state the narrow
`EditorDispatchPort` doesn't expose (handlers write status; they don't read
it).

The guard matters: an async command's feedback (e.g. a save completing) can
land in the status message between the `SPC` and the resolving key; the clear
must not clobber a real message. Non-SPC prefixes (whose status is never
`"SPC-"`) are unaffected by construction.

## Consequences

- By the time the bound command runs (`execute-extended-command` opening M-x,
  `switch-buffer` opening its minibuffer), the indicator is already gone —
  correct, because the leader sequence has been consumed.
- An unbound leader key (`SPC z`) still reports `Unbound key: SPC z` — that
  message is set after the lookup fails, i.e. after the (no-op, guarded) clear.
- Bare `SPC` still shows the indicator; the indicator itself is unchanged.
- `minibuffer-close` deliberately does NOT clear status: the indicator is
  leader-input state, not minibuffer state — clearing there would be the
  wrong layer and would also wipe deliberate post-command messages.

## Verification

- `test/unit/spc-prefix-status.test.ts` (6): clean exit, the reported
  no-match path, `SPC x b` via the whichKeyPrefix branch, the guard (a real
  message set between keystrokes survives), unbound-key message intact, and
  bare-SPC indicator intact. Mutation-proven: pre-fix code fails exactly the
  3 stale-indicator tests.
- `bun run typecheck` clean; `bun run test:unit` 3,605 / 0 fail (includes the
  #195 SPC-; and #125 which-key suites).
