# Chore: Retire Option<T> (#29)
## Completion Criteria
- [x] src/utils/option.ts deleted (124 lines dead code).
- [x] src/utils/adt.ts deleted (77 lines dead code — sole consumer of option.ts; itself imported by nobody).
- [x] test/unit/option.test.ts deleted (123 lines testing dead code).
- [x] rules/functional-programming.md Option references removed.
- [x] typecheck clean (src + test).
## Notes
Decision: RETIRE (codex-confirmed matches current practice — codebase uses Either + null/undefined, not Option). adt.ts was ALSO dead code (nobody imports it).
