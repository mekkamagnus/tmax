# ADR-0253: Fikra workflows — labeled threads, never-clobber backend start

**Date:** 2026-08-22
**Status:** Accepted
**Issue:** #225
**Spec:** SPEC-225

## Context

RFC-013 defined workflows as one-shot calls; RFC-027 Phase 5 re-binds them
to the thread machinery (#222). The backend switcher already existed
(#214) but `fikra-start` unconditionally re-selected the default backend.

## Decision

1. **A workflow IS a labeled thread.** The label persists in the thread's
   state.json (`workflow` field); reuse is a disk scan (restart-safe),
   creation is `fikra-thread-new` (runtime-mode inheritance rides free).
   Repeated invocations append to ONE conversation — the workflow's
   history is reviewable, checkpointable, and diffable like any thread.
2. **Context snapshots BEFORE the thread switch.** Switching threads
   switches the current buffer to the workflow's chat buffer; reading
   context after the switch captures the wrong buffer. The snapshot
   ordering is the invariant.
3. **`fikra-start` never clobbers an explicit backend selection** (probe
   catch: a workflow's start reset the user's SPC a b choice). Auto-select
   only when the current backend is "none".
4. **turn-start records the backend ACTUALLY driving the turn** — the
   adapter's live selection, not a stale thread field. A mid-thread
   switch is visible in the event log by construction.
5. **Custom workflows are a registration pair**, not the RFC-013 defmacro
   shape (`:context`/`:on-response` keys were never implemented
   anywhere): `fikra-register-workflow` + `fikra-run-named-workflow`,
   thread-aware by riding the same labeled-thread path.

## Consequences

- Workflows, threads, and the switcher compose: a backend switch inside a
  workflow thread carries the whole conversation.
- `chat-open` is focus-aware: it re-inits only when nothing is focused —
  programmatic switches own their focus.
- The replay backend's fixture-per-turn contract means workflow tests are
  explicit about what each turn answers.
