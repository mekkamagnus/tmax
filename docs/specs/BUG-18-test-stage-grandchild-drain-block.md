# Bug: Test stage parser + resolve-loop — intermediate summaries + per-failure resolve explosion

## Status

**Partially fixed.** Codex fixed the parser bug (intermediate summary line matching) in the first pass. A **new problem** was exposed: the resolve loop dispatches one `claude -p` per failure per cycle, and with the parser now correctly finding 15+ failures per suite run, the test stage runs for **68+ minutes** (12+ resolve subprocesses across 3 cycles). This update adds the new problem for codex's second pass.

## Bug Description

### Original bug (FIXED by codex)

~~The adw test stage ran the unit suite via `bun run test:unit`, creating a grandchild that blocked stream draining.~~

**The real root cause** (found by codex): Bun emits **intermediate summary lines** (`N pass / M fail`) after each test file completes during the full suite run. The parser's regex `(\d+)\s+pass` matched the **first** intermediate summary (5 pass from an early file), not the **last** (the final total). The output was always fully captured — the bug was purely in the parser grabbing the wrong line.

**Codex's fix:** `lastBunSummaryCount()` finds the LAST match, not the first. Plus `extractBunFailures()` improvements for `(fail)` markers, file headers, timing suffixes, and deduplication. 41/41 tests pass.

### New problem (NOT fixed — exposed by the parser fix)

With the parser now correctly extracting 15+ failures per suite run, the resolve loop in `runUnitTrack` (tester.ts lines 367-393) **dispatches one `claude -p` resolve per failure, per cycle**:

```ts
// Line 369: for each failure, dispatch a separate resolve
for (const failure of parsed.failures) {
  callbacks.onResolve?.(failure.name, cycle + 1);
  await resolveUnitTest(deps, cwd, agentsDir, id, failure, model, cycle + 1).run();
}
```

With 15 failures and `MAX_UNIT_ITERATIONS = 2` (3 cycles total):
- Cycle 1: suite runs (~13 min) → finds 15 failures → dispatches 15 resolves (~60 min)
- Cycle 2: suite re-runs (~13 min) → finds remaining failures → dispatches more resolves (~40 min)
- Cycle 3: suite re-runs (~13 min) → dispatches more resolves (~40 min)

**Total: ~180 min (3 hours)** for a test stage that should take ~40 min max. Observed: 68 min with 12 resolves before being killed — the stage was nowhere near done.

**Expected:** The test stage completes in a bounded time (~30-40 min max), with the resolve loop either fixing failures or giving up after a reasonable budget.

**Actual:** The test stage runs for hours, dispatching dozens of sequential `claude -p` subprocesses, each taking ~4 min, because it resolves failures one-at-a-time-per-cycle with no overall wall-clock or resolve-count budget.

## Problem Statement

The resolve loop's iteration cap (`MAX_UNIT_ITERATIONS = 2`) bounds the number of **suite re-runs** (3 total) but does NOT bound:
1. **Total resolve subprocesses** — 15 failures × 3 cycles = up to 45 `claude -p` calls
2. **Total wall time** — no overall timeout on the track; each resolve + suite run adds ~17 min
3. **Resolve parallelism** — all resolves are sequential (`await` in a for-loop), so 15 resolves = 60 min of serial waiting

The loop needs either:
- A **batch resolve** (one `claude -p` call that gets ALL failures at once, not one per failure), OR
- A **resolve-count cap** (e.g. max 5 resolves per cycle), OR
- A **wall-clock budget** (e.g. if the track has run > 30 min, stop resolving and return gaps), OR
- All three

## Solution Statement

**Batch resolve:** Instead of dispatching one `claude -p` per failure (lines 369-381), collect all failures into a single resolve prompt and dispatch ONE `claude -p` call per cycle. This reduces 15 resolves × 4 min = 60 min to 1 resolve × 5 min = 5 min per cycle. The resolve prompt already includes the failure name + error message — just concatenate all of them.

Additionally, add a **wall-clock budget** per track (default 30 min): if `Date.now() - start > budget`, stop resolving and return `gaps` with whatever the last parse showed. This prevents unbounded growth even if batch resolve introduces new failures.

## Steps to Reproduce

1. Have a codebase where the full unit suite has 10+ failing tests
2. Run `bun adws/adw-test.ts <spec> --id <id>` (or the test stage via the orchestrator)
3. Observe: the test stage dispatches one `claude -p` per failure per cycle
4. With 15 failures: 15 resolves in cycle 1 (~60 min), then suite re-run (~13 min), then more resolves
5. Total wall time: hours, not minutes

## Root Cause Analysis

