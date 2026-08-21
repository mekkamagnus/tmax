# Tree-diff-inverse revert for Fikra

## Status

Accepted (2026-08-22, #218 / [SPEC-218](../specs/SPEC-218-fikra-diff-revert.md))

## Context

`git restore --source` alone silently leaves files CREATED after the target
— a revert that claims to undo a turn but doesn't. And checkpoints that
sweep thread state (.tmax/) would let reverting a turn revert the event
log itself.

## Decision

Revert is the INVERSE of the tree diff (target→completion) per the 2×2
presence matrix (in-target→restore; created-by-turn→delete; not-a-diff-entry
→ untouched — untracked and gitignored files are structurally excluded).
EVERY destructive action — restore AND delete — passes the content-
divergence guard: a path whose disk state diverges from the completion ref
(the user touched it post-turn) aborts THAT path and its current content is
stashed as a re-appliable creation patch (`git diff --binary --no-index
/dev/null <path>` — the only form that works for untracked A-entries).
The event log is append-only forever; revert appends a checkpoint-reverted
tombstone that FAEP replay reads as a turn-range invalidation (turn fields
as bare numbers or full ref names). Test fixtures MUST gitignore `.tmax/`.

## Consequences

- Revert-any-turn is safe: refs live for the thread's lifetime (#217's
  retention rule); post-revert turns keep rendering.
- One uniform stash form (creation patch) instead of per-case diff forms —
  slightly larger patches for M-entries, always content-preserving.
- The gate caught the unguarded delete (a user-recreated file would have
  been silently destroyed) and the untracked-blind stash form — both
  fixed with pinning tests.
- Interactive *Fikra-Diff* buffer and close-time diff export are #219+.
