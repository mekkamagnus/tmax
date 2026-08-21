# confirmation/mediate: the generic deferred-confirmation primitive

## Status

Accepted (2026-08-21, #210 / [SPEC-210](../specs/SPEC-210-confirmation-mediate.md))

## Context

RFC-027's L2 approvals need a way for an external process to ASK the user
mid-turn. The mechanism must be generic (no Fikra policy), safe against
socket-reachable forgers, and honest about who resolves.

## Decision

A process-shared `ConfirmationService` (editor layer) backs both a new RPC
method and T-Lisp ops. `confirmation/mediate` parks (the router's native
await); a registered T-Lisp handler runs synchronously at enqueue with
(id, detail, kind); `(confirmation-resolve id decision)` settles it —
first-resolver-wins with contested attempts AUDITED on the original record.
Timeouts, cancels, and sweeps all resolve as reject, so a mediate never
hangs. Auth: 24-byte one-time tokens minted per source+scope — the PRIMARY
control on every platform; a schema-valid request with a guessed, stale, or
cross-source token is rejected before any prompt or handler call. The
client-kind FACT (resolverHint, stamped by the daemon around the resolving
eval — wiring lands with #220's policy phase) is recorded per resolution.

## Consequences

- Interactive-only resolve POLICY (#220) becomes a policy decision on top of
  recorded facts, not new mechanism.
- The RPC surface grows by one deliberately-baselined method (23→24); the
  api-names baseline regen (409→419) also repairs drift the #206/#209/#211
  landings left (their baseline updates were omitted; CI never executed that
  batch past the halt point).
- Singleton service: one editor per process; tests reset it.
