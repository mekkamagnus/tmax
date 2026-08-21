# buffer-append: an append-at-end primitive for streaming consumers

## Status

Accepted (2026-08-21, #207 / RFC-027 §Phase 0)

## Context

RFC-027's chat-buffer streaming renders agent tokens into a buffer as they
arrive. The only append path was `buffer-insert`, which targets the cursor:
appending at the end repeatedly means line-count + cursor-move + insert per
token — O(buffer) per token, O(buffer²) per turn (an RFC-019 violation the
current `fikra-token-insert` exhibits).

## Decision

Add a generic primitive `(buffer-append <text>)` (src/editor/api/buffer-ops.ts):
compute the end position directly (last line index + last line length) and
insert there via the existing RFC-019 incremental path — which rebuilds only
the affected tail, so appends are amortized-cheap. The primitive never reads
or writes the cursor: streaming into a buffer whose cursor sits elsewhere
(position stability is pinned by test) is the intended use. Read-only and
argument validation mirror `buffer-insert`; buffer-modified is set.

## Consequences

- Streaming consumers (fikra FAEP renderer, comint-style output buffers) get
  a one-step append with no cursor round-trip.
- Cursor-stability is a contract: if a future change moves the cursor on
  append, the buffer-append tests fail by design.
- The O(1)-amortized claim rests on the RFC-019 incremental-insert invariant
  suite, not wall-clock tests, per the repo's perf-test convention
  (buffer-perf-invariants.test.ts).
