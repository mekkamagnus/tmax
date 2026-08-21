# SPEC-210: confirmation/mediate — the generic deferred-RPC primitive

**Issue:** #210 (fikra-p0 / RFC-027 §D5 L2 contract, §Phase 0)
**Status:** Implemented 2026-08-21

## Goal

The mechanism layer of RFC-027's L2 approvals, with ZERO Fikra policy: park a
confirmation request from an external process, surface it to a registered
T-Lisp handler, resolve later (first-wins) or auto-reject on timeout/cancel/
sweep; unforgeable one-time tokens are the primary auth control.

## Design

`ConfirmationService` (src/editor/api/confirmation-service.ts) — one instance
per process, shared by the RPC handler and the T-Lisp ops:

- `mediate({source, token, kind, detail, timeoutMs})` → parks. Validation
  failures (unknown/stale/cross-source token, unregistered source) resolve
  IMMEDIATELY as reject with a reason in `scope` — no prompt, no handler call.
- Tokens: `(confirmation-token-mint "source" "scope")` — 24 random bytes,
  hex; single-use; bound to source+scope. PRIMARY control on every platform
  (peer credentials are defense-in-depth where available — Phase 3 wiring).
- Handler delivery: `(confirmation-handler-register "source" "fn")` — the
  handler runs synchronously at enqueue with `(id detail kind)`; handler
  errors are logged and NOT fatal (the prompt stays parked until settled).
- `(confirmation-resolve id "allow"|"reject"|"always")` — first-resolver-wins;
  later resolves are idempotent no-ops that still AUDIT the contest on the
  original record. `(confirmation-cancel id)`, `(confirmation-pending)`.
- `sweepAll()` — daemon shutdown / turn-interrupt shape: every pending → reject.
- Timeout → reject per request (default 60 s).
- Client-kind FACT: `resolverHint` (stamped by the daemon around the
  resolving eval; default "unknown") is recorded on each resolution — the
  input #220's interactive-only policy consumes. Wiring of the daemon's eval
  path to stamp interactive-vs-headless lands with #220 (policy phase).

RPC surface: `confirmation/mediate` added to RpcMethodMap + router HANDLES +
param guard + sync policy "stateless"; the router's native await parks the
response (server/rpc/handlers/confirmation.ts).

## Completion Criteria

- [x] Deferred resolution: mediate parks until a later eval resolves; the
      registered handler received (id, detail, kind) at enqueue (pinned).
- [x] Timeout auto-rejects; cancel sweep rejects (pinned).
- [x] Forged token → reject "unknown-token" BEFORE handler delivery (handler
      call count pinned at zero); stale (one-time) and cross-source tokens
      rejected with reasons (pinned).
- [x] First-resolver-wins idempotence + contested-attempt audit record (pinned).
- [x] Client-kind fact captured on resolution (headless simulated; pinned).
- [x] Unregistered source → immediate reject "no-handler-registered" (pinned).
- [x] T-Lisp validation: bad decision / arity error (pinned).
- [x] RPC wiring: method in RpcMethodMap + HANDLES + param guard + router
      registration; baselines updated deliberately: api-names-static 409→419
      = the 5 confirmation ops + 5 entries that were PRE-EXISTING DRIFT from
      the #206/#209/#211 landings (those commits omitted their baseline
      updates — this regen repairs the drift); rpc-methods 23→24; AC7.1
      count. A correction comment on the issue says the same.
- [x] `bun run typecheck` (all projects) green; confirmation-mediate 10/10;
      registry/inventory suites green except the 2 PRE-EXISTING #227-family
      failures (Editor methods, Markdown — stash-attributed earlier).

## Notes

- The service is a process singleton: a daemon runs one editor; embedded
  mode simply never mediate()s. reset() between tests.
- Zero Fikra references — the test handler is a plain T-Lisp defun.
