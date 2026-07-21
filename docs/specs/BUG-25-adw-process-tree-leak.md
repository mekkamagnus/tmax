# Bug: ADW runners leak tmax daemon and agent process trees

## Bug Description
The autonomous dev pipeline under `adws/` (11 executable runners) can leave tmax
daemon servers (`bun src/server/server.ts`, i.e. `bun run daemon`), delegated
Claude/Codex agent subprocesses, and their descendants running after an ADW
command completes, times out, fails, or is interrupted. Repeated ADW runs
accumulate orphaned processes that consume CPU and memory and eventually make
new subprocesses and tests slow or unreliable.

Concrete evidence: a process inventory taken on a host that also runs the
sibling `capoeirasport` repo showed **72** `bun
…/tmax.01KXV9YTGD/src/server/server.ts` processes reparented to PID 1 (`PPID=1`),
sharing stale process-group IDs whose original leaders had disappeared, holding
~8.5 GB of resident memory across 144 leaked processes total. Their paths point
at ADW-created `tmax.*` development worktrees, proving the parent (a delegated
agent run) exited without terminating the server it spawned.

Actual behavior: an ADW runner reports completion or exits while processes
started by its delegated agent/test stage can remain alive. Expected behavior:
each ADW invocation owns its complete subprocess trees, closes them before
returning on success/failure/timeout/signal, and never affects processes owned
by another ADW run or interactive task.

This is the same class of leak already fixed in the sibling `capoeirasport`
repo (see `../capoeirasport/specs/BUG-29-adw-playwright-process-cleanup.md` and
the reference implementation
`../capoeirasport/adws/adw-modules/process-supervisor.ts`). This spec ports that
fix to tmax's `adws/`, adapted to tmax's functional `Either`/`TaskEither` style
and its (already partially centralized) shell helpers.

## Problem Statement
The 11 runners route every external command through `runRaw` / `run` /
`runCapture` and `spawnStage` in `adws/adws-modules/dispatcher-runtime.ts`, but
that module implements only the most fragile corner of process lifecycle:

- On timeout, `runRaw` jumps **straight to `SIGKILL`** of the process group and
  **resolves immediately** without waiting for the tree to actually die
  (`dispatcher-runtime.ts` timeout handler, ~lines 193-205). There is no
  graceful `SIGTERM` window and no bounded escalation.
- Only the 5-stage orchestrator sets `detached: true`; the 2/3-stage
  orchestrators spawn non-detached children (`spawnStage` opt + comment,
  `dispatcher-runtime.ts:285-300`), so descendants of those children escape into
  a broader group the runner cannot safely terminate later.
- Once `runRaw` / `spawnStage` resolves, **nothing remembers the spawned tree**,
  so a later signal or normal exit cannot reap descendants the in-flight call
  left behind. The "killTree" concept appears only in comments
  (`dispatcher-runtime.ts:296`, `adw-plan-review-build-patch.ts:493`); there is
  no real tree-kill primitive, only inline `process.kill(-pid, "SIGKILL")`.
- All 11 entry points end with
  `if (import.meta.main) { main().then((code) => process.exit(code)); }`, which
  cuts off any asynchronous finalizer before owned resources are confirmed gone.
- **No runner registers `SIGINT` or `SIGTERM` handlers** (zero matches across
  `adws/*.ts`), so an interrupt kills the wrapper while the delegated agent's
  descendants survive.

The `adws/` directory therefore needs a small shared ownership-aware process
supervisor and a consistent top-level cleanup contract, covering normal
completion, timeout, startup failure, unexpected child exit, `SIGINT`, and
`SIGTERM`, while avoiding broad process-name cleanup.

