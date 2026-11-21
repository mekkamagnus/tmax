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

- **Ordered delivery on raw indices** (`fikra/thought.tlisp`): the
  stream is ORDERED per block (its contract) — same-raw fragments
  append, any NEW raw index opens the next block (raw jumps are
  interleaved text/tool blocks, not reordering), older raws drop. The
  r1 gap-buffer + 2s-timeout machinery was DELETED: over an ordered
  stream it was unreachable dead weight, and it ATE interleaved
  thinking (raw 0 → text 1 → raw 2 held then dropped). MESSAGE-FINAL
  events (tool rounds, completed thoughts, turn boundaries) reset the
  context — indices restart per assistant message.
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
- `fikra-thread-turn-end` flushes the open block before the end marker.
