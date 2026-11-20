# ADR-0300 — #303: prove the approval gate with a pausing fixture

- **Status**: Accepted
- **Date**: 2026-11-21
- **Issue**: #303
- **Spec**: SPEC-274

## Context

Codex's lowest dimension (3/10): the interactive approval gate was
never exercised in a graded capture — the installed CLI lacks
`--permission-prompt-tool`, so live sessions degrade to L1. A rendered
permission event alone would not prove decisions RESUME a waiting turn.

## Decision

A pausing fixture backend (replay's sibling) owns the proof: stream to
a scripted permission-request, park on an out-of-band decision seam
(a polled variable — the pump resumes on the recorded y/n/a), stream
the matching branch to turn-end. `a` persists a per-thread
(tool, scope) allow-list on the thread record (state.json save/load +
the background-session writer), exact-pair matched, tolerant of the
json alist round-trip; matching pairs skip the pause. The thread state
machine's confirming edges are honored both ways. Live-CLI mediation
remains the fikra-native-backend arc's follow-up (stated honestly).

## Consequences

- The tmax-side gate loop (pause → decide → resume) is now under test;
  the graded capture is the frame sequence from the replayed *Fikra*.
- The thread record grows one persisted field (`approval-allow-list`)
  on all three state.json writers.
