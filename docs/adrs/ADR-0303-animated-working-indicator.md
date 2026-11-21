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

- **Honesty split**: the LIVE count is CHUNKS (FAEP `text-delta` +
  `tool-call` — the issue's named rule, counted at both emit funnels);
  TOKENS appear only as the provider's report — the CLI `result` line
  maps to a PERSISTED `usage` FAEP event rendered as `✓ 1,234 tokens`
  (replay-identical; transient state never touches the final line).
- **Elapsed**: per-thread start stamped at the FIRST streamed event via
  the new `editor-time-now` primitive (raw TS clock — same altitude as
  the timer shell; baselines 433→434); rendered against the
  tick-stamped now.
- **The one-tick terminal delay**: a terminal edge FREEZES the frame
  (elapsed captured then — the clock stops) for two ticks: the frozen ✓
  frame rides the first post-terminal poll, the next tick clears it,
  and only then does the interval stop. This amends #318's stop rule
  (stop on last terminal → stop one tick AFTER) so both frames ride
  real poll cycles; the reconcile branch (inactive tick + running
  thread → resume) is unchanged.
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
