# SPEC-207: buffer-append primitive

**Issue:** #207 (fikra-p0 / RFC-027 §UI, §Phase 0)
**Status:** Implemented 2026-08-21

## Goal

A generic T-Lisp primitive `(buffer-append <text>)` that appends text at the
end of the current buffer in one step — the streaming-consumer counterpart to
`buffer-insert`. Unblocks RFC-027's chat-buffer streaming renderer, whose
current `fikra-token-insert` does line-count + cursor-move + insert per token
(O(buffer) per token, O(buffer²) per turn).

## Completion Criteria

- [x] `(buffer-append <text>)` appends at end of the current buffer; returns
  the appended text (mirrors buffer-insert's return).
- [x] Never moves the cursor (the O(buffer)-per-token motivation is the
  cursor dance, not the insert).
- [x] Read-only buffers reject with a ReadOnly error; argument validation
  (arity + string type) matches buffer-insert's conventions.
- [x] Unit tests: empty/non-empty/multi-line appends; repeated streaming
  appends accumulate in order; cursor stability across appends; read-only
  rejection (pinned at the ops level — the fixture does not expose the
  production readonly set); argument validation; large-buffer smoke
  (2k appends into a 10k-line buffer, content exact) — invariant-level per
  the repo's perf-test convention (no wall-clock assertions).
- [x] `bun run typecheck` (all projects) green.

## Implementation

`src/editor/api/buffer-ops.ts` — computes the end position (last line index +
last line length) and uses the existing RFC-019 incremental insert path,
which rebuilds only the affected tail: amortized-cheap, no cursor round-trip.
Sets buffer-modified like buffer-insert; no cursor writes.

## Notes

- O(1)-amortized claim rests on the RFC-019 incremental insert invariants
  (already pinned by test/unit/buffer-perf-invariants.test.ts); this spec's
  tests assert the cursor/content invariants, not timings.
- Fully generic (RFC-027 Phase 0 rule): no Fikra code references.
