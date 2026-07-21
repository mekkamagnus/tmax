# ADR-0117 — adw Process Supervisor (BUG-25)

## Status

Accepted

## Context

The adw pipeline (`adws/`) delegates work to long-running subprocesses — Claude/Codex agents and the tmax daemon started for validation. Those subprocesses spawn their own descendants (the daemon, test watchers). On completion, timeout, failure, or interrupt, the runner could exit while those descendants stayed alive, because the shared spawn primitive (`runRaw` in `dispatcher-runtime.ts`) had three gaps:

1. **No ownership after resolve.** `runRaw` held the child only for the duration of the promise; once it resolved on normal child exit, nothing remembered the tree, so orphaned descendants (e.g. a daemon the agent started) were reparented to PID 1 and never reaped. A host inventory found **72** `bun …/tmax.*/src/server/server.ts` daemons from finished adw runs holding ~8.5 GB across 144 leaked processes.
2. **Straight to SIGKILL on timeout, then resolve immediately** without awaiting tree exit, stranding anything that hadn't died yet.
3. **Detached spawn was opt-in and inconsistent** — only the 5-stage orchestrator set `detached: true`, so 2/3-stage descendants couldn't be safely group-killed.

No runner registered `SIGINT`/`SIGTERM` handlers, and every entry point terminated with `main().then((code) => process.exit(code))`, cutting off any async finalizer. The fix already shipped in the sibling `capoeirasport` repo (BUG-29) provided a proven reference.

## Decision

Introduce a dependency-free **`ProcessSupervisor`** (`adws/adws-modules/process-supervisor.ts`, ported from capoeirasport's BUG-29) as the single owner of every process tree one adw invocation launches, and route the shared spawn primitives through it.

- **Owned, detached process groups.** Managed commands spawn with `detached: true` so each child is a group leader (`PGID == child.pid`); descendants inherit that group, so `process.kill(-pgid)` reaches them even after the immediate wrapper exits and they are reparented to PID 1. No `pkill`/`killall`/name-based sweeps.
- **Graceful→force escalation that awaits exit.** Settle and shutdown terminate remaining descendants via `SIGTERM` → bounded grace window → `SIGKILL`, **awaiting confirmed tree exit before resolving**, escalating only the same owned tree.
- **Per-invocation ownership via a module-level active supervisor**, set once by the entrypoint wrapper before `main` and cleared in `finally`. This flows through the existing dependency-injected `deps` seam into every helper with zero call-site churn, stays backward-compatible (no supervisor configured ⇒ legacy behavior ⇒ unit tests unaffected), and is the one deliberate process-lifetime resource (like `process.env`) rather than a swappable service locator.
- **Single-flight `shutdown()`** (memoized promise + `AbortController`) and a resolved-PGID **`adopt(pid)`** for externally-spawned daemons whose group may differ from their PID.
- **`runAdwEntrypoint`** registers `SIGINT`/`SIGTERM` (→ 130/143) before `main`, awaits `shutdown()` in `finally`, and preserves exit codes. Because `adw-watchdog`'s `main` returns a never-resolving promise (it polls forever and exits only by signal), the signal handler itself awaits `shutdown()` then force-exits — the `finally` path is for one-shot runners.
- `runRaw`/`runCapture`/`spawnStage` delegate spawn+cleanup to the supervisor while preserving their `{ ok, exitCode, stdout, stderr }` contract, tee/live-label/timeout behavior, and timeout semantics; `spawnStage` is now detached for all orchestrators.
- An env-gated `ADW_PROCESS_CLEANUP_PROBE` lets lifecycle tests exercise each runner without invoking real Claude/Codex.

## Consequences

- **Positive:** every adw invocation owns its full subprocess tree and closes it on success/failure/timeout/signal; the leak class is closed and regression-tested (`process-supervisor.test.ts`, `test/unit/adw-process-cleanup.test.ts`). Centralizing subprocess capture (the prerequisite refactor in the prior commit) gave a single seam to make this change.
- **Negative:** supervisor-tracked spawns are always detached group leaders, so terminal Ctrl-C no longer propagates implicitly to children — but the explicit signal handler makes cleanup testable and more robust instead. `runRaw` resolution is delayed by the grace/force window only when descendants actually linger; well-behaved commands see a fast no-op terminate.
- **Residual:** a child stage killed *mid-cleanup* before its own supervisor reaps its (separately-grouped) grandchildren can still strand them; `adopt(pid)` is the forward-looking hook for tmux/browser-daemon cases but is not on the critical path for this bug.
- Pre-existing orphans from prior runs are intentionally not swept by this change; removing them requires a separate, PID-reviewed cleanup.
