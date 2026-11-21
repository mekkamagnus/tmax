# ADR-0304 — #320: thinking deltas → thought events

- **Status**: Accepted
- **Date**: 2026-11-21
- **Issue**: #320
- **Spec**: SPEC-278
- **Depends on**: ADR-0302/#318 (the tick), ADR-0303/#319 (editor-time-now)

## Context

Extended-thinking partials arrive as `thinking_delta` content-block
deltas; the normalizer dropped them, and the existing `thought`
renderer emits a complete prefixed line per event — naive per-chunk
emission would fragment.

## Decision

- **Block-granularity ordered delivery** (`fikra/thought.tlisp`): the
  watermark is the CONTENT BLOCK INDEX. Open-block fragments append
  (the stream is ordered per block — fragment-level dedupe is
  impossible and unnecessary); closed blocks drop; gaps buffer + drain;
  a 2s timeout (the #319 tick polls it) closes with a persisted status
  event — never re-assembled out of order.
- **Fragments, not cumulative**: emitted `thought-delta` events carry
  FRAGMENTS (append-only rendering grows the line); the accumulator
  privately tracks the cumulative for the collapse threshold.
- **Markers for edit-based rendering**: the collapsed form's line-count
  changes per fragment, which append-only cannot express — the
  `thought-collapse` marker triggers a buffer REBUILD (batch-coalesced;
  the rebuild now clears the WHOLE buffer). Replay merges runs into
  single `thought` events and derives collapse from lengths — parity
  holds under default collapse; TAB toggles are display-only
  (first-line-keyed) and explicitly not a parity input.

## Consequences

- The fold's run state is 3-valued (`""`/`text`/`thought:<block>`) —
  thought runs grow across batches like text runs.
- The tick gains one non-display duty: polling the thought gap timeout
  (a semantic close, emitted through the normal FAEP path).
- `fikra-thread-turn-end` flushes the open block before the end marker.
