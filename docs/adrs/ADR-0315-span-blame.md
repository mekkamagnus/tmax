# ADR-0315 — #296: the span/overlay API + blame mode

- **Status**: Accepted
- **Date**: 2026-11-23
- **Issue**: #296
- **Spec**: SPEC-289

## Context

Stagehand T2 needs blame; blame needs a persistent display-only
face layer. Delivered as one issue, two separately-tested halves.

## Decision

- **The API half** (`span-make` / `span-remove`): a per-editor
  registry in the ops closure (the flash-ops precedent, minus the
  TTL); the merged per-line grid publishes through SetBufferSpans to
  EditorState.bufferSpans and merges into captureFrame's stack
  (syntax → bufferSpans → flash).
- **Invalidation is lazy and content-based**: the grid records
  {lineCount, a single-getText-pass rolling char checksum, the
  buffer object token}; captureFrame re-probes and skips on
  mismatch. No edit hooks — any mutation path invalidates; a
  killed-and-recreated buffer is a different token (its stale
  records drop at the next publish). Consumers re-apply.
- **Overlap precedence resolves at publish**: the LATEST-registered
  span wins per cell — enforced by clipping earlier spans against
  later ones per line, so the grid is overlap-free and the SHARED
  renderer's start-sort + pos-clip semantics (earliest wins) never
  apply to the span layer. The r3 gate caught the inversion live.
- **The blame half**: `git blame --porcelain HEAD -- <path>` parsed
  structurally; the buffer holds source lines only (no phantom
  text); ONE multi-line span tints; attribution on the echo line;
  RET opens the show view (origin-aware quit); the three-check
  preflight (tracked / clean-vs-HEAD+unstaged / any-open-buffer ==
  disk, point-safe scan) refuses uniformly.

## Consequences

- The registry/identity machinery generalizes to future overlay
  features (diff-hunk highlighting, search scopes).
- Follow-ups (gate-named): a write-time dirty flag to cache the
  per-frame checksum cost; humanizing the echo's epoch date; the
  kill-time record prune is lazy (next publish); the preflight scan
  perturbs buffer recency.
