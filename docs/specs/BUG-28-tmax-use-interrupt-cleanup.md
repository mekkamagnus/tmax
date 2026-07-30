# Bug: tmax-use leaks workspace dirs when interrupted (no signal cleanup)

## Bug Description

`tmax-use` (the e2e playbook harness) creates a workspace dir per daemon instance
it launches (`/tmp/tmax-${uid}/tmax-use-<id>/`, `tmax-use/test/runner.ts:120`) and
cleans each one in the per-playbook `finally { cleanup(ctx) }` (`runner.ts:581`).
But the entry point `tmax-use/test/cli.ts` has the same two gaps ADR-0117 fixed for
adw:

1. **No signal handlers.** `cli.ts` registers no `SIGINT`/`SIGTERM`/`SIGHUP`
   handler. An interrupt (Ctrl-C, `tmux kill-window`, terminal hangup, or `kill`)
   default-terminates the process immediately, so the in-flight playbook's `finally`
   cleanup never runs and its workspace dir is leaked.
2. **Premature `process.exit`.** `main().then((code) => process.exit(code))`
   (`cli.ts:228`) is the anti-pattern ADR-0117 called out — `process.exit` cuts off
   pending async finalizers.

Observed: `/tmp/tmax-501/` held **45 leaked `tmax-use-29002-*` dirs** from a single
interrupted run (PID 29002 dead). A clean run leaves zero; an interrupted run leaks
one dir per playbook that had started.

**Expected:** An interrupt aborts the run cooperatively — the in-flight playbook's
`finally` cleanup drains, no new playbooks start, then the process exits. No leaked
workspace dirs (except at most the single in-flight instance if interrupted
mid-step, which is accepted as residual).

**Actual:** An interrupt default-terminates tmax-use; cleanups are skipped; every
started playbook's workspace dir leaks.

## Problem Statement

`tmax-use` workspace dirs accumulate in `/tmp/tmax-${uid}/` whenever a run is
interrupted (Ctrl-C to abort a long suite, tmux kill-window, crash). 45 dirs from
one run is typical; over time this clutters `/tmp` and disk. The cleanup code
exists (`runner.ts:430 cleanup`, called in `finally:581`) but is unreachable on
interrupt because the entry point never installs signal handlers.

## Solution Statement

Add cooperative abort to the tmax-use entry, mirroring the cleanup-aware pattern
from ADR-0117/0119 but without a full process supervisor (tmax-use cleans per
playbook, not via a global tree owner):

1. **`cli.ts`**: create an `AbortController`. Register `SIGINT`/`SIGTERM`/`SIGHUP`
   handlers: the first signal sets `abortController.abort()` and writes a "aborting
   after current playbook" notice; a second signal force-exits (`process.exit(130)`).
   Pass `abortSignal` into `RunnerOptions`.
2. **`runner.ts` `runAll`**: check `opts.abortSignal?.aborted` at the top of each
   loop iteration (playbooks and tests) and `break` when set — so the in-flight
   playbook finishes (its `finally` cleanup drains) and no new ones start.
3. **`RunnerOptions`**: add optional `abortSignal?: AbortSignal` (backward
   compatible).

This prevents the bulk leak (one dir per already-started playbook) on interrupt.

**B. Remove the daemon home dir on close (normal AND interrupt).** `cleanup(ctx)`
only kills the buffer and unlinks temp files (`runner.ts:435`); neither it nor
`instance.close()` removes the per-instance home dir (`dirname(socketPath)` =
`/tmp/tmax-${uid}/tmax-use-<id>/`), so every playbook leaked its home dir even on a
clean exit (confirmed: a `_smoke` run left 1 dir before this change, 0 after). Add a
best-effort `fs.rm(dirname(instance.socketPath), { recursive, force })` after
`instance.close()` in both teardown sites (`runPlaybookTE` and `runTestFile`),
gated on `!opts.socketPath` (a caller-provided socket path owns its own lifecycle —
`launchSocketOpts`).

Residual: a single in-flight instance interrupted mid-step can still leak its home
dir (the `finally` may not reach the `rm`). That is one dir, not the per-playbook
accumulation this bug fixes.

## Steps to Reproduce

1. Run the full playbook suite: `tmax-use` (or `bun run test:tmax-use`).
2. Once several playbooks have run, interrupt with Ctrl-C (or kill the tmux window).
3. `ls /tmp/tmax-$(id -u)/ | grep tmax-use` — leaked workspace dirs remain.

(Inventory during this session found 45 such dirs from dead PID 29002; cleaned in
the same pass.)

## Root Cause Analysis

- `tmax-use/test/cli.ts:228` — `main().then((code) => process.exit(code))`, no
  signal handlers. Same anti-pattern ADR-0117 fixed for adw runners.
- `tmax-use/test/runner.ts:782 runAll` — no abort check between playbooks, so an
  interrupt has no cooperative way to stop after the current playbook drains; it
  default-terminates instead.
- `tmax-use/test/runner.ts` teardown — `cleanup(ctx)` (:435) and `instance.close()`
  never remove the daemon home dir (`dirname(socketPath)`), so it leaks on every
  run, interrupt or clean exit.

## Relevant Files

- `tmax-use/test/cli.ts` — entry; add `AbortController` + signal handlers, pass
  `abortSignal` into opts. **Primary fix site.**
- `tmax-use/test/runner.ts` — `RunnerOptions` (add `abortSignal?`); `runAll` loop
  (add `aborted` break checks).
- `tmax-use/src/instance.ts` / `client.ts` — existing per-instance cleanup (context
  only; the leak is that it is unreachable on interrupt, not that it is absent).

## Validation Commands

```bash
bun run typecheck:tmax-use                  # tsc clean on the changed harness
bun run typecheck                            # full typecheck
tmax-use tmax-use/playbooks/_smoke.yaml      # normal run still passes + leaves no dir
```

## Acceptance Criteria

1. `cli.ts` registers `SIGINT`/`SIGTERM`/`SIGHUP` handlers that abort the run
   cooperatively (first signal) and force-exit on a repeat signal.
2. `runAll` checks the abort signal between playbooks/tests and stops launching new
   ones once aborted, letting the in-flight playbook's cleanup drain.
3. `RunnerOptions.abortSignal?: AbortSignal` added (optional, backward compatible).
4. A normal `_smoke` run passes and leaves no `tmax-use-<pid>-*` workspace dir.
5. After `instance.close()` in both `runPlaybookTE` and `runTestFile`, the isolated
   daemon home dir is removed (best-effort), gated on `!opts.socketPath`.
6. `bun run typecheck` is clean.
