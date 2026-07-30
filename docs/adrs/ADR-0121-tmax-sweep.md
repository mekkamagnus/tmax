# ADR-0121 — `tmax --sweep`: PID-reviewed orphan-daemon cleanup (BUG-29)

## Status

Accepted

## Context

`bin/tmax --stop` stops exactly one daemon — the canonical one on
`/tmp/tmax-<uid>/server`. ADR-0117 closed the *future* leak class (the adw
supervisor reaps process trees on SIGINT/SIGTERM/SIGHUP) but explicitly deferred
sweeping **pre-existing** orphans: *"removing them requires a separate,
PID-reviewed cleanup."* Until now there was no such tool: orphaned daemons
(alive, reparented to init, on a non-canonical socket — the 72-daemon / ~8.5 GB
incident ADR-0117 cited) and stale lock/socket files from crashed or killed
daemons accumulated undetectably, findable only by manual `ps`/`lsof`.

A key observation during design: the canonical daemon may have **no lock file**
(a running `bun ~/.bun/bin/tmax` was found listening on the canonical socket with
no `server.lock`). Lock-driven discovery alone would miss it, so discovery must be
**process-driven**.

## Decision

Add `tmax --sweep` (`src/server/sweep.ts`, wired through `bin/tmax`) — a
PID-reviewed sweep, dry-run by default:

- **Process-driven, PID-reviewed discovery.** Scan `ps` for tmax daemons by
  inspecting each pid's command line against a daemon signature
  (`bun …/src/server/server.ts` or `bun …/bin/tmax`). There is **no** name-based
  `pkill`/`killall`; `tmaxclient`, the bash launcher, and unrelated processes can
  never be matched.
- **Classify each live daemon.** Canonical = owns `/tmp/tmax-<uid>/server`
  (`lsof -t -U`) → **kept** unless `--force`. Non-canonical with a live parent
  (running test/tool) = `owned` → kept. Non-canonical reparented to init
  (`ppid ≤ 1` or parent gone) = `orphan` → reap candidate.
- **Stale-lock cleanup.** Lock files whose pid is dead, or alive but no longer a
  tmax daemon (pid recycled), are removed along with their socket files. A
  recycled pid is **never signalled** (it belongs to an unrelated process) — only
  its stale files go.
- **Reap** is SIGTERM → bounded grace → SIGKILL, re-checking liveness after each
  (mirrors ADR-0117). `--apply` reaps; `--force` is the only path that includes
  the canonical daemon.

The pure classifiers (`isTmaxDaemonCommand`, `classifyLiveDaemon`,
`classifyStaleLock`) are exported and unit-tested with mock `ps`/`lsof`/`kill`
deps.

## Consequences

- **Positive:** operators can list and reap leaked daemons and stale sockets
  (`tmax --sweep` / `--apply`), closing ADR-0117's deferred residual. Discovery is
  PID-reviewed and the canonical daemon is protected by default, so the tool is
  safe to run while tmax is in use (verified: a live `--sweep` dry-run finds the
  canonical daemon and reports 0 candidates without touching it).
- **Negative:** an orphaned daemon that has **no lock** cannot have its socket
  file cleaned (the socket path is only known via the lock) — only the process is
  reaped. Accepted as residual; such daemons are rare (orphaned test daemons
  normally retain their lock).
- This complements ADR-0117/0119 (prevent new leaks) with the missing
  cleanup-the-past tool. It does not replace `tmax --stop` for the canonical
  daemon's normal shutdown.
