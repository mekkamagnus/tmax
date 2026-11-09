# SPEC-235 — Verify daemon socket lifecycle under Bun 1.4 EADDRINUSE semantics

Issue: #235 — verify + pin socket lifecycle under Bun 1.4 (EADDRINUSE bind, `.sock` cleanup on close)
Status: implementing
Date: 2026-11-10

## Goal

Bun 1.4 changed Unix-socket binding: `bind()` on an occupied path now fails with `EADDRINUSE` (1.3 silently unlinked/stole the name), and the socket file is cleaned up on `close()`. Verify tmax's daemon lifecycle holds under both changes — happy path, racing daemons, stale recovery, `tmax --stop`, and `tmax --sweep` — and pin the behaviors the changes could erode. Adjust sweep/stop logic only if verification shows an invalidated assumption.

## Design

tmax never binds onto an occupied name by design: `acquireSocket` (`src/server/server.ts`) probes a live daemon (→ loud `Daemon already running` error), unlinks a stale socket file, then takes a lock file (`wx`-create) with stale-lock reclaim. The lock is the primary race guard; 1.4's `EADDRINUSE` is a **backstop** for the sub-window between unlink and `listen()` — where 1.3 would have let the loser silently steal the socket, 1.4 makes the loser fail loudly. The `.sock`-cleanup-on-close change only makes shutdown's existing `removeFile` calls (`server.ts` shutdown path, `sweep.ts` reap) idempotent no-ops — both already swallow `ENOENT`.

Verification, not rework — with one adjustment verification forced:

- **Adjustment (found by the harness)**: `bin/tmax`'s `--daemon` wrapper pre-checked `is_running` and short-circuited with `Daemon already running` + **exit 0** when a daemon already held the socket — masking an occupied socket as a successful start for any wrapper/script checking exit status (the server's own acquisition path exits non-zero; the wrapper's pre-check preempted it). The wrapper now prints the message to stderr and exits 1, matching the server. No repo caller relied on the old exit 0 (`ensure_daemon` backgrounds `bun $DAEMON` directly; `src/main.ts --daemon` is a separate path).

- **Unit pins** (extend `test/unit/server-daemon-hardening.test.ts`): shutdown tolerates a socket file that vanished before `close()` completes (1.4 auto-cleanup); lock cleanup still fires in that case.
- **Live harness** (`scripts/verify-socket-lifecycle.sh`, re-runnable after future Bun bumps): happy start/stop; double `tmax --daemon` (second must fail loudly, non-zero exit); SIGKILL a daemon → next start reclaims the stale socket+lock; `tmax --stop` and `tmax --sweep --apply` on a killed daemon's remains.
- **Findings recorded** in the ADR, including the reasoning that the EADDRINUSE race window is not deterministically unit-testable (the unlink→listen sub-window) and that the lock guards the common race.

## Completion criteria

1. `bun run typecheck` green; `test:unit` green (including the new pins, run in the full `server-daemon-hardening.test.ts` file).
2. New unit test: shutdown resolves cleanly and removes the lock when the socket file was already removed (simulating 1.4 close-cleanup); fails only if the tolerance regresses.
3. `scripts/verify-socket-lifecycle.sh` exists, is idempotent/re-runnable, cleans up after itself, and exits non-zero on any failed check. It waits for a daemon **ping** (not socket-file existence — a stale file from a killed daemon satisfies `-S` instantly).
4. A live run of the harness on Bun 1.4.4 with all scenarios passing, output captured in the ADR.
5. Sweep/stop audit documented: either "no adjustment needed" with the reason each assumption survives 1.4, or the adjustment made (the one adjustment: the `bin/tmax --daemon` loud-exit fix above).
6. ADR-0260 + index line.

## Out of scope

Socket-lifecycle rework (#235 is verification; any rework found necessary becomes its own issue), `--isolate`/`--parallel` test isolation (#237/#239), memoryPressure (#243).
