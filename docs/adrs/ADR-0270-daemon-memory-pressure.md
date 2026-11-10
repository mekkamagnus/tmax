# Daemon reacts to OS memory pressure

## Status

Accepted (2026-11-10) — resolves #243 / SPEC-243. Builds on #233 (Bun 1.4.4,
which exposes the notification) and #234 (the parse cache — ADR-0261 — whose
`clearParseCache()` docstring pre-named this hook).

## Context

The daemon is a long-running process; under OS memory pressure the kernel
kills it before anything else fails. Bun 1.4 exposes the OS notification:
`process.on("memoryPressure", level)` with levels `"warning" | "critical"`
(macOS + Linux; per bun-types `overrides.d.ts`). The reclaimable inventory in
the daemon process: the interpreter parse cache (#234, LRU-256 of parsed
ASTs — the one large allocation that is pure re-derivable state, ~5 µs/form
to rebuild). Workspace/buffer snapshots are *persisted user state*, not
caches — never droppable. The ModuleRegistry export cache (one array,
self-invalidating) and the *Messages* log-store render cache (small strings,
lazy re-render) reclaim negligible memory — left out.

## Decision

1. `TmaxServer.startSocket()` registers an auto-bound class-property handler
   (`onMemoryPressure`) next to the existing SIGTERM/SIGINT registrations;
   `shutdown()` detaches it (`process.off`) so test servers sharing one
   process never accumulate listeners or react after death.
2. `handleMemoryPressure(level)` — public, for direct testing — clears the
   interpreter parse cache on **either** level (rebuild cost is µs, so
   dropping early is harmless) and records a `memory-pressure` daemon event
   (`editor.logDaemonEvent`, the SPEC-047 event buffer) carrying the level
   and the dropped-parse count. The body is defensive by contract — a
   memory-pressure hook must never throw (optional-chained accessors,
   best-effort try/catch around both the clear and the observability write).
3. Not adopted: dropping persisted snapshots (user data), export/render
   caches (negligible reclaim — recorded above for the next visitor).

## Consequences

- The daemon sheds its largest re-derivable allocation the moment the OS
  asks, instead of waiting to be killed; the edit path re-parses on demand
  at µs cost.
- Wiring is mutation-proven: with the registration line removed, exactly the
  emit-through-real-wiring test and the listener-count test fail; the
  direct-call test still passes.
- Gates: typecheck:src + typecheck:test clean ✅;
  `server-memory-pressure` 3/3 ✅; `server-daemon-hardening` 17/17 ✅
  (socket semantics untouched); `interpreter-parse-cache` 10/10 ✅.
- Accepted asymmetries (verify-gate round 1 — explicitly accepted, not
  fixed): the pre-existing SIGTERM/SIGINT handlers registered in
  startSocket are not detached in shutdown (their lifecycle is out of
  scope here), so memoryPressure is the only signal-family registration
  that detaches — necessary because test servers share one process.
  The dropped-parse count is read-before-clear, best-effort observability:
  under-reporting is acceptable under the never-throw contract.
