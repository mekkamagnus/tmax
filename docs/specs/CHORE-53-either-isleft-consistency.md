# Chore: Either.isLeft/fold consistency (#19)
## Completion Criteria
- [x] All `result._tag === 'Left'` replaced with `Either.isLeft(result)` across 6 files (11 sites).
- [x] Either imported as a value in editing.ts.
- [x] typecheck clean; router tests pass.
## Notes
Codex CONCERNS: "restores narrowing" rationale wrong (raw discriminant already narrows). This is a CONSISTENCY refactor (use the provided helper, not raw discriminant access).
