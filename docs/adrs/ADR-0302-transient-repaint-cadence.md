# ADR-0302 — #318: daemon-side transient state for the animation layer

- **Status**: Accepted
- **Date**: 2026-11-21
- **Issue**: #318
- **Spec**: SPEC-276

## Context

Fikra is event-driven end-to-end (FAEP: "no timers anywhere"); the
client repaints only on daemon revision bumps — a time-driven
working indicator cannot exist without a cadence source.

## Decision

The DAEMON owns the transient layer: a revision counter + spinner
state in a display-layer T-Lisp module (`fikra/transient`), kept
outside the buffer/event log. A TS interval shell (raw timing
primitive) drives 200ms ticks whose body is T-Lisp; the lifecycle is
thread-state-owned (starts on the first running transition, stops on
the last terminal transition; auto-verified each tick). The revision
rides the existing poll response beside bufferRevision — the client
compares both counters independently and renders on either change (the
one client-side change; the protocol gains one optional field). The
focused-thread rule: the segment renders per viewed-thread id.

## Consequences

- The event log stays purely event-driven (byte-identical across
  ticks — asserted); the "no timers" contract holds for the LOG layer,
  with the display-layer exception named here.
- The serialize path gains the exported `withTransientRevision` (the
  Either-aware T-Lisp stamp — revision + the viewed thread's segment) on
  EVERY response path (keypress with/without frameId, render-state,
  quit); the segment rides as `transientSegment` and the TUI renders it
  on the status row (below status messages; cleared with `\x1b[K`).
- The API baselines refreeze 430→432 (the two timer shell primitives).

## Deviation from the issue thread (recorded)

The owner's #318 comment (id 7023552282) argued for a CLIENT-owned
clock — "no timers in T-Lisp", the client animates between polls. This
ADR consciously overrides that stance: a client-side clock cannot share
state (two clients would animate independently — mid-turn attach would
miss the elapsed cadence), and the transient state it animates FROM
(running-thread set, revision) is daemon-side by nature. The interval
shell therefore lives in the editor API as a raw TS timing primitive
(same altitude as `editor-set-status`); T-Lisp owns the state and
lifecycle rules, and the "no timers" invariant survives where it
matters — the FAEP log layer.

## Gate-round refinements (r1/r2)

- r1: the wire mechanism was dead end-to-end (Either unwrap bug, a dead
  local helper copy, no segment rendering) — fixed by the single
  exported helper + the segment riding the wire.
- r2: `jsonToEditorState` dropped the field (spinner dead in the live
  TUI); status-row precedence inverted; the viewed thread now resolves
  PER FRAME (`fikra-thread-id-of-buffer` inverse lookup — a frame
  watching `*Fikra-fix-1*` gets fix-1's spinner, not the daemon
  current's); the tick's auto-stop asks the AUTHORITATIVE thread
  registry (a missed transition notification cannot wedge the
  interval); an inactive tick KILLS a leaked interval (module-reload
  hardening).
