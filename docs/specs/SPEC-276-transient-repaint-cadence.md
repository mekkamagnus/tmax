# SPEC-276 — the display-layer repaint cadence (#318)

## Goal

A time-driven indicator (spinner) cannot exist in a purely event-driven
client. The chosen mechanism: DAEMON-SIDE TRANSIENT STATE — the client
protocol is untouched except ONE comparison.

## Design

- **The transient layer** (`fikra/transient.tlisp`): daemon-side
  per-daemon state — a revision counter + tick count + spinner glyph —
  kept OUTSIDE the buffer/event log (a display-layer module; #306's
  mutation-shared-carrier finding). A tick bumps ONLY the revision; the
  event log is byte-identical across ticks (asserted).
- **Tick source**: a TS interval shell (`editor-transient-timer-start`
  / `-stop` — raw timing primitives; the tick body is T-Lisp's
  `fikra-transient-tick`). 200ms cadence (matches the poll).
- **Lifecycle**: starts on the first →running thread transition, stops
  on the terminal transition of the LAST running thread (auto-verified
  each tick as hardening); client connect/disconnect never starts or
  stops it. Thread-state owns it: `fikra-thread-status-set` notifies
  the layer on the running/idle/error/interrupted edges.
- **The wire**: `transientRevision` rides the poll response beside
  `bufferRevision` (stamped by both the keypress and render-state
  handlers via `withTransientRevision`). The client compares BOTH
  counters INDEPENDENTLY — a render fires when EITHER changes
  (transient 5→6 renders while buffer-rev stays 100; no max(), no
  missed transitions).
- **Focused-thread rule**: the transient segment renders for the thread
  the CLIENT is viewing (`fikra-transient-segment` answers per
  thread-id; an idle thread's segment is nil while another runs).
- **Docs**: the event-driven contract's display-layer exception is
  named in this spec (event.tlisp's header contract stands for the LOG
  layer; the transient layer is display-only, never touches it).

## Completion criteria

- [x] Interval lifecycle: starts on first running thread, stops on last
      terminal transition; a tick with zero running threads is a no-op
      (the active-flag guard); thread-status transitions drive it
      (turn-begin/turn-end tested)
- [x] Frame changes between events with log bytes UNCHANGED
      (byte-compare across ≥3 ticks); the revision rides the poll
      response (the serialize stamp asserted); mid-turn attach sees the
      transient on the next poll (daemon state — every client reads the
      same counter)
- [x] Focused-thread rule: an idle thread's segment is nil while
      another runs (tested); the spinner rotates across ticks
