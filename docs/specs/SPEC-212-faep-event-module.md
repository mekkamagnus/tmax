# SPEC-212: FAEP — the Fikra Agent Event Protocol module

**Issue:** #212 (fikra-p1 / RFC-027 §D2, §Phase 1)
**Status:** Implemented 2026-08-21

## Goal

The load-bearing module: a normalized event vocabulary shared by all
backends, event-sourced JSONL logs, and replay-as-renderer — the transcript
is a pure function of the event log.

## Design

`src/tlisp/core/fikra/event.tlisp` (module `fikra/event`). Event = alist of
("field" value) pairs with mandatory "kind". Vocabulary per RFC §D2:
turn-start/session/text-delta/thought/tool-call/tool-result/
permission-request/permission-response/file-change/turn-end/
checkpoint-start/checkpoint-ready/checkpoint-error/checkpoint-reverted.

- `(fikra-event-log-set path)` — point the log at a path (#213 wires
  per-thread paths); `(fikra-event-emit event)` and
  `(fikra-event-emit-batch events)` — the batch does ONE append-file write +
  ONE render pass (the per-chunk coalescing #208's serialized filters feed);
  `(fikra-event-replay)` — pure log→transcript; `(fikra-event-events)` /
  `(fikra-event-reset)` — in-memory surface for tests.
- Emit contract: append → render → record, synchronously, in order. Render
  delivers to the current buffer via buffer-append ONLY when it is *Fikra*
  (buffer mutation bumps the revision the TUI poll consumes; no timers).
- Text-run state machine: adjacent text-deltas join under one "AI: "
  prefix; any other event closes the run. Emit threads the global run
  state; replay threads its own (pure).
- Tombstone semantics: invalidated turns are emitted BEFORE the tombstone,
  so replay PRE-SCANS for checkpoint-reverted events, builds (target+1,
  revert-point] ranges, renders skipping those turns, draws ONE collapsed
  marker at the tombstone, and CONTINUES for post-revert turns (numbers
  past revert-point).
- Crash tolerance: a trailing partial JSONL line (no newline, fails the
  JSON-parse probe) is dropped on load.

## Completion Criteria

- [x] Events append as JSONL lines (json-encode round-trip shape); in-memory
      list records oldest-first (pinned).
- [x] emit-batch: one write for N events (pinned: 3 events → 3 lines, one
      append call path).
- [x] Replay renders the §D2 table: turn header, joined AI run, ⚙ tool
      blocks with → results, ± file-change lines, footer (pinned).
- [x] thought / permission request+response / checkpoint lines render (pinned).
- [x] Tombstone: invalidated range swallowed (INCLUDING its turn headers),
      ONE marker, post-revert turns (numbered past revert-point) still
      render (pinned). LIVE *Fikra* REBUILDS from replay on a tombstone emit
      — no stale turns on screen (pinned, gate round-1 catch).
- [x] Marker label states the semantics directly: "reverted to turn N
      (discarded through M)" (gate round-1 off-by-one catch).
- [x] Read-only state saved/restored around buffer mutations — a user who
      made *Fikra* writable keeps it writable (gate round-1 catch).
- [x] Crash tolerance: partial trailing line dropped (pinned).
- [x] Incremental render into *Fikra* only: emits render into *Fikra* when
      current; NOT into other buffers; log still receives them (pinned both).
- [x] Tests: test/unit/fikra-event.test.ts (9). typecheck all projects
      green; fikra-adjacent suites green (fikra-event, fikra-mode,
      fikra-primitives, io-encode, buffer-append, keymap-local: 71/71).

## Notes

- T-Lisp gotchas hit and coded around (documented in-module): no assoc
  (manual alist scan), no dotted pairs (ranges are 2-element lists; cons
  requires a list second arg), cond clauses are exactly (test body) —
  multi-form bodies need progn, `(last l)` returns the element,
  string-split (not split-string).
- The log path is process-global until #213 lands per-thread state; the
  module is written so log-set is the only wiring #213 needs.
