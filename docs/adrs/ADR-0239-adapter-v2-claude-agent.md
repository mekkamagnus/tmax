# Adapter contract v2 and the Claude agent backend

## Status

Accepted (2026-08-22, #214 / [SPEC-214](../specs/SPEC-214-adapter-v2-claude.md))

## Context

The old backend was one-shot `claude --print` with context glued into the
prompt; the old registry dispatched a protocol that dropped its arguments.
Fikra needs process-per-turn + session resume + streamed tool events.

## Decision

Adapter contract v2: backends provide available-p / capabilities /
start-turn / abort; the registry dispatches via funcall string paths.
Capability alists are LIST-shaped (T-Lisp has no dotted pairs). The Claude
backend separates its PURE normalization (one flat helper per wire type —
system→session, assistant→text-delta/tool-call, user→tool-result ok/fail,
result→nothing) from process plumbing, so recorded stream-json fixtures
test the whole pipeline without spawning claude. Chunks drain through a
recursive line accumulator (no `while` macro in T-Lisp); each chunk emits
ONE FAEP batch; session events record the resume handle. The sentinel is
the authoritative turn end; ABORT sets an aborted-locally flag BEFORE
signaling so the killed process's sentinel cannot double-end the turn or
override interrupted with error — pinned by both a sim seam and a real
subprocess kill.

## Consequences

- #215's replay harness drives the identical pipeline from fixtures; live
  claude smoke (two turns resuming one session) stays opt-in.
- Test seams (abort-sim, adopt-process) are exported deliberately and
  commented as such.
- nil stringifies as "null" across the TS bridge — capable-p normalizes to
  explicit t/nil; test expectations use "null".
- The gate's rounds caught a real live-path bug (double turn-end on abort)
  that fixture-only testing had missed — the argument for keeping a real
  subprocess pin in the suite.