The resolve loop was designed when the parser returned 0-1 failures (because the parser bug meant `failed=0` even when there were real failures). With the parser now correctly finding 15+ failures, the per-failure resolve design becomes pathological. The fix is to batch all failures into a single resolve call — the `claude -p` model can handle a prompt with 15 failure descriptions (each ~200 chars = 3KB total, well within context limits).

## Relevant Files

### Existing Files to Modify

- **`adws/adws-modules/tester.ts`** — `runUnitTrack` lines 367-393: replace the per-failure for-loop with a single batched `resolveUnitTest` call that concatenates all failures. Also add a wall-clock budget check.
- **`resolveUnitTest`** — update to accept an array of `TestFailure` instead of a single one, and build a prompt that lists all failures.

## Step by Step Tasks

### Task 1: Batch the unit-track resolve

**User Story**: As a pipeline operator, I want the test stage to resolve all failures in one `claude -p` call per cycle, so the stage completes in minutes, not hours.

- In `runUnitTrack`, replace the per-failure for-loop (lines 369-381) with a single call to a new `resolveUnitTests` (plural) that takes `parsed.failures` as an array.
- `resolveUnitTests` builds a prompt: "The following unit tests are failing. Fix the root cause for each. Failures:\n" + all failure names + messages.
- Dispatch ONE `claude -p` via `deps.runCapture`, tee to `agents/{id}/tester/unit-resolve-it{N}.jsonl`.
- Same for the e2e track (`runE2eTrack`).

**Acceptance Criteria**:
- [ ] Exactly ONE `claude -p` resolve per cycle (not one per failure)
- [ ] With 15 failures, cycle 1 takes ~5 min (1 resolve), not ~60 min (15 resolves)
- [ ] The resolve prompt includes all failure names + messages

### Task 2: Add a wall-clock budget per track

**User Story**: As a pipeline operator, I want the test stage to give up after a bounded time, so it can't run for hours.

- Add `TRACK_BUDGET_MS = 30 * 60 * 1000` (30 min) constant.
- In `runUnitTrack` and `runE2eTrack`, before each resolve cycle: check `Date.now() - start > TRACK_BUDGET_MS`. If exceeded, break the loop and return the last `TrackResult` with `ok: false`.

**Acceptance Criteria**:
- [ ] If the track has run > 30 min, it stops resolving and returns `gaps`
- [ ] The `results.json` records the actual elapsed time

### Task 3: Update unit tests

- Update `test/unit/adw-test.test.ts` mock tests to verify batch resolve: `runCapture` is called once per cycle (not once per failure).
- Add a test for the wall-clock budget: mock a slow clock that exceeds the budget after 1 cycle.

**Acceptance Criteria**:
- [ ] Mock tests verify 1 resolve call per cycle (not N)
- [ ] Budget test verifies the loop stops early

## Validation Commands

- `bun run typecheck:src` — zero errors.
- `bun test test/unit/adw-test.test.ts` — all pass (including new batch/budget tests).
- Manual: run `bun adws/adw-test.ts <spec>` on a codebase with 10+ failing tests and verify the stage completes in < 10 min (1 batch resolve per cycle, not 10+ serial resolves).

## Problem Statement

The `bun run <script>` wrapper creates a process tree (`bun run` → `bun test`) that, with `detached: true`, keeps the stdio pipes open after the grandchild finishes. This defeats the drain-safe `runRaw` pattern, which correctly waits for stream `end` events but those events never fire. The result is a 20-minute timeout that resolves with truncated output, producing a false `gaps` verdict and wasting hours of resolve-loop time.

## Solution Statement

**Spawn `bun test` directly instead of `bun run test:unit`.** The `bun run` wrapper is the sole cause of the grandchild — removing it eliminates the orphaned process group entirely. `bun test --timeout 30000 test/unit/` is a single process: it exits, streams drain, `close` + `end` events fire, `trySettle` runs, and the full output (including the summary line) is captured.

Same fix for the e2e track: `bin/tmax-use test` directly instead of `bun run test:tmax-use`.

## Steps to Reproduce

1. In a Node.js script, spawn `bun run test:unit` with `detached: true` and `stdio: ['ignore', 'pipe', 'pipe']`.
2. Register `close`, `stdout.end`, and `stderr.end` listeners.
3. Observe: after the suite finishes, `close` fires for the `bun run` parent, but **`stdout.end` and `stderr.end` never fire** because the grandchild `bun test` keeps the pipes open.
4. After 20 min, the timeout timer fires with partial output.
5. Contrast: spawn `bun test --timeout 30000 test/unit/` directly → `close`, `stdout.end`, and `stderr.end` all fire promptly. Full output captured.

## Root Cause Analysis

