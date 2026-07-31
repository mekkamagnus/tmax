# Chore: Extract tlispValueToJson as a free function (#20)
## Completion Criteria
- [x] Free `tlispValueToJson` in src/tlisp/serialization.ts (pure, no instance state).
- [x] server.ts method delegates to it (one-liner); ServerContext interface unchanged.
- [x] asTlisp (JSON→T-Lisp, the inverse) left untouched — NOT a duplicate.
- [x] typecheck clean; router tests pass.
## Notes
Codex CONCERNS: asTlisp is the INVERSE, not a duplicate; shared-core premise wrong. This extraction only moves tlispValueToJson (TLisp→JSON direction).
