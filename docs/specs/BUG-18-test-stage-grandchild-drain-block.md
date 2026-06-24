# Bug: Test stage grandchild drain block — `bun run` wrapper prevents stdout/stderr `end` events

## Bug Description

The adw test stage (`adws/adws-modules/tester.ts`) runs the unit suite via `deps.runRaw("bun", ["run", "test:unit"], { cwd })`. The `bun run` wrapper spawns `bun test --timeout 30000 test/unit/` as a **grandchild** process. With `detached: true` on the spawn (required for process-group kill on timeout), the grandchild keeps the process group alive after the test suite finishes. Node's `close` event fires for the parent `bun run` process, but the piped `stdout`/`stderr` Readable streams **never emit `end`** because the grandchild holds the underlying file descriptors open.

The drain-safe `trySettle` in `runRaw` waits for `procClosed && stdoutEnded && stderrEnded` before resolving. Since `stdoutEnded` and `stderrEnded` never fire, `trySettle` never runs, and the `STAGE_RUN_TIMEOUT_MS` (20 min) timer eventually fires instead — resolving with whatever partial `stdout`/`stderr` was accumulated in the first few seconds (the first few `(pass)` markers, but not the summary line `3000 pass / 0 fail` at the end).

The parser then sees `passed=5, failed=0` (5 stray `(pass)` markers from the partial output), the resolve loop finds nothing to fix (0 failures), re-runs 3 times, and returns `verdict: gaps`. This wasted ~6 hours of pipeline time across multiple SPEC-065 runs.

**Expected:** `runRaw` captures the full suite output including the summary line; the parser reports `passed=~3000, failed=0`; the test stage returns `verdict: pass`.

**Actual:** `runRaw` resolves via timeout with partial output; the parser reports `passed=5, failed=0`; the test stage returns `verdict: gaps` after 3 wasted iterations.

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
