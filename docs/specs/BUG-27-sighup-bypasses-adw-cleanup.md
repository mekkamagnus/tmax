# Bug: SIGHUP bypasses the adw process supervisor (tmux kill-window orphans subprocess trees)

## Bug Description

The adw process supervisor (`runAdwEntrypoint`, `adws/adws-modules/process-supervisor.ts`)
owns every subprocess tree an adw invocation launches and reaps it on exit via
`supervisor.shutdown()` in a `finally` block. To make that cleanup fire on
interrupts, it registers signal handlers — but **only `SIGINT` and `SIGTERM`**
(`process-supervisor.ts:387-388`). It does **not** register `SIGHUP`.

`SIGHUP` is exactly the signal delivered when an operator aborts a stuck pipeline
by killing its tmux window (`tmux kill-window`) or when the controlling terminal
hangs up. With no handler, Node applies the default action: terminate immediately,
**without** running the `finally { shutdown() }**. The owned subprocess tree
(claude/codex agents, the tmax daemon, test watchers) is reparented to PID 1 and
never reaped — the precise leak class BUG-25/ADR-0117 was meant to close, reached
via the one signal path it didn't cover.

**Expected:** `SIGHUP` triggers the same cleanup as `SIGINT`/`SIGTERM` —
`supervisor.shutdown()` reaps the owned tree, then the process exits `129`
(128 + SIGHUP(1)).

**Actual:** `SIGHUP` default-terminates the orchestrator; `shutdown()` never runs;
the subprocess tree is orphaned.

## Problem Statement

The documented way to stop a long-running adw pipeline is to kill its tmux window
(pipelines are launched detached in tmux precisely to outlive the terminal). Doing
so currently leaks the pipeline's entire subprocess tree. This re-opens the
daemon/process leak ADR-0117 documented (it cited 72 leaked daemons / ~8.5 GB) via
a path the supervisor doesn't guard. Operators have no reliable abort that also
cleans up.

## Solution Statement

Register `SIGHUP` in `runAdwEntrypoint` alongside `SIGINT`/`SIGTERM`, routing it
through the existing `handleSignal`:

```ts
const onSigHup = (): void => handleSignal(129);   // 128 + SIGHUP(1)
process.once("SIGHUP", onSigHup);
// ...
process.removeListener("SIGHUP", onSigHup);       // in finally, beside the others
```

`handleSignal` already idempotently sets the exit code, reaps owned trees via
`supervisor.shutdown()`, and force-exits — so SIGHUP gets identical cleanup
semantics to SIGINT/SIGTERM with a three-line addition. This does not affect tmux
detachment (a client detaching from the tmux server does not send SIGHUP to the
pane process — only `kill-window`/true hangup does), so "survive terminal
disconnect" behavior is preserved.

## Steps to Reproduce

1. Launch any multi-stage pipeline detached in tmux:
   `bun adws/adw-launch.ts --script adw-plan-review-build-patch.ts <spec>`.
2. Once a long stage (build/test) is running, abort it with
   `tmux kill-window -t tmax:<window>`.
3. Inspect the process table: `pgrep -fl 'src/server/server.ts|claude -p|codex'`.

The orchestrator exits (SIGHUP default action) but its children survive, reparented
to PID 1. (During this session, aborting workspace `01KY72CAFT`'s window after the
test stage finished left no orphans only because the active children had already
exited; aborting mid-stage leaks.)

## Root Cause Analysis

`runAdwEntrypoint` (`process-supervisor.ts:385-388`) registers:

```ts
const onSigInt = (): void => handleSignal(130);
const onSigTerm = (): void => handleSignal(143);
process.once("SIGINT", onSigInt);
process.once("SIGTERM", onSigTerm);
```

No `SIGHUP` registration. Node's default SIGHUP disposition is to terminate the
process without invoking `finally`. The supervisor's `shutdown()` therefore never
runs on hangup/kill-window, and the owned (detached, process-group-leading)
subprocess tree is stranded.

## Relevant Files

- `adws/adws-modules/process-supervisor.ts` — `runAdwEntrypoint`, lines 385-407.
  **Fix site** (add SIGHUP registration + removal).
- `test/unit/adw-process-cleanup.test.ts` — `signal probe` describe block (lines
  ~99-108) asserts SIGTERM → exit 143 + reaped descendants. Add a parallel SIGHUP
  probe asserting exit 129 + reaped descendants.

## Validation Commands

```bash
bun test test/unit/adw-process-cleanup.test.ts     # SIGHUP probe → exit 129, tree reaped
bun run typecheck                                   # tsc clean
```

## Acceptance Criteria

1. `runAdwEntrypoint` registers a `SIGHUP` handler routed through `handleSignal(129)`
   and removes it in `finally` beside the SIGINT/SIGTERM removals.
2. A SIGHUP-delivered probe exits `129` and every emitted descendant process is reaped.
3. `bun run typecheck` is clean.
4. SIGINT/SIGTERM behavior unchanged (existing signal-probe tests still pass).
