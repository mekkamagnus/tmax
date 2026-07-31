# Chore: Dedup mockWorktreeDeps fixture (#35)
## Completion Criteria
- [x] Shared `createMockWorktreeDeps()` factory in test/helpers/adw-test-fixture.ts (fresh per call — no mutable state leak).
- [x] 3 adw test files import + use it; local copies removed.
- [x] Drift fixed (feedback-stall "/mock" → "/mock/worktree").
- [x] typecheck clean; 58/0 tests across the 3 files.
## Notes
Codex APPROVE (#35). mockWorktreeDepsConfigurable stays in pipeline-loop (not duplicated). Codex: spread-base for configurable; factory for no-leak.
