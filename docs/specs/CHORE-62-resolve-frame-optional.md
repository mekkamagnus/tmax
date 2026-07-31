# Chore: resolveFrameOptional non-throwing (#27)
## Completion Criteria
- [x] getFrameOption(id): Frame | undefined added (non-throwing lookup).
- [x] resolveFrameOptional uses getFrameOption directly (no try/catch).
- [x] resolveFrame (throwing) unchanged for callers that want hard failure.
- [x] typecheck clean; router tests pass.
## Notes
Option retired (#29) — uses Frame | undefined, not Option. Codex: "explicit invalid frameId must NOT fall back to active" — preserved (invalid frameId → getFrameOption returns undefined).