## Solution Statement
Add a dependency-free `ProcessSupervisor` in
`adws/adws-modules/process-supervisor.ts` (ported from capoeirasport's BUG-29
supervisor, integrated with tmax's `Either`/`TaskEither` return shapes) and route
the existing shared helpers through it.

- Managed long-running commands (agent runs, the tmax daemon started for
  validation, child stages) run in invocation-owned POSIX process groups
  (`detached: true`, so each child is a group leader with `PGID == child.pid`);
  Windows is out of scope for tmax but the design keeps PID-tree targeting via
  `taskkill /T` for parity.
- On settle or shutdown the supervisor terminates remaining descendants
  **gracefully** (`SIGTERM` → bounded wait → `SIGKILL`), **awaits confirmed tree
  exit before resolving**, cancels the force timer on success, and escalates only
  the same owned tree.
- It exposes an idempotent single-flight `shutdown()` (memoized promise +
  `AbortController`) and a resolved-PGID `adopt(pid)` for any external daemon
  whose group may differ from its PID (parity with BUG-29; forward-looking for
  tmux/browser daemons).
- `runRaw` / `runCapture` / `spawnStage` in `dispatcher-runtime.ts` delegate
  spawn+cleanup to the supervisor while preserving their current
  `TaskEither<string, {ok, exitCode, stdout, stderr}>` contract, tee-to-file
  behavior, `liveLabel`, timeouts, and `timeoutMessage`.
- A new `runAdwEntrypoint({ label, main })` wrapper registers `SIGINT`/`SIGTERM`
  before `main`, awaits `shutdown()` in `finally`, preserves exit codes 130/143,
  and sets `process.exitCode` instead of calling `process.exit()`. All 11 runners
  switch to it.
- Cleanup never uses `pkill`, `killall`, executable-name matching, or process
  sweeps (none exist today and none will be added).

## Steps to Reproduce
1. After several `bun adws/adw-launch.ts` / `adw-build.ts` / `adw-test.ts` runs,
   run
   `ps -Ao pid=,ppid=,pgid=,etime=,command= | rg 'bun .*/tmax\..*src/server/server\.ts'`.
2. Observe tmax daemon servers from ADW-created `tmax.*` worktrees with
   `PPID=1` — their agent/shell parent exited without terminating them.
3. Run `bun adws/adw-build.ts <spec>` while its delegated implementation stage
   starts the daemon (`bun run daemon` / `bun src/server/server.ts`) for
   validation. On successful completion the daemon can still be alive because
   `runRaw`/`spawnStage` resolved without awaiting the tree.
4. Run `bun adws/adw-test.ts <spec>` and interrupt it with `SIGTERM` mid-stage.
   Observe the delegated agent's descendants (daemon, watchers) survive because
   no handler stops the pipeline and `process.exit()` fires immediately.
5. Inspect `adws/adws-modules/dispatcher-runtime.ts`: the timeout path calls
   `process.kill(-child.pid, "SIGKILL")` then resolves immediately, and
   `spawnStage` only sets `detached` for the 5-stage orchestrator.

## Root Cause Analysis
`runRaw` (in `adws/adws-modules/dispatcher-runtime.ts`) is the single shared
spawn primitive used (directly or via `run` / `runCapture`) by every runner and
by `spawnStage`. Its timeout handler (~lines 193-205) does:

```
if (opts.detached && child.pid) {
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
} else {
  try { child.kill("SIGKILL"); } catch {}
}
... resolve(Either.right({ ok: false, ... }));
```

Three defects follow from this:

1. **Straight to SIGKILL, then resolve immediately.** No graceful `SIGTERM`
   window is given, and the promise resolves right after signalling without
   waiting for the process (or its group) to disappear. A delegated agent that
   spawns the tmax daemon and then receives `SIGKILL` has its daemon reparented
   to PID 1 before anyone checks it exited.
2. **No ownership after the call returns.** `runRaw`/`spawnStage` hold the child
   only for the duration of the promise. Once they resolve, the tree is
   forgotten, so normal completion, a later stage, or a process-level signal
   cannot clean up leftovers. This explains the 72 `PPID=1` daemons.
3. **Detached is opt-in and inconsistent.** Only the 5-stage orchestrator sets
   `detached: true` (`spawnStage` opt, comment at `:295-299`); the 2/3-stage
   orchestrators and several direct callers do not, so their descendants inherit
   a broader group and cannot be safely group-killed later.

All 11 executable runners terminate with
`main().then((code) => process.exit(code))` (verified: `adw-build.ts:763-764`,
`adw-launch.ts:703-704`, `adw-patch-review.ts:547-548`,
`adw-plan-review-build-patch.ts:1668-1669`, `adw-plan-reviewspec-build.ts:447-448`,
`adw-plan-reviewspec.ts:450-451`, `adw-plan.ts:307-308`, `adw-spec-review.ts:424-425`,
`adw-status.ts:412-413`, `adw-test.ts:439-440`, `adw-watchdog.ts:791-792`).
Immediate `process.exit()` prevents an asynchronous finalizer from awaiting owned
resources. None of these files installs `SIGINT`/`SIGTERM` handlers (zero matches
in `adws/*.ts`), so an interrupt can orphan an in-flight delegated tree even when
the spawn was detached.

There is no real `killTree` primitive — the name appears only in comments
(`dispatcher-runtime.ts:296`, `adw-plan-review-build-patch.ts:493`). Existing
related fixes (`BUG-16` socket leak, `BUG-17` agents-dir leak, `BUG-18`
grandchild drain block) addressed drain/ordering symptoms but did not introduce
central process ownership. There are no regression tests under `adws/` or
`test/unit/adw-*.test.ts` that record child/descendant PIDs, interrupt a runner,
or assert bounded cleanup.

Note: tmax's `adws/` do **not** drive Playwright (no `playwright`/`cliDaemon`/
`chromium` references in `adws/**`). The Playwright-session-scoping portion of
capoeirasport's BUG-29 therefore does not apply here; the leak is server/agent
descendant trees. The supervisor's `adopt(pid)` is retained for parity and for
future daemon/tmux cases, but it is not on the critical path for this bug.

