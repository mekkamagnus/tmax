# Non-invasive git checkpoints for Fikra turns

## Status

Accepted (2026-08-22, #217 / [SPEC-217](../specs/SPEC-217-fikra-checkpoints.md))

## Context

RFC-027's accountability layer: every AI turn gets a revertible checkpoint
WITHOUT touching the user's index, HEAD, or working tree — the exact failure
mode that made RFC-013's original `git add -A && git commit` design
unacceptable.

## Decision

Checkpoints are commit objects built on a FRESH temporary index (the
RFC-027 D6 contract): `GIT_INDEX_FILE=<tmp> git add -A` → `write-tree` →
`commit-tree -p HEAD` → `update-ref refs/fikra/<thread>/<n>[-baseline]`.
A fresh index makes the tree exactly the disk state (deletions by
absence); `update-ref` is the atomic commit point; the temp index is
removed; failures are parseable (`|| echo CAPTURE-FAILED`) so the sync
path emits checkpoint-error instead of throwing. The non-invariance
guarantee is pinned by comparing the user index's full `write-tree` hash
before/after capture with a deliberately dirtied index. The disable cache
is keyed PER ROOT (a non-git probe can never poison a git-rooted thread —
pinned within one interpreter). Async captures are processes whose kinds
are PID-keyed (no global race); the sentinel ignores exit-code (the
failure marker neutralized it — correctness rests on the REF: parse).

## Consequences

- #218 builds diff/revert on these refs; per-thread capture chaining is
  its scope.
- Checkpoints are snapshots-of-disk (parent = HEAD, not the previous
  checkpoint) — turn diffs are always `<n>-baseline..<n>`.
- Gitignored files are not captured (documented limitation); unborn-HEAD
  and non-git roots disable checkpointing cleanly.
- The gate's 5-round ledger (sticky cache, sync-failure throw, unqualified
  callbacks, payload drift, test strength) is in the spec — the discipline
  caught two would-be production bugs (poisoned cache, silent async
  failure) that fixture-only testing missed.
