# SPEC-278 — thinking deltas into thought events (#320)

## Goal

The CLI's extended-thinking partials (`thinking_delta`) are dropped by
the normalizer. They stream — as `thought-delta` events through a
block-indexed accumulator — rendering as one growing dim `· ` line that
collapses past the thresholds, with TAB to toggle and byte-parity
replay.

## Design

- **The accumulator** (`fikra/thought.tlisp`): BLOCK-GRANULARITY
  ordered delivery — a fragment of the OPEN block (== watermark)
  appends (the stream's ordered contract); a CLOSED block's late delta
  (< watermark) drops; the next block (watermark+1) flushes the old and
  opens fresh; anything further is an ordering violation: BUFFERED
  until the missing block fills (the drain releases the run), with a
  2s timeout (driven by the #319 transient tick — a real FAEP status
  event `thought stream gap — block closed` through the normal emit
  path) that closes the block; late fills at the closed index drop.
- **The wire** (`fikra-norm-stream-event`): `thinking_delta` →
  `thought-delta` carrying the CONTENT BLOCK INDEX. Complete thinking
  blocks (`fikra-norm-blocks`) → the existing `thought` kind
  (completed-only streams render once, whole; EMPTY blocks emit
  nothing; text blocks' complete-only skip logic untouched).
- **The renderer** (`event.tlisp`): the fold's run state is 3-valued —
  `""` | `text` | `thought:<block>` — same-block fragments append BARE
  under one dim `· ` prefix (cross-batch growth via the threaded
  open-state); any other event closes the run.
- **Collapse** (pure, in `event.tlisp` — shared by live + replay):
  >3 lines or >200 chars (char count excludes the prefix) → first line
  + `… [N lines — TAB to expand]`. STREAMING auto-collapse: the
  accumulator emits a `thought-collapse` MARKER with every crossed
  fragment (the collapsed form's changing line-count is edit-based
  rendering — the marker is a REBUILD trigger, batch-coalesced; the
  rebuild clears the WHOLE buffer — the kept-last-line idiom left stale
  fragments).
- **Replay**: a MERGE pre-pass folds each same-block thought-delta run
  into ONE `thought` event (fragments joined; markers dropped) — the
  collapse then derives from lengths, deterministically. TAB toggles a
  first-line-keyed display-only list (a user's live toggle is NOT a
  parity input); the byte-parity assertion compares live-final vs
  replayed under DEFAULT collapse.
- **Turn end** flushes the open block (its final marker rides inside
  the completing turn).

## Completion criteria

- [x] Accumulation: multi-delta block renders as one growing line;
      block boundaries; multiline content; closed-block redeliveries
      drop; gaps buffer + drain; the 2s timeout closes (tested)
- [x] Completed-only renders once whole; EMPTY emits nothing; text
      blocks unaffected (the skip logic untouched); interleaved order
      preserved (tested)
- [x] Collapse: both thresholds; streaming auto-collapse (marker →
      rebuild); TAB toggle both directions; replay parity
      (byte-compare live-final vs replayed under default collapse,
      toggles excluded — tested)
