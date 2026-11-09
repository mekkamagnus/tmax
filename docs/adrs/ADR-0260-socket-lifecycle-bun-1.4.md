# Verify daemon socket lifecycle under Bun 1.4 EADDRINUSE semantics

## Status

Accepted (2026-11-10) — resolves #235 / SPEC-235. Child of the bun-v1.4.4-upgrade cluster (#233, landed).

## Context

Bun 1.4 changed Unix-socket binding: `bind()` on an occupied path now fails with `EADDRINUSE` (1.3 silently unlinked/stole the name), and the socket file is cleaned up on `close()`. tmax's daemon never binds onto an occupied name by design — `acquireSocket` probes a live daemon (loud `Daemon already running at <path>`), unlinks stale sockets, and guards startup with a lock file. The changes needed empirical verification, not redesign: #235 asked for proof the lifecycle holds and loud failures where 1.3 corrupted silently.

## Decision

**Keep the lifecycle as-is; fix the one place that masked loudness; pin the rest with tests + a re-runnable harness.**

- **`bin/tmax --daemon` now fails loudly when a daemon already holds the socket** (stderr message + exit 1, was stdout + exit 0). The wrapper's `is_running` pre-check short-circuited before the server's own non-zero acquisition path, so any script checking exit status saw "success" while no new daemon started. No repo caller relied on exit 0 (`ensure_daemon` backgrounds `bun $DAEMON` directly; `src/main.ts --daemon` is a separate path).
- **No sweep/stop changes needed.** Bun 1.4's `.sock`-cleanup-on-`close()` only makes shutdown's existing `removeFile` calls (`server.ts` shutdown, `sweep.ts` reap) idempotent no-ops — both already swallow `ENOENT`. `tmax --stop` verified clean; `--sweep --apply` reaps killed daemons' socket+lock remains.
- **The EADDRINUSE window is a backstop, not the guard.** The race it covers (between `acquireSocket`'s unlink and `listen()`) is not deterministically unit-testable; the lock file guards the common race, and where 1.3 let the loser silently steal the socket, 1.4 now makes the loser fail loudly via the server's error handler (`process.exit(1)`).
- **Unit pin added** (`server-daemon-hardening.test.ts`): shutdown tolerates the socket file already being gone (1.4's close-cleanup beating our unlink) and still removes the lock.
- **Live harness** (`scripts/verify-socket-lifecycle.sh`, re-runnable after any future Bun bump): happy start/eval/stop; double daemon (second fails loudly, rc=1, first unaffected); SIGKILL recovery (next start reclaims stale socket+lock and serves); sweep — sweep-attributed (the `--apply` report must itself claim the removals, so a pass can't ride on start's own reclaim path). Fails fast **without touching** a foreign daemon (verified: a pre-existing daemon survived the abort run). Captured transcript (Bun 1.4.4):

```
Bun 1.4.4 — socket /tmp/tmax-501/server
PASS  1a daemon started, socket up
PASS  1b eval round-trip
PASS  1c tmax --stop removed socket (+lock); close-cleanup + removeFile both tolerated
PASS  2a first daemon up
PASS  2b second daemon failed loudly (rc=1, diagnostic present)
PASS  2c first daemon unaffected
PASS  3a next start reclaimed the killed daemon's socket+lock
PASS  3b recovered daemon serves eval
PASS  4  tmax --sweep --apply removed killed-daemon remains (sweep-attributed)
ALL SOCKET-LIFECYCLE CHECKS PASSED
```

## Consequences

- Scripts/wrappers that treated `tmax --daemon`'s exit 0 as "a daemon is mine" now see rc=1 when one already runs — the correct signal for `--parallel` per-worker daemons (#239) and adw-style orchestration.
- Harness gotchas baked in: wait for a daemon **ping**, never socket-file existence (a killed daemon's stale file satisfies `-S` instantly); `pkill -f 'src/server.ts'` matches nothing (daemons run `src/server/server.ts`) — use `tmax --stop`.
- Verified on Bun 1.4.4 (`Bun 1.4.4 — socket /tmp/tmax-501/server`, all scenarios PASS, exit 0, twice).
- Gates: typecheck 4 projects rc=0; `server-daemon-hardening.test.ts` 17/17 (incl. new pin); `server-sweep`/`socket-path`/`server-daemon` 20/20; **CI run [42693459177](https://github.com/mekkamagnus/tmax/actions/runs/42693459177) green on `issue-235`** (full CI population incl. `test-tmax-use`, which drives the real `bin/tmax` flows the exit-code change touches).
