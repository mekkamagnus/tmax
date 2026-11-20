# ADR-0301 — #305: new-file grammar + baseline-membership restore

- **Status**: Accepted
- **Date**: 2026-11-21
- **Issue**: #305
- **Spec**: SPEC-275

## Context

Untracked files rendered as full-content blobs; the revert `r` rm'd ANY
untracked file in the restored set — including files that predated the
turn (file-kind consults the index, which cannot distinguish
turn-created from turn-preexisting untracked).

## Decision

Untracked rendering goes through git's own `--no-index -- /dev/null`
form — real new-file grammar, git's empty/binary/quoting edges for
free, odd names safe by argv construction. The restore keeps the
viewer's own implementation (chosen over the checkpoint/revert
machinery: it already satisfies the dirty-file semantics once the
untracked branch consults the turn-begin BASELINE SIGNATURE — in it →
preexisting, untouched; absent → turn-created, removed). Tracked-dirty
restores from the baseline TREE (byte-exact pre-turn content, not
HEAD).

## Consequences

- The restore's untracked branch now reads the thread's baseline
  signature map (a thread field captured at turn-begin) — one source
  of truth with the ± change detection.
- git quote-escapes non-ASCII paths in --no-index output — correct
  output, asserted as such.