## Relevant Files
Use these files to fix the bug:

- `adws/adws-modules/dispatcher-runtime.ts` — Defines `runRaw` (the spawn
  primitive), `run`, `runCapture`, and `spawnStage`. The central place to make
  spawn + timeout + cleanup supervisor-aware: graceful→force escalation, await
  tree exit before resolving, ownership tracking, and `detached: true` for all
  child stages (not only the 5-stage orchestrator).
- `adws/adw-build.ts`, `adws/adw-test.ts`, `adws/adw-launch.ts`,
  `adws/adw-patch-review.ts`, `adws/adw-plan-review-build-patch.ts`,
  `adws/adw-plan-reviewspec-build.ts`, `adws/adw-plan-reviewspec.ts`,
  `adws/adw-plan.ts`, `adws/adw-spec-review.ts`, `adws/adw-status.ts`,
  `adws/adw-watchdog.ts` — The 11 executable runners. Each ends with
  `main().then((code) => process.exit(code))` and must switch to the awaited
  `runAdwEntrypoint` wrapper.
- `adws/adw-watchdog.ts` — Already uses `process.kill(pid, 0)` for liveness
  (`:511`); align its liveness checks with the supervisor's tree-alive helper.
- `../capoeirasport/adws/adw-modules/process-supervisor.ts` — **Reference
  implementation** to port from (the BUG-29 supervisor: owned spawn, single-path
  settlement, graceful→force escalation, single-flight `shutdown()`, resolved-PGID
  `adopt()`, `runAdwEntrypoint`, env-gated cleanup probe).
- `../capoeirasport/specs/BUG-29-adw-playwright-process-cleanup.md` — Prior-art
  spec documenting the design rationale and the residual resolved-PGID fix.
- `test/unit/adw-*.test.ts` — Existing ADW unit test glob (run by
  `bun run test:adw`); add the runner-cleanup regression here so it is covered by
  the standard suite.

