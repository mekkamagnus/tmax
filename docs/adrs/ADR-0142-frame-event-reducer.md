# ADR-0142 — Pure FrameEvent reducer (#23)
## Status: Accepted
## Context: The client-event handler mutated FrameObservability inline (25-line if/else block).
## Decision: Extracted pure reduceFrameEvent(frame, event, params, now) → FrameObservability. Handler calls it + writes back via Map.set. `now` injected for testability.
## Consequences: Reducer testable in isolation (no ctx, no Map); same behavior (spread copy + identical field updates).
