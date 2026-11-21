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
- **Chunks (the named rule)**: FAEP stream events of kind `text-delta`
  plus `tool-call` — the two counted kinds, NOTHING else. Both emit
  funnels (`fikra-event-emit-batch`, `-for`) call
  `fikra-event-count-chunks` beside the existing tool counter. During
  streaming the indicator shows chunks received, explicitly labeled
  (`· 42 chunks`) — the label is the honesty.
- **Elapsed**: starts at the turn's FIRST streamed event
  (`fikra-transient-note-chunks` stamps `editor-time-now` — a transient
  timestamp, never persisted); renders at tick resolution
  (`fikra-transient-now`, stamped by the TS shell's tick argument).
  Daemon-side state: mid-turn attach and reconnect read the SAME
  counter. Format `42s` / `1m12s`.
- **Terminal sequence (deterministic)**: a terminal edge
  (`note-terminal`) FREEZES the thread's frame — elapsed captured at
  the edge (later ticks cannot advance it), glyph `✓`, final counts —
  rideable for TWO ticks: the first poll after terminal sees the frozen
  frame; the tick after clears it. The interval stops one tick AFTER
  the last running thread's terminal (`#318`'s stop rule gains this
  delay; both frames ride real poll cycles). Tested at EVERY terminal
  kind: done (idle), error, interrupted.
- **Rotation**: the gerund cycles the fixed list (pondering, reading,
  editing) on the tick count (3-frame); the glyph keeps its 4-frame
  cycle — deterministic under driven ticks.
- **Per-thread**: chunk counts, elapsed starts, and frozen frames are
  per-thread hashmaps; each running thread's OWN indicator renders on
  ITS frame (the #318 per-frame viewed-thread resolution unchanged).
- **API**: `editor-time-now` (the TS clock, ms) joins the timer shell
  as a raw timing primitive (baselines 433→434).

## Completion criteria

- [x] Chunk counter during streaming (the named rule — thought and
      turn-start NOT counted, tested); usage line at end when present
      (input+output, comma-formatted, replay-identical); absent-usage
      path (no event, no line — tested)
- [x] Elapsed: first-event start (0 before any chunk), growth under
      ticks, mid-turn-attach/reconnect semantics (daemon state), freeze
      (captured at the edge — later ticks cannot advance it) + clear at
      each terminal transition (done/error/interrupted each tested)
- [x] Spinner/gerund rotation deterministic under driven ticks (both
      cycles pinned); per-thread isolation (separate counts on
      concurrent running threads); capture evidence (the graded frame
      sequence: streaming → grown → frozen ✓ → cleared)
