# Chore: errorResponse() helper for JSON-RPC error envelopes (#14)
## Completion Criteria
- [x] Private `errorResponse(id, code, message, data?)` helper in router.ts.
- [x] All 7 inline error envelopes in `routeRequest` replaced.
- [x] `data` guarded with `data !== undefined` (not truthiness) — null/false/0 survive.
- [x] `bun run typecheck` clean; router tests pass (38/0).
## Notes
Codex APPROVE (#14). server.ts -32700/-32603 sites left local (different context).
