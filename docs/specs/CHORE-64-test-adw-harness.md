# Chore: Route test:adw through the BUG-16 force-exit harness (#31)
## Completion Criteria
- [x] run-unit-tests.ts accepts --adw flag (inverts the adw-* filter to include ONLY adw-* files).
- [x] --adw filtered from bun test args (not passed to the test runner).
- [x] package.json test:adw updated: bun scripts/run-unit-tests.ts --adw.
- [x] All 16 adw-* files run through the force-exit harness (not explicitTarget single-file).
- [x] typecheck clean.
## Notes
Codex CONCERNS: "Run all 16 adw-* paths (not explicitTarget=first)." DONE — --adw includes ALL adw-* files in batches. PER_TEST_TIMEOUT_MS (60s) replaces the old 30s (safer per codex).
