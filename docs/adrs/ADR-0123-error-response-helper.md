# ADR-0123 — errorResponse() helper for JSON-RPC errors (#14)
## Status: Accepted
## Context: 7 inline error-response object literals in routeRequest were copy-pasted (~40 lines). Codex approved the consolidation.
## Decision: Private `errorResponse(id, code, message, data?)` helper. `data` included via `data !== undefined` (not truthiness) so null/false/0 survive. server.ts error sites (-32700/-32603) left local (connection handler, not the router).
## Consequences: ~40 lines removed; single source for error envelopes; typecheck clean + 38/0 router tests.