### New Files
- `adws/adws-modules/process-supervisor.ts` — Shared `ProcessSupervisor`
  (managed spawn, owned process-tree cleanup, graceful→force timeout/abort,
  single-flight `shutdown()`, resolved-PGID `adopt()`) plus `runAdwEntrypoint`.
  Adapted to return tmax's `Either`/`TaskEither` shapes and to avoid `try/catch`
  per the project's functional style.
- `adws/adws-modules/process-supervisor.test.ts` — Focused Bun tests for
  descendant cleanup, timeout escalation, idempotent shutdown, ownership
  isolation, and resolved-PGID adoption.
- `test/unit/adw-process-cleanup.test.ts` — Runner-level regression: each entry
  point's probe path exits 130/143 on signal and removes every emitted
  child/grandchild PID; a successful-completion probe removes a lingering
  descendant via the top-level cleanup.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Port the ProcessSupervisor to tmax

**User Story**: As an ADW maintainer, I want one ownership-aware process
supervisor shared by every runner so that delegated agent/server trees are
always reaped on completion, timeout, or signal.

- Create `adws/adws-modules/process-supervisor.ts` porting
  `../capoeirasport/adws/adw-modules/process-supervisor.ts`.
- Keep the dependency-free design: `child_process.spawn` with
  `detached: process.platform !== "win32"`, `process.kill(-pgid, sig)` for group
  signalling, `taskkill /PID /T` on Windows.
- Preserve capoeirasport's invariants: per-invocation ownership (no global
  registry), single-path settlement (`settled` + in-flight `terminating` map),
  graceful `SIGTERM` → `waitForTreeExit(graceMs)` → `SIGKILL` →
  `waitForTreeExit(forceWaitMs)`, single-flight memoized `shutdown()` via
  `AbortController`, and `adopt(pid)` that resolves the real PGID via
  `ps -o pgid=` (returning `pid` when the process is already gone, throwing on
  genuine `ps` errors).
- Expose a `run()` whose return shape matches what tmax's `runRaw` produces
  (`{ ok, exitCode, stdout, stderr }`) so it can be wrapped in `Either`/
  `TaskEither` by `dispatcher-runtime.ts` without changing callers.
- Honor the project's functional style (no `try/catch` for control flow; use
  `Either`/`TaskEither` for fallible operations).

**Acceptance Criteria**:
- [ ] `adws/adws-modules/process-supervisor.ts` exists and exports
  `ProcessSupervisor` + `runAdwEntrypoint`.
- [ ] Spawning a detached wrapper that leaves a grandchild running, then
  settling, removes both PIDs.
- [ ] A grandchild that ignores `SIGTERM` is force-killed within the configured
  bound.
- [ ] `shutdown()` called concurrently multiple times awaits the same cleanup
  and never kills an unrelated process.
- [ ] `adopt(pid)` reaches a descendant whose PGID differs from its PID
  (resolved-PGID), and rejects invalid PIDs (`<= 1`, non-integer).

### 2. Route the shared shell helpers through the supervisor

**User Story**: As an ADW maintainer, I want `runRaw`/`runCapture`/`spawnStage`
to await tree exit and escalate gracefully so that timeouts no longer strand
descendants.

- In `adws/adws-modules/dispatcher-runtime.ts`, delegate the spawn + lifecycle
  of `runRaw` (and therefore `run`/`runCapture`) and `spawnStage` to the
  supervisor, preserving the existing `TaskEither<string, {ok, exitCode, stdout,
  stderr}>` contract, `teeTo` line-by-line tee, `liveLabel` filtering,
  `timeoutMs`, and `timeoutMessage`.
- Replace the straight-to-`SIGKILL`-then-resolve timeout path with the
  supervisor's graceful→force escalation that **awaits confirmed tree exit**
  before resolving.
- Make `spawnStage` set `detached: true` for all orchestrators (remove the
  5-stage-only restriction at `:285-300`) so every child stage is a group leader
  whose tree the supervisor can reach.
- Keep captured stdout/stderr, stdin support, and result types byte-for-byte
  compatible so no caller changes behavior.

