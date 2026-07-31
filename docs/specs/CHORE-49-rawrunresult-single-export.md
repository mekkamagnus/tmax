# Chore: Single RawRunResult export (#13)
## Completion Criteria
- [x] tester.ts and patch-reviewer.ts import + re-export RawRunResult from dispatcher-runtime.ts (local defs deleted).
- [x] Test files importing from tester.ts/patch-reviewer.ts still work (re-export preserves the surface).
- [x] typecheck clean (src+test); 92/0 adw tests.
## Notes
Codex CONCERNS (behavior-preserving). "Tests import RawRunResult from tester.ts/patch-reviewer.ts → TS2305 if deleted first" — addressed via re-export.
