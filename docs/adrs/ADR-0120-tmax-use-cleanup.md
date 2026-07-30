# ADR-0120 — tmax-use cleans up workspace dirs on interrupt and close (BUG-28)

## Status

Accepted

## Context

`tmax-use` (the e2e playbook harness) launches a fresh, isolated tmax daemon per
playbook, homed at `/tmp/tmax-${uid}/tmax-use-<id>/` (the socket's parent dir). It
leaked those home dirs in two ways:

1. **On every run.** The per-playbook teardown called `cleanup(ctx)` (kills the
   buffer, unlinks temp files) and `instance.close()` (kills the daemon) but
   neither removed the home dir, so a clean `_smoke` run still left one dir behind.
2. **On interrupt, at scale.** The entry (`tmax-use/test/cli.ts`) registered no
   signal handlers and used `main().then((code) => process.exit(code))` — the same
   anti-pattern ADR-0117 fixed for adw. A Ctrl-C / `tmux kill-window` / hangup
   default-terminated the process before any `finally { cleanup }` drained, leaking
   one home dir per playbook that had started. An inventory found 45 such dirs from
   a single killed run (PID 29002).

This is the same leak class as BUG-25/BUG-27, but in the tmax-use harness, which
cleans up per-playbook rather than via a global process supervisor.

## Decision

Two complementary changes, both backward compatible:

- **Cooperative abort (interrupt path).** Add an `AbortController` and
  `SIGINT`/`SIGTERM`/`SIGHUP` handlers in `cli.ts`: the first signal aborts (the
  run stops launching new playbooks after the in-flight one's `finally` drains); a
  second signal force-exits `130`. Thread `abortSignal` through `RunnerOptions` and
  check `opts.abortSignal?.aborted` at the top of each `runAll` loop iteration.
- **Remove the home dir on close (every run).** After `instance.close()` in both
  teardown sites (`runPlaybookTE`, `runTestFile`), best-effort
  `fs.rm(dirname(instance.socketPath), { recursive, force })`, gated on
  `!opts.socketPath` (a caller-provided socket path owns its own lifecycle per
  `launchSocketOpts`).

tmax-use does not adopt the adw `ProcessSupervisor` — its cleanup unit is the
per-playbook context, not a globally-owned process tree — so a cooperative-abort
flag plus explicit home-dir removal is the proportionate fix.

## Consequences

- **Positive:** a normal `_smoke` run now leaves zero `tmax-use-<pid>-*` dirs
  (verified: `before == after == 0`); an interrupt aborts after the in-flight
  playbook drains instead of leaking every started dir. The change is typecheck-clean
  and the smoke still passes.
- **Negative:** a second-signal force-exit (or an interrupt that lands mid-step
  before the `finally` reaches `fs.rm`) can still leak the single in-flight home
  dir — accepted as residual (one dir, not the per-playbook accumulation).
- **Compatibility:** `RunnerOptions.abortSignal` is optional; callers that don't set
  it behave exactly as before. This complements ADR-0117/0119 (adw process trees)
  by covering the tmax-use harness's own artifact lifecycle.
