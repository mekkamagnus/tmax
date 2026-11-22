# SPEC-278 — thinking deltas into thought events (#320)

## Goal

The CLI's extended-thinking partials (`thinking_delta`) are dropped by
the normalizer. They stream — as `thought-delta` events through a
block-indexed accumulator — rendering as one growing dim `· ` line that
collapses past the thresholds, with TAB to toggle and byte-parity
replay.

## Design

- **The accumulator** (`fikra/thought.tlisp`): delivery keyed on the
  raw content-block index at RENUMBERED block granularity — the stream
  is ORDERED per block (its contract): same-raw fragments append to
  the open block; ANY new raw index opens the next block (raw jumps
  are text/tool blocks in between — never reordering; holds and gap
  timeouts were speculative dead weight over an ordered stream and ATE
  interleaved thinking); an older raw drops (redelivery).
  MESSAGE-FINAL events (tool rounds, a completed thought, turn
  boundaries) reset the thinking context — content indices restart
  per assistant message, and tool rounds start fresh messages
  mid-turn.
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
  display-only list keyed PER SEGMENT (#327's run-ordinal keys; a
  user's live toggle is NOT a parity input); the byte-parity assertion compares live-final vs
  replayed under DEFAULT collapse.
- **Turn end** flushes the open block (its final marker rides inside
  the completing turn).

## Completion criteria

- [x] Accumulation: multi-delta block renders as one growing line;
      block boundaries; multiline content; closed-block redeliveries
      drop; interleaved indices (thinking-text-thinking) accept;
      message boundaries reset (tool-round mid-turn tested)
- [x] Completed-only renders once whole; EMPTY emits nothing; text
      blocks unaffected (the skip logic untouched); interleaved order
      preserved (tested)
- [x] Collapse: both thresholds; streaming auto-collapse (marker →
      rebuild); TAB toggle both directions; replay parity
      (byte-compare live-final vs replayed under default collapse,
      toggles excluded — tested)
- [x] #327 AMENDMENT (the documented divergence): the #320
      normative's "replay RESETS collapse to the default" is honored
      for PARITY only — in-session toggles persist across rebuilds
      and replays (display-only, per-segment run-id keys — #327;
      never in the log). Rationale: every thought fragment rebuilds
      the view; a wipe would collapse the segment the user just
      expanded mid-stream. A fresh session replays under the default.
