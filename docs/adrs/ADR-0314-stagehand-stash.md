# ADR-0314 — #292: the stash popup

- **Status**: Accepted
- **Date**: 2026-11-23
- **Issue**: #292
- **Spec**: SPEC-288

## Context

Stagehand T1 needs stash list/create/apply/pop/drop. Two prior
lessons shaped the design before a line was written: #291's
cursor-seam family (wrong-target mutations, stale confirms,
view-lifetime races) and the porcelain parsing contract (structural
field separation, never text parsing).

## Decision

- **The list** rides `git stash list --format=%gd<US>%H<US>%gs`
  (argv, no shell): ref + commit ID + subject, unit-separated. The
  subject splits on the first two field separators and keeps the
  remainder verbatim (the join interleaves BETWEEN parts — a
  trailing glue corrupted subjects ending in a separator).
- **Identity is commit-ID anchored end-to-end**: the render records
  (ref id) per row; every action re-resolves at the CONFIRM and
  AGAIN at the mutation point (the async y/n window can shift the
  list — the gate destroyed a never-confirmed stash through this
  window before the fix). Gone OR shifted-present refs refuse with
  `stash list changed — reselect` + re-render.
- **Row targeting is by displayed line**: ONE header line precedes
  the rows; the tests place cursors by each ref's ACTUAL rendered
  line — never a guessed offset (the gate's r1: the tests encoding
  the implementation's own off-by-one constant made 15/15 green
  uninformative while D+y acted on the row ABOVE the cursor).
- **Creation is a magit-style armed prefix**: z arms; z u / z k
  toggle (header shows the pending state, resets on open, the
  prefix stays armed); z z creates + closes. A clean tree's exit-0
  "No local changes" (on STDOUT) reports `nothing to stash`.

## Consequences

- The stale-confirm and identity machinery generalizes to every
  future Stagehand mutating view: record the identity at selection,
  revalidate at the mutation point.
- Residual (gate-accepted): the resolve→fire TOCTOU is narrowed to
  milliseconds but unclosable without index locking; the create
  status trusts a post-push rev-parse (status-only race).
