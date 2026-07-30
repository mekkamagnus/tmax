# Bug: No way to sweep orphaned tmax daemons and stale sockets

## Bug Description

`bin/tmax --stop` stops exactly one daemon — the canonical one on
`${TMAX_SOCKET:-/tmp/tmax-${UID}/server}`. There is no mechanism to find or reap
**orphaned** tmax daemons (alive, reparented to PID 1, on a non-canonical socket —
the leak class ADR-0117 documented: 72 leaked daemons / ~8.5 GB) or to clean up
**stale** lock/socket files left by daemons that crashed or were killed. These
accumulate undetectably; the only way to find them today is manual `ps`/`lsof`.

ADR-0117 closed the leak *class* going forward (the supervisor reaps adw trees on
SIGINT/SIGTERM/SIGHUP) but explicitly deferred sweeping pre-existing orphans:
"removing them requires a separate, PID-reviewed cleanup." This is that cleanup.

**Expected:** `tmax --sweep` lists orphaned daemons + stale lock/socket files
(dry-run); `tmax --sweep --apply` reaps them. The canonical running daemon is
never touched unless `--force`.

**Actual:** no sweep exists; orphans and stale artifacts accumulate.

## Solution Statement

A PID-reviewed sweep utility (`src/server/sweep.ts`) invoked by `bin/tmax --sweep`:

1. **Discovery (lock-driven, PID-reviewed).** Enumerate lock files under
   `/tmp/tmax*` (every daemon writes `${socket}.lock` with `{pid, socketPath,
   startedAt, cwd}`). For each lock's `pid`, read the live process's command via
   `ps` and confirm it is a tmax daemon (`bun` + `src/server/server.ts` or the
   installed `bin/tmax`) — never a name-based `pkill`. A lock whose pid is dead, or
   whose pid is alive but no longer a tmax daemon (pid recycled), is **stale**.
2. **Classify** each live tmax daemon:
   - **canonical-live** — owns `/tmp/tmax-${UID}/server` → KEEP (unless `--force`).
   - **owned** — its parent (PPID) is alive (a running test/tool) → KEEP.
   - **orphan** — alive but PPID is dead (reparented to init) and non-canonical →
     reap candidate.
3. **Dry-run default** — print candidates (pid, socket, kind, age). `--apply` reaps.
4. **Graceful reap** — SIGTERM → bounded grace → SIGKILL, re-checking liveness
   after each (mirrors ADR-0117). Then remove the orphan's socket + lock.
5. **Stale cleanup** — remove lock + socket files whose pid is dead/recycled.

`--force` is the only way the canonical daemon is included.

## Steps to Reproduce

1. Kill a pipeline/tmax-use run mid-stage (or crash a daemon) so a tmax daemon on
   an isolated socket is orphaned (reparented to PID 1) and/or its lock/socket
   remain after exit.
2. `ps -Ao pid,ppid,command | grep server.ts` shows survivors; `ls /tmp/tmax-$(id -u)/`
   shows stale sockets/locks.
3. `tmax --stop` does not touch any of them (wrong socket). Nothing else does either.

## Root Cause Analysis

ADR-0117 deliberately scoped the supervisor to *future* adw-launched trees and
deferred pre-existing-orphan cleanup. `bin/tmax` only knows the canonical socket.
No tool enumerates stray daemons/locks, so they persist until manual cleanup.

## Relevant Files

- `src/server/sweep.ts` — **new**. Pure classify/discover functions (injectable
  `ps`/`kill` deps for testing) + a CLI `main`. **Primary implementation.**
- `bin/tmax` — add `--sweep [--apply] [--force]` → `bun "$PROJECT_DIR/src/server/sweep.ts"`.
- `test/unit/server-sweep.test.ts` — **new**. Unit tests for classify (mock `ps`:
  canonical-live, owned, orphan, stale-dead, stale-recycled) + integration test
  planting stale locks/sockets, asserting `--apply` removes them and a planted
  canonical entry survives.

## Validation Commands

```bash
bun test test/unit/server-sweep.test.ts   # classify + stale-cleanup + canonical-survives
bun run typecheck                          # tsc clean
tmax --sweep                               # dry-run lists candidates
```

## Acceptance Criteria

1. `tmax --sweep` is read-only (lists pid/socket/kind/age); `tmax --sweep --apply`
   reaps; `--force` is required to include the canonical daemon.
2. Discovery is PID-reviewed via each pid's live command line — no `pkill`/`killall`;
   non-tmax processes are never matched.
3. The canonical daemon on `/tmp/tmax-${UID}/server` is excluded by default.
4. Reap is SIGTERM → bounded grace → SIGKILL with a liveness re-check after each.
5. Stale lock + socket files (dead/recycled pid) are removed in `--apply`.
6. Unit tests cover all classify kinds; an integration test plants a stale lock +
   socket, runs `--apply`, and asserts removal + canonical survival.
7. `bun run typecheck` is clean.