**Acceptance Criteria**:
- [ ] `runRaw`/`runCapture` resolve only after the owned tree has exited
  (normal, timeout, abort, spawn error, non-zero exit).
- [ ] A timed-out command's whole group is terminated via `SIGTERM`→wait→`SIGKILL`,
  not an immediate `SIGKILL`.
- [ ] `spawnStage` children are group leaders for the 2/3-stage and 5-stage
  orchestrators alike.
- [ ] Existing `teeTo`/`liveLabel`/`timeoutMessage` behavior is unchanged.

### 3. Put every ADW entry point behind awaited cleanup

**User Story**: As an ADW maintainer, I want every runner to exit through an
awaited-cleanup wrapper so that owned resources are confirmed gone before the
process ends.

- Add `runAdwEntrypoint({ label, main })` (registers signals before `main`,
  awaits `shutdown()` in `finally`, sets `process.exitCode`).
- Replace each runner's
  `if (import.meta.main) { main().then((code) => process.exit(code)); }`
  with `runAdwEntrypoint({ label: "adw-<name>", main })` in all 11 files:
  `adw-build`, `adw-launch`, `adw-patch-review`, `adw-plan-review-build-patch`,
  `adw-plan-reviewspec-build`, `adw-plan-reviewspec`, `adw-plan`,
  `adw-spec-review`, `adw-status`, `adw-test`, `adw-watchdog`.
- Instantiate the supervisor at startup (before any child launch) and make it
  the single source of process ownership for the invocation.
- Add an env-gated test-only probe path (mirroring capoeirasport's
  `ADW_PROCESS_CLEANUP_PROBE`) so lifecycle tests can exercise each runner
  without invoking real Claude/Codex/GitHub.

**Acceptance Criteria**:
- [ ] No `process.exit(` remains in any of the 11 runners (verified by `rg`).
- [ ] Every runner instantiates the supervisor and exits via `runAdwEntrypoint`.
- [ ] `--help`/`--dry-run` on each runner still exits 0 through the new wrapper.

### 4. Add signal handling with conventional exit codes

**User Story**: As a developer interrupting a long ADW run, I want `SIGINT`/
`SIGTERM` to stop the run promptly and clean up, preserving 130/143 exit codes.

- In `runAdwEntrypoint`, register `SIGINT`→130 and `SIGTERM`→143 once, before
  `main`, calling the single-flight `shutdown()`.
- Ensure an abort propagates to the in-flight supervisor `run()`/`spawnStage()`
  (via the `AbortController`) so the active command is cancelled.
- Do not add a second, competing signal listener in any runner; the entry
  wrapper is the single handler.

**Acceptance Criteria**:
- [ ] `SIGINT`/`SIGTERM` during a run yields exit codes 130/143 respectively.
- [ ] The in-flight command is aborted and its tree reaped on signal.
- [ ] Exactly one signal listener is registered per invocation.

### 5. Add process-lifecycle regression tests

**User Story**: As an ADW maintainer, I want regression tests that prove
descendants are reaped on success, timeout, and signal so this leak cannot
silently return.

- In `adws/adws-modules/process-supervisor.test.ts`: descendant-left-by-success,
  force-escalation, stdin/output capture, timeout, spawn error, idempotent
  shutdown, unrelated-survives, resolved-PGID adopt (non-detached and detached).
- In `test/unit/adw-process-cleanup.test.ts`: exercise each runner's probe path,
  send `SIGTERM`, assert exit 143 and death of every emitted child/grandchild
  PID; add a successful-completion probe whose wrapper exits while a daemon
  descendant remains and assert the top-level cleanup removes it.
- Register any test-spawned stray process in an `afterEach` safety net (kill both
  the group and the raw PID).

**Acceptance Criteria**:
- [ ] `bun test adws/adws-modules/process-supervisor.test.ts` passes.
- [ ] `bun test test/unit/adw-process-cleanup.test.ts` passes, including the
  signal and successful-completion probes for the runners.

### 6. Run the validation commands

