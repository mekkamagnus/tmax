# Chore: Generic ensureCliAvailable() (#15)
## Completion Criteria
- [x] ensureCliAvailable(run, cmd, cwd, installHint?) in dispatcher-runtime.ts.
- [x] builder.ts, patch-reviewer.ts, tester.ts ensureAvailable delegate to it (cwd preserved).
- [x] CLAUDE_INSTALL_HINT shared as the default installHint.
- [x] typecheck clean; adw tests pass (457/0).
## Notes
Codex CONCERNS: keep cwd in the signature (done — generic takes cwd). ensureCodex NOT forced through it (different flow).
