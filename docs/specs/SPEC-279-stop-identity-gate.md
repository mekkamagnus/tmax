# SPEC-279 — the `--stop` identity gate (#276)

## Goal

`tmax --stop` never signals an embedded session: the identity RPC gates
every signal, connection outcomes resolve first, and the SIGTERM
fallback fires only on a triple-verified pid.

## Design

- **`server-identity` RPC** (`lifecycle.ts`): `{mode, pid}` — the
  server's mode is set at construction (the embedded path in main.ts
  marks itself; the daemon default stands). Registered in the router,
  the guard map, the sync-policy table ("readonly"), and the RPC
  baseline (24→25).
- **The sequence** (`cli/stop-sequence.ts`, `runStopSequence(deps)`) —
  the issue's steps 0–5 verbatim; every effect INJECTED (SweepDeps):
  0. ENOENT → "Daemon not running", 0.
  1. refused → 250ms recheck → still refused → unlink → "Stale socket
     removed", 0; accepted → proceed.
  2. connected, identity no-reply (1s) → "server unresponsive — not
     signaling, socket left in place", 1 (NO unlink).
  3. embedded → the informational row, **exit 1** (the matrix's one
     stdout-with-1 exception); NEVER signaled.
  4. daemon → graceful shutdown RPC (1s) → 1s wait → socket gone →
     "Daemon stopped", 0.
  5. survives → the verification triple (identity re-check + exactly-
     one lsof pid matching + cmdline contains `--daemon`) → SIGTERM →
     "Daemon stopped (SIGTERM)", 0; alive → the warning row, 1; any
     triple failure → the owner-changed row, 1.
- **The wiring** (`cli/stop-sequence-deps.ts`): TmaxClient over the
  fixed socket (TMAX_SOCKET-aware), lsof/ps/kill — ONE HELD connection
  carries identity → graceful shutdown; a connected-but-silent server
  returns null while only ECONNREFUSED throws (the stale branch); an
  unlink failure reports owner-changed. BOTH `tmax --stop` (launcher)
  and `tmaxclient --stop` (client/cli.ts) route through the sequence.
- **The server-side gate**: the shutdown RPC answers
  `{ok: false, reason: "embedded"}` for an embedded server — the
  issue's design decision enforced at the RPC itself (any direct
  client; e2e-asserted). FAIL-CLOSED identity validation: malformed
  responses → the unresponsive row; only an explicit `daemon` mode ever
  receives the shutdown RPC. `isDaemonCmdline` matches both spawn
  forms (`--daemon` or `src/server/server.ts`).

## Completion criteria

- [x] Embedded session survives `--stop` (refused, never signaled) —
      the original repro: unit row + the LIVE e2e (embedded launched,
      refused, still usable — identity + keypress — quitting via `:q`)
- [x] Every matrix row tested (8 rows) + ENOENT vs
      refused-after-recheck + the verification triple's replacement at
      each boundary (6 replacement rows)
- [x] The playbook-shaped evidence = the e2e above (embedded → --stop →
      still USABLE → type → quit), recorded in
      `test/integration/stop-embedded.test.ts`
- [x] `server-identity` RPC (router + guard + policy + baseline 24→25)
      + ADR-0305 (decision, coexistence boundary, accepted pid-reuse
      risk)