**`bun run <script>` spawns a grandchild.** The `package.json` script `test:unit` is `bun test --timeout 30000 test/unit/`. When you `spawn("bun", ["run", "test:unit"])`, bun's task runner:
1. Reads `package.json`, finds the `test:unit` script.
2. Spawns `bun test --timeout 30000 test/unit/` as a child process.
3. Pipes its own stdio to the child.
4. Waits for the child to exit, then exits itself.

With `detached: true`, the child (`bun test`) becomes the process-group leader. When `bun test` finishes, it exits — but Node.js's `child_process` module tracks the **direct child** (`bun run`), not the grandchild. The grandchild's exit triggers the group leader exit, which triggers `bun run`'s exit, which triggers Node's `close` event. However, the stdio pipes are shared at the OS level: the grandchild inherited the parent's pipe FDs, and even after both processes exit, the **kernel may not close the write end of the pipe** until the process group is fully reaped. This prevents Node from seeing EOF on the pipe, so `stdout.end`/`stderr.end` never fire.

Spawning `bun test` directly eliminates the intermediate `bun run` layer — there's no grandchild, no process-group FD inheritance issue, and the streams drain cleanly.

## Relevant Files

Use these files to fix the bug:

### Existing Files to Modify

- **`adws/adws-modules/tester.ts`** — Two changes:
  - Line 319: `deps.runRaw("bun", ["run", "test:unit"], ...)` → `deps.runRaw("bun", ["test", "--timeout", "30000", "test/unit/"], ...)`
  - Line 493-497: `deps.runRaw("bun", ["run", "test:tmax-use", ...], ...)` → `deps.runRaw("bin/tmax-use", ["test", ...], ...)`
- **`test/unit/adw-test.test.ts`** — Update the mock in `passUnitFailE2eDeps` to match the new e2e command (`bin/tmax-use` instead of `bun run test:tmax-use`).

## Step by Step Tasks

### Task 1: Fix the unit track command

**User Story**: As a pipeline operator, I want the test stage to capture full suite output so the parser reports accurate pass/fail counts.

- In `tester.ts`, change the unit-track `runRaw` call from `"bun", ["run", "test:unit"]` to `"bun", ["test", "--timeout", "30000", "test/unit/"]`.

**Acceptance Criteria**:
- [ ] `tester.ts` line 319 spawns `bun test` directly, not `bun run test:unit`.
- [ ] Comment explains why (grandchild drain block).

### Task 2: Fix the e2e track command

**User Story**: As a pipeline operator, I want the e2e track to drain properly too.

- In `tester.ts`, change the e2e-track `runRaw` call from `"bun", ["run", "test:tmax-use", ...]` to `"bin/tmax-use", ["test", ...]`.

**Acceptance Criteria**:
- [ ] `tester.ts` line 493 spawns `bin/tmax-use test` directly.
- [ ] Comment explains the same grandchild issue.

### Task 3: Fix the unit test mock

**User Story**: As a developer, I want the mocked e2e test to still work after the command change.

- In `test/unit/adw-test.test.ts`, update `passUnitFailE2eDeps` to match `cmd === "bin/tmax-use"` instead of `cmd === "bun" && script === "test:tmax-use"`.

**Acceptance Criteria**:
- [ ] `bun test test/unit/adw-test.test.ts` — 39/39 pass.

### Task 4: Validate

- Run typecheck + adw-test tests. All pass.

## Validation Commands

- `bun run typecheck:src` — zero errors.
- `bun test test/unit/adw-test.test.ts` — 39/39 pass (was 38/39 before mock fix).

## Notes

- **This is the real root cause of the entire `passed=5` saga.** The prior fixes (drain-safe `runRaw`, `(pass)`/`(fail)` parser, `runCapture` timeout) were all correct and necessary, but they were defeated by the grandchild holding the pipes open. The drain-safe pattern was waiting for `end` events that would never come — not because of a drain race, but because the grandchild kept the pipe FD alive.
- **The stale-worktree issue compounded this.** Even after the drain-safe + parser fixes were committed to main, the pipeline ran inside a worktree that was 7 commits behind main, so the fixes were invisible. But even with the worktree updated, the grandchild issue would have persisted — it's a fundamentally different bug from the drain race.
- **Why `detached: true` is still needed.** The `detached` flag is required for `process.kill(-pid, "SIGKILL")` (process-group kill on timeout) to work — it kills the whole tree, not just the direct child. Without `detached`, a hung grandchild would survive the timeout kill. The fix is to eliminate the grandchild (spawn directly), not to remove `detached`.
- **Verified without running the full suite.** The Node.js reproduction script confirmed: `spawn("bun", ["run", "test:unit"], { detached: true })` → streams never end; `spawn("bun", ["test", ...], { detached: true })` → streams end promptly. 39/39 unit tests pass.
