# SPEC-226: BUG-83 — M-x accepted commands execute; failures surface

**Issue:** #226 (bug)
**Status:** Implemented 2026-08-22

## Goal

`M-x <command> Enter` actually runs the command: the quit signal
propagates, other commands' effects are observable, and failures surface
on the status line + *Messages* instead of vanishing.

## Root cause

`Editor.executeCommandAsync` re-evaluated EVERY failed command in the
head symbol's module env — including already-parenthesized FORMS. For the
M-x Enter path: the first eval ran the whole accept chain
(`minibuffer-close` + the accept fn → `invoke-command` → the command —
whose EDITOR_QUIT_SIGNAL or error came back as a Left), then the RETRY
re-ran `(minibuffer-dispatch-key "Enter")` against the now-CLEARED
session, returned a harmless nil Right, and the original failure was
dropped with no status, no log. The retry exists for BARE command names
(executeAsync evaluates in the global env; a module-scoped symbol needs
its own env) — applying it to forms was the bug.

## Fix

- The module-env retry now fires only for bare (non-parenthesized)
  command names; a failed retry surfaces through the shared error path.
- Failures surface via the extracted `reportCommandError` (diagnostic
  aware: status line + *Messages*) for both the direct and retry paths.
- The retry test pinned the OLD swallow behavior
  (`macro-handler.test.ts`'s `q<Escape>` case awaited handleKey without
  expecting the signal) — updated to assert the propagated
  EDITOR_QUIT_SIGNAL.

## Completion Criteria

- [x] `M-x editor-quit Enter` exits the LIVE editor — verified in tmux:
      the pane dies (with BUG-81's `;`-injection gotcha worked around:
      load-buffer + paste-buffer).
- [x] `M-x switch… Tab Enter` opens the follow-up "Switch to buffer:"
      minibuffer — verified live (1/6 candidates).
- [x] Errors from commands surface in the status line AND *Messages*
      (pinned).
- [x] Unit regression: accepted-command execution observable (a test
      command's status effect), quit signal propagates from handleKey
      (pinned).
- [x] The bare-name module-env retry still resolves module-scoped
      commands (pinned: `minibuffer-accept`); unknown names surface their
      error (pinned).
- [x] typecheck:src + :test green; mx/minibuffer/keymap/macro suites
      green (mx-accept 4/4; minibuffer+mx caches 22/22; key-handling
      58/58; macros+which-key 115/115 after the one pinned-swallow
      update).

## Notes

- The live `;` injection gotcha (tmux send-keys eats standalone `;`) is
  BUG-81/#195 lore — M-x live checks MUST use load-buffer/paste-buffer.
