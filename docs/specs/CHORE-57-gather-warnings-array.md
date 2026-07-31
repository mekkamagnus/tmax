# Chore: gatherContext warnings → array (#26)
## Completion Criteria
- [x] warnings collected into `const warnings: string[] = []` via push (not mutable string concatenation).
- [x] gitWarning computed once at the end: `warnings.join("; ")`.
- [x] Behavior preserved (same "; " separator, same output string).
- [x] typecheck clean; gather tests pass.
## Notes
Codex CONCERNS: "immutability" label inaccurate (push mutates); this is reducing mutable-string-threading, matching buildUntrackedDiff's pattern.
