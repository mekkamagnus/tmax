# SPEC-277 — the animated working indicator (#319)

## Goal

The running thread's view ends with a LIVE indicator row —
`◍ pondering · 42 chunks · 1m12s` — honest by construction (chunks are
counted FAEP events; tokens appear ONLY when the provider reports
them), riding #318's transient layer (the tick + revision + wire
segment).

## Design

- **The counter is HONEST (no invented tokens)**: the final count is
  PROVIDER-REPORTED usage — the CLI's `result` line maps (backend
  normalize) to a `usage` FAEP event (`input_tokens + output_tokens`)
  PERSISTED at turn-end, so replay renders the `✓ 1,234 tokens` line
  identically from the log (no transient state in the final line). No
  usage on the result (interrupted turns) → no event → no line.
- **Chunks (the named rule)**: the DELTA kinds — `text-delta` plus
  `tool-input-delta` (the CLI's streamed `input_json_delta` partials,
  now persisted like text partials and rendered invisible; completions
  — `tool-call`, completed text — are NOT deltas and do not count).
  Both emit funnels (`fikra-event-emit-batch`, `-for`) call
  `fikra-event-count-chunks` beside the existing tool counter. During
  streaming the indicator shows chunks received, explicitly labeled
  (`· 42 chunks`) — the label is the honesty.
- **Elapsed**: starts at the turn's FIRST STREAMED event — any content
  kind (deltas, thought, tool-call — an early thought starts the clock
  even though it does not count); `fikra-transient-note-chunks` stamps
  `editor-time-now` (a transient timestamp, never persisted); renders
  at tick resolution
  (`fikra-transient-now`, stamped by the TS shell's tick argument).
  Daemon-side state: mid-turn attach and reconnect read the SAME
  counter. Format `42s` / `1m12s`.
- **Terminal sequence (deterministic, RENDER-GATED)**: a terminal edge
  (`note-terminal`) captures the COMPLETE frozen frame as a STRING —
  elapsed at the edge, glyph `✓`, the gerund as it stands, final
  counts — later ticks cannot change a word of it. The CLEAR is
  render-gated: the frame clears on the first tick AFTER a poll has
  SERVED it (the serialize helper stamps `mark-rendered`), so both the
  frozen frame and the clear frame ride real poll cycles regardless of
  the tick/poll race order (tick-first and poll-first both tested). A
  headless bound clears an unserved frame after ~10 ticks (2s) — no
  attached client may leak the interval. The interval stops once no
  thread runs AND every frozen frame has cleared (`#318`'s stop rule
  gains this delay). Tested at EVERY terminal kind: done (idle),
  error, interrupted. The APPROVAL RESUME (confirming→running, the
  same turn) preserves chunks + elapsed (reset only on a fresh turn:
  idle/error/interrupted→running).
- **Rotation**: the gerund cycles the fixed list (pondering, reading,
  editing) on the tick count (3-frame); the glyph keeps its 4-frame
  cycle — deterministic under driven ticks.
- **Per-thread**: chunk counts, elapsed starts, and frozen frames are
  per-thread hashmaps; each running thread's OWN indicator renders on
  ITS frame (the #318 per-frame viewed-thread resolution unchanged).
- **API**: `editor-time-now` (the TS clock, ms) joins the timer shell
  as a raw timing primitive (baselines 433→434).

## Completion criteria

- [x] Chunk counter during streaming (the named rule: the two DELTA
      kinds count; completions/thought/turn-start do NOT — tested,
      including the streamed-tool-input-delta mapping); usage line at
      end when present (input+output, comma-formatted,
      replay-identical); absent-usage path (no event, no line — tested)
- [x] Elapsed: first-STREAMED-event start (a thought starts it; 0
      before any stream), growth under ticks,
      mid-turn-attach/reconnect semantics (daemon state), the approval
      resume preserves it, freeze (the COMPLETE frame captured as a
      string at the edge — byte-stable across later ticks) +
      render-gated clear at each terminal transition (done/error/
      interrupted each tested, both poll/tick orderings)
- [x] Spinner/gerund rotation deterministic under driven ticks (both
      cycles pinned); per-thread isolation (separate counts on
      concurrent running threads); capture evidence (the graded frame
      sequence: streaming → grown → frozen ✓ → cleared)
