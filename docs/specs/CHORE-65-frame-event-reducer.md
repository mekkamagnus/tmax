# Chore: Pure FrameEvent reducer (#23)
## Completion Criteria
- [x] reduceFrameEvent(frame, event, params, now) — pure function (creates copy, no mutation).
- [x] Handler calls reducer + writes back via ctx.frameObservability.set.
- [x] `now` injected (Date param); readiness normalization preserved.
- [x] 6 event types handled (tui-started, first-render, raw-mode-ready, render, resize, shutdown).
- [x] typecheck clean; router tests pass.
## Notes
Codex CONCERNS: inject now (done); write-back to Map (done); preserve readiness normalization (done). Client-level mutations (lastRequestAt etc.) stay in handler (not frame events).