**User Story**: As the implementer, I want every validation command green before
declaring the bug fixed.

- Execute every command in `Validation Commands` in order.
- Use captured PIDs and unique test markers as the pass/fail oracle;
  machine-wide counts are diagnostic only because other dev tasks may be active.

**Acceptance Criteria**:
- [ ] All `Validation Commands` pass with zero regressions.
- [ ] Post-validation inventory contains no process whose unique marker belongs
  to the validation run.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Run
from the tmax repo root (`cd ../tmax` from capoeirasport).

- `ps -Ao pid=,ppid=,pgid=,etime=,command= | rg 'bun .*/tmax\..*src/server/server\.ts' || true` —
  Capture the pre-fix diagnostic inventory without killing or attributing
  unrelated processes.
- `cd ../tmax && bun test adws/adws-modules/process-supervisor.test.ts` — Verify
  the shared ownership and process-tree cleanup primitive, including resolved-PGID
  adoption.
- `cd ../tmax && bun test test/unit/adw-process-cleanup.test.ts` — Verify
  signal, success, and timeout cleanup across the ADW runners.
- `cd ../tmax && bun run test:adw` — Run the ADW unit-test glob to confirm no
  regressions in existing adw tests.
- `cd ../tmax && bun run typecheck` — Confirm the supervisor + runner edits
  typecheck across all tsconfig projects.
- `cd ../tmax && bun adws/adw-build.ts --help` — Validate the build runner exits
  cleanly through the new finalizer.
- `cd ../tmax && bun adws/adw-test.ts --help` — Validate the test runner entry
  point exits cleanly.
- `cd ../tmax && bun adws/adw-launch.ts --help` — Validate the launch runner
  entry point exits cleanly.
- `cd ../tmax && ADW_PROCESS_CLEANUP_PROBE=signal bun adws/adw-test.ts` then send
  `SIGTERM` and assert the process exits **143** and every emitted
  child/grandchild PID is dead within a bounded window — Validates signal
  cleanup.
- `cd ../tmax && if ps -Ao pid=,ppid=,pgid=,command= | rg 'adw-process-cleanup-probe'; then exit 1; fi` —
  Fail if any validation-owned probe process survived.
- `cd ../tmax && bun run test` — Run the full tmax test suite to ensure the
  automation changes caused no project regressions.

## Notes
- This spec is the tmax port of capoeirasport's
  `BUG-29-adw-playwright-process-cleanup.md`. The reference supervisor
  implementation lives at `../capoeirasport/adws/adw-modules/process-supervisor.ts`
  and should be ported, not reinvented.
- **Naming difference**: tmax's module directory is `adws/adws-modules/`
  (plural), whereas capoeirasport's is `adws/adw-modules/` (singular). Place the
  new supervisor in `adws/adws-modules/`.
- **Style difference**: tmax's adws use functional `Either`/`TaskEither`
  (fp-ts-style) and avoid `try/catch` for control flow. The supervisor must
  integrate with that style and preserve the `{ok, exitCode, stdout, stderr}`
  contract that `runRaw` currently returns.
- **Scope difference**: tmax's `adws/` do not drive Playwright (no
  `playwright`/`cliDaemon`/`chromium` references under `adws/**`), so the
  Playwright-session-scoping work from BUG-29 does not apply. The leak is tmax
  daemon + agent descendant trees. The supervisor's `adopt(pid)` is retained for
  parity and for future tmux/daemon cases (tmax uses tmux heavily — see
  `adws/adws-modules/tmux-launcher.ts`).
- The existing orphans cleaned up during investigation (72 tmax daemons, etc.)
  are not addressed by this change; removing pre-existing orphans requires a
  separate, explicitly authorized, PID-reviewed cleanup (they may belong to
  other worktrees or active tasks).
- No new dependency is required; Bun/Node `child_process`, POSIX process groups,
  and signals are sufficient.
- The worktree hosting this work is unrelated to `capoeirasport`; limit all edits
  to the tmax files listed above and preserve any unrelated user changes.
