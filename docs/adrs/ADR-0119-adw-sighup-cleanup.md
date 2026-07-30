# ADR-0119 — adw handles SIGHUP for full cleanup coverage (BUG-27)

## Status

Accepted

## Context

ADR-0117 (BUG-25) introduced a `ProcessSupervisor` that owns every subprocess tree
an adw invocation launches and reaps it via `shutdown()` in `runAdwEntrypoint`'s
`finally` block. To make that cleanup fire on interrupts, the entrypoint registered
signal handlers — but only `SIGINT` (exit 130) and `SIGTERM` (exit 143)
(`adws/adws-modules/process-supervisor.ts`). `SIGHUP` was not registered.

That matters because `SIGHUP` is the signal delivered when an operator aborts a
stuck pipeline by killing its tmux window (`tmux kill-window`) or when the
controlling terminal hangs up — and killing the tmux window is the documented way
to stop a pipeline that adw-launch detaches specifically to outlive the terminal.
With no `SIGHUP` handler, Node applies the default disposition (terminate
immediately) and the `finally { shutdown() }` never runs. The owned subprocess
tree (claude/codex agents, the tmax daemon, test watchers) is reparented to PID 1
and never reaped — reopening the exact leak class ADR-0117 documented (it cited 72
leaked daemons / ~8.5 GB) via the one signal path the supervisor did not guard.

## Decision

Register `SIGHUP` in `runAdwEntrypoint` alongside `SIGINT`/`SIGTERM`, routing it
through the existing `handleSignal`:

```ts
const onSigHup = (): void => handleSignal(129); // 128 + SIGHUP(1)
process.once("SIGHUP", onSigHup);
// ...removed in finally beside the SIGINT/SIGTERM removals
```

`handleSignal` already idempotently records the exit code, reaps owned trees via
`supervisor.shutdown()`, and force-exits, so `SIGHUP` gets identical cleanup
semantics to `SIGINT`/`SIGTERM`. This does not affect tmux client detaching: a
client detaching from the tmux server does not deliver `SIGHUP` to the pane
process — only `kill-window` / a true controlling-terminal hangup does — so the
"survive terminal disconnect" property is preserved.

## Consequences

- **Positive:** `tmux kill-window` and terminal hangup now reap the full subprocess
  tree before the orchestrator exits (exit 129), closing the abort-path leak. The
  fix is regression-tested across all 11 runners
  (`test/unit/adw-process-cleanup.test.ts`: a SIGHUP probe asserting exit 129 and
  zero surviving descendants; without the handler the runner dies with a null exit
  code and the SIGTERM-ignoring grandchild survives).
- **Negative:** none material — `SIGHUP` cleanup is strictly additive and reuses
  the existing escalation path. The conventional exit-code set widens from
  `{130, 143}` to `{129, 130, 143}`.
- **Residual:** this covers adw-launched process trees. Pre-existing orphans from
  earlier runs, and non-adw tmax daemons on stray sockets, still require a separate
  PID-reviewed sweep (unchanged from ADR-0117's residual note).
