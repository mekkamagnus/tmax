# ADR-0303 — #319: the animated working indicator on the transient layer

- **Status**: Accepted
- **Date**: 2026-11-21
- **Issue**: #319
- **Spec**: SPEC-277
- **Depends on**: ADR-0302 (#318's transient layer)

## Context

#318 delivered the repaint cadence (daemon-side transient state, the
revision riding the poll, the wire segment). The indicator itself was
a bare `working…` — no counts, no elapsed, and no honest token line.

## Decision

The indicator rides #318's layer unchanged in mechanism, enriched in
content: `<glyph> <gerund> · N chunks · elapsed`.

- **Honesty split**: the LIVE count is CHUNKS — the two DELTA kinds
  (`text-delta` + `tool-input-delta`, the issue's named rule; the CLI's
  `input_json_delta` partials become persisted invisible
  `tool-input-delta` events — completions are not deltas and do not
  count), tallied at both emit funnels; TOKENS appear only as the
  provider's report — the CLI `result` line maps to a PERSISTED `usage`
  FAEP event rendered as `✓ 1,234 tokens` (replay-identical;
  transient state never touches the final line).
- **Elapsed**: per-thread start stamped at the turn's FIRST STREAMED
  event (any content kind — a thought starts the clock though it does
  not count) via the new `editor-time-now` primitive (raw TS clock —
  same altitude as the timer shell; baselines 433→434); rendered
  against the tick-stamped now. The approval resume
  (confirming→running, the same turn) preserves the turn's state —
  reset only on a fresh turn.
- **The RENDER-GATED terminal sequence**: a terminal edge captures the
  COMPLETE frozen frame as a STRING (elapsed at the edge, ✓, the gerund
  as it stands — byte-stable across later ticks) AND bumps the
  transient revision (clients whose only delta is the segment repaint).
  The clear is render-gated: the first tick after a poll SERVES the
  frame clears it, then the interval stops — both the frozen and clear
  frames ride real poll cycles in either tick/poll order. A headless
  bound (~10 unserved ticks) prevents a no-client leak. Single
  acknowledgment: one serve marks the frame for all viewers of that
  thread — a second viewer's poll within the 200ms window still sees it
  (named limitation). This amends #318's stop rule (stop on last
  terminal → stop once every frozen frame has cleared); the reconcile
  branch is unchanged.
- **Determinism in tests**: the live 200ms shell races manual ticks, so
  the suites silence the shell after setup and drive ticks with
  explicit clocks — the reconcile branch re-activates the state machine
  on the first manual tick, keeping every assertion deterministic
  except the cadence test itself (which tests the live shell).

## Consequences

- The event log's contract is intact: chunk counting hooks are
  display-side only, and the usage line is an ordinary persisted event.
- The `result`-line mapping closes the last unmapped CLI wire type.
- The frozen-frame hashmap (`remaining` tick count + captured elapsed)
  joins the per-thread transient state; `note-running` resets all of it
  per turn.
