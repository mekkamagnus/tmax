# SPEC-288 — Stagehand stash popup (#292)

## Goal

Stagehand T1: the stash popup — list / create / apply / pop / drop,
built on the #286 buffer pattern, the #287 y/n confirm, and the
#291 argv/stderr lessons.

## Design

- **The list** (`Z` in the status buffer → `*Stagehand-Stash*`):
  `git stash list --format=%gd%x1f%H%x1f%gs` (argv, no shell) —
  ref + commit ID + subject, unit-separated (the porcelain
  contract, never text parsing of the subject). Rows render
  `stash@{N}  <subject>`; the subject splits on the FIRST unit
  separator and keeps the remainder VERBATIM (any characters).
- **Empty list** → the buffer opens with `no stashes`; every action
  no-ops with a status.
- **Selection identity** (commit-ID anchored): the render records
  each row's `(ref id)`; an action re-resolves the row's ref
  (`git rev-parse`) — gone OR a different ID (a shifted ref) →
  `stash list changed — reselect` + re-render, nothing mutated.
  No row at point → `no stash selected`.
- **Creation** (the `z` prefix, in the popup): `z u` toggles
  include-untracked, `z k` toggles keep-index (the header shows the
  pending `[u]ntracked [k]eep-index` state; toggles reset on open);
  `z z` creates (`git stash push [-u] [-k]`) and closes the popup;
  `q` closes without creating. Never confirms: `No local changes`
  → `nothing to stash`, popup closes; success shows the new ref.
- **Actions** on the selected row: `a` apply / `p` pop behind the
  async n-FIRST y/n (bare Enter/C-g cancel — tested for drop);
  `D` confirms with the stash ref echoed. Exit ≠ 0 on apply/pop →
  status names exit + first stderr line + `resolve in the worktree`
  (a conflicted pop does NOT drop the stash — git's semantics
  surfaced). Success → the stash list re-renders + the status
  buffer refreshes (#286 contract).

## Completion criteria

- [ ] Temp-repo tests per mutation: create (each flag +
      combination), apply, pop (clean + conflicted — the stash
      retained), drop, cancelled drop
- [ ] Empty-list rendering + no-op actions; no-selection refusal;
      unusual-message parsing (embedded separators, unicode — the
      subject verbatim after the first separator)
- [ ] Identity revalidation: a dropped stash@{0} shifts the refs —
      an action on the stale row refuses with `stash list changed —
      reselect` and re-renders
- [ ] Creation edge: `nothing to stash` (popup closes, no ref
      shown); the toggle state resets on reopen
