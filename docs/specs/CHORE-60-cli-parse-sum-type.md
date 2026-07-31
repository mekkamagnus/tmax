# Chore: Sum type for adw-patch-review CLI parse result (#24)
## Completion Criteria
- [x] PatchReviewParseResult sum type (help/usage/error/run) replaces Either + __help__/__usage__ sentinels.
- [x] parseArgs returns the sum type; main() uses a switch on kind.
- [x] All 9 parseArgs tests updated to check kind (not Either.isLeft/Right).
- [x] typecheck clean (src + test); 48/0 patch-review tests.
## Notes
Codex CONCERNS: 4th variant {kind:'usage'} — added (no-args case). No sentinel strings remain in parseArgs/main.
