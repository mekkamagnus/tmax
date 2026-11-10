# Bug: stale `SPC-` leader indicator survives an M-x session (visible after the minibuffer closes)

## Bug Description

`SPC ;` → M-x opens → Escape: the mode line correctly returns to `--NORMAL--`
but the status/minibuffer area shows a leftover `SPC-` prefix indicator. A
second Escape clears it. Originally reported on the *failed-execution* path
(filter with no match → `Enter` → `No match` → `Escape`), but synthetic repro
shows the CLEAN exit path (`SPC ;` → immediate `Escape`) leaves it as well —
the issue's clean-path control observation was imprecise; the bug is uniform.

## Problem Statement

`editor-handle-space` (`src/editor/api/mode-ops.ts:179`) sets the transient
leader indicator with `setStatusMessage("SPC-")`. Nothing on the M-x path ever
clears it: entering mx mode and opening the minibuffer merely *covers* the
status area (the minibuffer occupies those rows while open). When
`minibuffer-close` restores normal mode, the still-`"SPC-"` status message
becomes visible again. Only the normal-mode Escape/C-g branch
(`normal-handler.ts`) clears the status.

Synthetic repro (real editor, sequential `handleKey`, on `main` @ `a2352bf`):

```
after SPC            mode=normal status="SPC-"
after ; (M-x)        mode=mx     status="SPC-"
after filter         mode=mx     status="SPC-"   (minibuffer covers it)
after Enter          mode=mx     status="SPC-"
after Escape         mode=normal status="SPC-"   ← stale indicator visible
after 2nd Escape     mode=normal status=""
```

The same leave-behind exists for any SPC-prefixed command that opens a
minibuffer (`SPC x b` → switch-buffer) or that leaves status untouched.

## Solution Statement

The `"SPC-"` indicator is transient leader-key input state — the same class
of artifact as the `spacePressed` flag, which the #125 fix already clears when
the sequence resolves (`normal-handler.ts`, the `currentPrefix` and
`spaceActive` lookup branches). Clear it in the same two branches, at the same
place the flag is cleared.

Per the architecture split (the handler is a thin router; the guard is editor
logic), the clearing logic lives in T-Lisp — `clear-leader-indicator` in
`execute-extended-command.tlisp` (the module that already owns SPC-prefix
semantics): it clears the status iff `(editor-status)` is exactly `"SPC-"`, so
a real status message set in the meantime must win (e.g. an async command's
feedback landing between keystrokes), and non-SPC prefixes (whose status is
never `"SPC-"`) are unaffected. The handler calls it via the file's existing
`exec` dispatch idiom.

Consequences: by the time the bound command runs (e.g.
`execute-extended-command` opening M-x), the indicator is already gone —
correct, because the leader sequence has been consumed; and an unbound
`SPC z` still reports `Unbound key: SPC z` (set after the lookup fails).

## Steps to Reproduce

Synthetic: `createStartedEditor("")` → `handleKey(" ")` → `handleKey(";")` →
`handleKey("Escape")` → `getEditorState().statusMessage === "SPC-"` (bug).
Live: `SPC ;` then `Escape` in any frontend.

## Completion Criteria

- [ ] `SPC ;` → immediate `Escape`: `statusMessage` is NOT `"SPC-"` after the
      Escape (it must be `""`).
- [ ] The reported path — `SPC ;` → no-match filter → `Enter` → `Escape`:
      `statusMessage` is NOT `"SPC-"` (minibuffer closed, mode normal).
- [ ] `SPC x b` (switch-buffer minibuffer via the whichKeyPrefix branch) →
      `Escape`: no stale `"SPC-"`.
- [ ] Guard: a status message that is NOT the bare indicator is never
      clobbered (e.g. set a real message, press `SPC ;`, Escape → the real
      message survives the clearing hooks).
- [ ] Bare `SPC` indicator still shows (`statusMessage === "SPC-"` right
      after pressing SPC — the indicator itself is unchanged).
- [ ] Unbound leader key (`SPC z`) still reports `Unbound key: SPC z`.
- [ ] New tests red before the fix, green after (mutation-proven).
- [ ] `bun run typecheck` clean; `bun run test:unit` green.

## Relevant Files

- `src/editor/handlers/normal-handler.ts` — the two sequence-resolution
  branches (fix site)
- `test/unit/spc-prefix-status.test.ts` — new regression suite

## Notes

- The fix deliberately does NOT live in `completing-read`/`minibuffer-close`:
  the indicator is leader-input state, not minibuffer state — it would also
  survive non-minibuffer SPC commands. Clearing where the sequence resolves
  (mirroring #125's `spacePressed` clearing) is the root fix.
- The issue's restore-snapshot hypothesis was disproven by repro: no snapshot
  restore exists; the indicator is simply never cleared.

Status: implemented pending gate (verify-gate + CI) — land only with typecheck
clean, unit suite green, verify-gate PASS.
