# FAEP: the Fikra Agent Event Protocol module

## Status

Accepted (2026-08-21, #212 / [SPEC-212](../specs/SPEC-212-faep-event-module.md))

## Context

RFC-027's load-bearing decision: all backends normalize into ONE event
vocabulary; threads are event-sourced JSONL logs; the transcript is a pure
replay. Nothing downstream (threads, replay tests, UI) exists without this.

## Decision

`fikra/event` (pure T-Lisp): 15 event kinds per the RFC §D2 table.
`emit-batch` = ONE append-file write + ONE render pass — the per-chunk
coalescing primitive the serialized filters feed (#208); no timers anywhere.
A shared render fold joins adjacent text-deltas under one "AI: " prefix;
emit threads the global run state, replay threads its own (pure). Replay
PRE-SCANS for tombstones (invalidated turns precede the tombstone in the
log), skips (target, revert-point] INCLUDING their turn headers, renders one
accurate marker ("reverted to turn N (discarded through M)"), and continues
for post-revert turns. A tombstone EMIT rebuilds *Fikra* from replay —
append would leave stale turns on screen. Crash tolerance: a trailing
partial JSONL line is dropped. Read-only state is saved/restored around
buffer mutations. Rendering targets *Fikra* only; buffer mutation bumps the
revision the TUI poll consumes.

## Consequences

- #213 (threads) wires per-thread log paths via log-set — the module was
  written so that is its only integration point.
- T-Lisp gotchas documented in-module (no assoc, no dotted pairs — cons
  requires a list second arg, cond clauses are exactly (test body), `last`
  returns the element, `string-split`): the module doubles as a reference
  for writing larger T-Lisp programs.
