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
- The serialize path gains `withTransientRevision` (a tiny T-Lisp eval
  stamp) on the keypress + render-state handlers only.
- The API baselines refreeze 430→432 (the two timer shell primitives).
