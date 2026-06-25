# Bug: Patch-review gate grandchild drain block

## Status

**Mostly fixed.** Earlier test-stage bugs are already fixed and are context-only for this spec:
1. ✅ **Parser**: `lastBunSummaryCount()` grabs the LAST summary line, not the first. Bun emits intermediate summaries after each test file.
2. ✅ **Batch resolve + budget**: `adws/adws-modules/tester.ts` now uses `resolveUnitTests` / `resolveE2eTests` and `TRACK_BUDGET_MS` instead of a per-failure resolve loop.
3. ✅ **Test-stage direct commands**: `adws/adws-modules/tester.ts` now runs `bun test --timeout 30000 test/unit/` and `bin/tmax-use test` directly.
4. ✅ **Patch-review direct commands**: `adws/adws-modules/patch-reviewer.ts` now runs `bun test --timeout 30000 test/unit/` and `bin/tmax-use test` directly (was `bun run test:unit`).
5. ✅ **Patch-review drain-safe runRaw/runCapture**: `adws/adw-patch-review.ts` now has the drain-safe `trySettle` pattern + wall-clock timeout + `detached: true`.
6. ✅ **Stall-detector removed**: The stall-detector that false-killed patch-review during long gate runs has been removed entirely.
7. ❌ **Remaining: API 529 rate limit on concurrent patch-review**: Two pipelines (SPEC-065 + BUG-20) running patch-review simultaneously hit `claude -p`'s 529 rate_limit error after 10 retries. The `adw-patch-review.ts` dispatcher treats this as exit code 2 (infra error) and fails the stage. The dispatcher should retry the audit `claude -p` call on 529 (with exponential backoff) before giving up.

**Context — two specs that were being worked on when this was found:**
- **SPEC-065** (worktree isolation): passed plan→review→build→test (3189 pass / 0 fail). Failed at patch-review due to 529.
- **BUG-20** (worktree duplication): passed plan→review→build→test (3149 pass / 1 fail). Failed at patch-review due to 529.

Neither spec is "finished" — both are blocked at patch-review by the 529. Once the retry-on-529 fix lands, both should be resumable at patch-review.

## Bug Description

### Prior fixed bugs (context only)

These were separate earlier bugs in the same area. Do not reimplement them as part of this spec:

- The test-stage parser selected Bun's first intermediate summary instead of the final summary. That parser bug was fixed by `lastBunSummaryCount()`.
- The test-stage resolve loop dispatched one `claude -p` per failure. That was fixed by batching failures through `resolveUnitTests` / `resolveE2eTests` in `adws/adws-modules/tester.ts`.
- The test-stage runner used `bun run test:unit` / `bun run test:tmax-use`. That was fixed by spawning `bun test --timeout 30000 test/unit/` and `bin/tmax-use test` directly in `adws/adws-modules/tester.ts`.

### Current bug (remaining)

Patch-review still has the grandchild drain-block bug:
- `adws/adws-modules/patch-reviewer.ts` runs the unit gate as `bun run test:unit`.
- `adws/adws-modules/patch-reviewer.ts` runs the optional tmax-use gate as `bun run test:tmax-use`.
- `adws/adw-patch-review.ts` `runRaw` resolves on `close` without waiting for stdout/stderr `end`.
- `adws/adw-patch-review.ts` `runCapture` has the same close-first settlement shape while teeing stdout.

When a gate uses `bun run <script>` with process-group timeout handling, Bun's task runner creates an extra process layer. The direct child can close before all inherited stdio pipe writers have produced EOF, so close-first helpers can settle with truncated output or hang until timeout. Patch-review must use the same direct-command and drain-safe subprocess behavior that the test stage now uses.

## Problem Statement

Patch-review's gate runner still spawns `bun run` wrappers for commands that already have direct equivalents. The patch-review dispatcher also lacks the drain-safe subprocess settlement used by `adws/adw-test.ts`.

The remaining bug is not the parser bug and not the old test-stage resolve explosion. Those are prior fixed bugs. The current bug is: patch-review gates can hang, timeout, or report incomplete output because the gate commands and dispatcher subprocess helpers do not yet match the fixed test-stage behavior.

## Solution Statement

Use direct gate commands in `patch-reviewer.ts` and copy the drain-safe subprocess behavior from `adws/adw-test.ts` into `adws/adw-patch-review.ts`.

Patch-review should keep `bun run typecheck:src` because it has no direct replacement specified here. It should change only the unit and tmax-use test gates:
- unit: `bun test --timeout 30000 test/unit/`
- tmax-use: `bin/tmax-use test`

## Steps to Reproduce

1. In `adws/adws-modules/patch-reviewer.ts`, leave the current gate commands unchanged.
2. Run patch-review on a workspace that reaches the gate phase: `bun adws/adw-patch-review.ts --id <existing-build-workspace-id> docs/specs/BUG-18-test-stage-grandchild-drain-block.md`.
3. Observe that patch-review gates invoke `bun run test:unit` and, when tmax-use targets exist, `bun run test:tmax-use`.
4. With the current `adws/adw-patch-review.ts` close-first `runRaw`, gate output can be truncated or timeout instead of cleanly settling after stdout/stderr drain.

## Root Cause Analysis

The patch-review path did not receive the same fixes as the test stage. The test-stage fixes are in `adws/adws-modules/tester.ts` and `adws/adw-test.ts`; the patch-review equivalents are still stale.

The current root cause is the combination of:
1. `patch-reviewer.ts` unit and tmax-use gates spawning `bun run` wrappers instead of direct commands.
2. `adw-patch-review.ts` subprocess helpers resolving on child `close` without requiring `stdout` and `stderr` `end`.
3. Missing timeout/process-group cleanup in `adw-patch-review.ts`, so hung descendants are not killed consistently.

## Relevant Files

### Existing Files to Modify

- **`adws/adws-modules/tester.ts`** — context only. Already uses `resolveUnitTests`, `resolveE2eTests`, `TRACK_BUDGET_MS`, `bun test --timeout 30000 test/unit/`, and `bin/tmax-use test`. Do not edit for this spec unless a test expectation forces a small compatibility change.
- **`adws/adws-modules/patch-reviewer.ts`** — change patch-review gate commands and user-facing `safePhase` labels for unit and tmax-use gates.
- **`adws/adw-patch-review.ts`** — update local `runRaw` and `runCapture` to match the drain-safe settlement, timeout, `detached: true`, and process-group kill behavior already implemented in `adws/adw-test.ts`.
- **`test/unit/adw-patch-review-gates-phase.test.ts`** — update gate command and phase-label expectations for the direct patch-review gate commands.
- **`test/unit/adw-test.test.ts`** — context only unless existing assertions fail due to shared helper behavior. Do not add more batch/budget coverage here; that coverage already exists.

## Step by Step Tasks

### Task 1: Context-only — test-stage batch resolve already fixed

**User Story**: As a pipeline operator, I want the test-stage history documented without redoing already implemented work.

- No implementation task. Current `adws/adws-modules/tester.ts` contains `resolveUnitTests` and `resolveE2eTests`.
- `resolveUnitTests` is a function in `adws/adws-modules/tester.ts`, not a file.

**Acceptance Criteria**:
- [ ] No new implementation work is added for test-stage batch resolve.
- [ ] References name `adws/adws-modules/tester.ts` and `resolveUnitTests` accurately.

### Task 2: Context-only — test-stage wall-clock budget already fixed

**User Story**: As a pipeline operator, I want the test-stage budget history documented without redoing already implemented work.

- No implementation task. Current `adws/adws-modules/tester.ts` exports `TRACK_BUDGET_MS`.

**Acceptance Criteria**:
- [ ] No new implementation work is added for test-stage budget handling.

### Task 3: Context-only — test-stage tests already fixed

- No implementation task unless a current test fails while making the patch-review changes.
- Do not hardcode stale pass counts such as `39/39` or `41/41`.

**Acceptance Criteria**:
- [ ] `bun test test/unit/adw-test.test.ts` passes if run.

## Validation Commands

- `bun run typecheck:src` — zero errors.
- `bun test test/unit/adw-test.test.ts` — all pass.

## Problem Statement

The `bun run <script>` wrapper creates a process tree (`bun run` → `bun test`) that, with `detached: true`, can keep stdio pipes open after the direct child closes. In patch-review, the current `runRaw` / `runCapture` helpers also settle on `close` before stdout/stderr `end`. The result is either incomplete gate output or a timeout-driven failure path instead of a clean patch-review PASS/GAPS verdict.

## Solution Statement

**Spawn `bun test` directly instead of `bun run test:unit` in patch-review gates.** The `bun run` wrapper creates an avoidable extra process layer. `bun test --timeout 30000 test/unit/` is a single direct test process: it exits, streams drain, `close` + `end` events fire, `trySettle` runs, and the full output is captured.

Same fix for the patch-review tmax-use gate: `bin/tmax-use test` directly instead of `bun run test:tmax-use`.

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

- **`adws/adws-modules/patch-reviewer.ts`** — Two command changes:
  - Unit gate: `deps.runRaw("bun", ["run", "test:unit"], ...)` → `deps.runRaw("bun", ["test", "--timeout", "30000", "test/unit/"], ...)`
  - Optional tmax-use gate: `deps.runRaw("bun", ["run", "test:tmax-use"], ...)` → `deps.runRaw("bin/tmax-use", ["test"], ...)`
  - Update matching `safePhase` labels to `bun test --timeout 30000 test/unit/` and `bin/tmax-use test`. Keep the typecheck label as `bun run typecheck:src`.
- **`adws/adw-patch-review.ts`** — Copy/adapt the current `STAGE_RUN_TIMEOUT_MS`, `detached: true`, `trySettle`, and process-group SIGKILL behavior from `adws/adw-test.ts` into local `runRaw` and `runCapture`.
- **`test/unit/adw-patch-review-gates-phase.test.ts`** — Update expected `runRaw` calls and phase command strings for the direct unit and tmax-use gate commands.

## Step by Step Tasks

### Task 1: Fix the patch-review unit gate command

**User Story**: As a pipeline operator, I want patch-review to capture full unit-gate output so its gate verdict is based on complete data.

- In `patch-reviewer.ts`, change the unit gate `runRaw` call from `"bun", ["run", "test:unit"]` to `"bun", ["test", "--timeout", "30000", "test/unit/"]`.
- Change the corresponding `safePhase` command label from `bun run test:unit` to `bun test --timeout 30000 test/unit/`.

**Acceptance Criteria**:
- [ ] `patch-reviewer.ts` spawns `bun test --timeout 30000 test/unit/` directly, not `bun run test:unit`.
- [ ] `patch-reviewer.ts` emits the matching direct command in the `gates:unit` phase label.
- [ ] Comment explains why (grandchild drain block).

### Task 2: Fix the patch-review tmax-use gate command

**User Story**: As a pipeline operator, I want the patch-review tmax-use gate to drain properly too.

- In `patch-reviewer.ts`, change the optional tmax-use gate `runRaw` call from `"bun", ["run", "test:tmax-use"]` to `"bin/tmax-use", ["test"]`.
- Change the corresponding `safePhase` command label from `bun run test:tmax-use` to `bin/tmax-use test`.

**Acceptance Criteria**:
- [ ] `patch-reviewer.ts` spawns `bin/tmax-use test` directly.
- [ ] `patch-reviewer.ts` emits the matching direct command in the `gates:tmax-use` phase label.
- [ ] Comment explains the same grandchild issue.

### Task 3: Update patch-review gate tests

**User Story**: As a developer, I want the patch-review gate tests to assert the actual commands and phase labels.

- In `test/unit/adw-patch-review-gates-phase.test.ts`, update unit gate call expectations from `["run", "test:unit"]` to `["test", "--timeout", "30000", "test/unit/"]`.
- In `test/unit/adw-patch-review-gates-phase.test.ts`, update tmax-use gate call expectations from `cmd === "bun"` / `["run", "test:tmax-use"]` to `cmd === "bin/tmax-use"` / `["test"]`.
- Update phase-label expectations from `bun run test:unit` and `bun run test:tmax-use` to `bun test --timeout 30000 test/unit/` and `bin/tmax-use test`.

**Acceptance Criteria**:
- [ ] `bun test test/unit/adw-patch-review-gates-phase.test.ts` passes.
- [ ] The test explicitly covers both `runRaw` call args and user-facing phase command strings.

### Task 4: Fix patch-review dispatcher subprocess helpers

**User Story**: As a pipeline operator, I want patch-review to run its gates (typecheck + unit suite) without crashing, so it can produce a PASS/GAPS verdict.

- In `adws/adw-patch-review.ts`, add a `STAGE_RUN_TIMEOUT_MS` constant equivalent to the one in `adws/adw-test.ts`: use `Number(process.env.ADW_PATCH_REVIEW_STAGE_TIMEOUT_MS)` when positive, otherwise default to `1_200_000`.
- In `runRaw`, spawn with `detached: true` and track `settled`, `procClosed`, `stdoutEnded`, `stderrEnded`, and `exitCode`.
- In `runRaw`, settle only when `procClosed && stdoutEnded && stderrEnded`; clear the timer before resolving.
- In `runRaw`, on timeout, set `settled`, kill `-child.pid` with `SIGKILL` and fall back to `child.kill("SIGKILL")`, then resolve `Right({ ok: false, exitCode: -1, stdout, stderr: stderr + timeout message })`.
- In `runRaw`, on `error`, guard with `settled`, clear the timer, and resolve `Left(...)`; on `close`, guard with `settled`, set `procClosed` and `exitCode`, then call `trySettle`.
- In `runCapture`, apply the same `detached: true`, timeout, process-group kill, and `procClosed && stdoutEnded && stderrEnded` settlement behavior as `adw-test.ts`.
- In `runCapture`, preserve current behavior: return `Right(stdout.trim())` only on exit code 0; return `Left((stderr || stdout).trim() || ...)` on nonzero exit; tee stdout lines to `opts.teeTo` as data arrives.
- In `runCapture`, flush any partial `teeBuf` both on normal settlement and timeout before resolving. On timeout, return `Left` with a message containing the command and timeout.

**Acceptance Criteria**:
- [ ] `adw-patch-review.ts`'s `runRaw` and `runCapture` both have the drain-safe `trySettle` pattern (`procClosed + stdoutEnded + stderrEnded`).
- [ ] `adw-patch-review.ts`'s `runRaw` and `runCapture` both have `detached: true` + wall-clock timeout + process-group SIGKILL.
- [ ] `runCapture` flushes partial tee output before resolving on both normal completion and timeout.
- [ ] Patch-review does NOT crash with exit code 1 when running gates.

### Task 5: Validate

- Run typecheck + all affected test files. All pass.

**Acceptance Criteria**:
- [ ] `bun run typecheck:src` — zero errors.
- [ ] `bun test test/unit/adw-patch-review-gates-phase.test.ts` — all pass.
- [ ] `bun test test/unit/adw-test.test.ts` — all pass.

## Validation Commands

- `bun run typecheck:src` — zero errors.
- `bun test test/unit/adw-patch-review-gates-phase.test.ts` — all pass.
- `bun test test/unit/adw-test.test.ts` — all pass.
- Optional manual validation, requires an existing completed build workspace id whose `agents/<id>/adw-state.json` points at this spec or another build-ready spec:
  - `bun adws/adw-patch-review.ts --id <existing-build-workspace-id> docs/specs/BUG-18-test-stage-grandchild-drain-block.md`
  - Verify the gate phase reaches unit tests without using `bun run test:unit`, patch-review does not crash with exit code 1, and `agents/<existing-build-workspace-id>/patch-reviewer/gather.md` is written.

## Notes

- **Scope note:** This spec is no longer the implementation spec for the parser, batch-resolve, budget, or test-stage direct-command fixes. Those are prior fixed bugs. The remaining implementation work is patch-review gate direct commands plus patch-review dispatcher drain-safe subprocess handling.
- **The stale-worktree issue compounded this.** Even after the drain-safe + parser fixes were committed to main, the pipeline ran inside a worktree that was 7 commits behind main, so the fixes were invisible. But even with the worktree updated, the grandchild issue would have persisted — it's a fundamentally different bug from the drain race.
- **Why `detached: true` is still needed.** The `detached` flag is required for `process.kill(-pid, "SIGKILL")` (process-group kill on timeout) to work — it kills the whole tree, not just the direct child. Without `detached`, a hung grandchild would survive the timeout kill. The fix is to eliminate the grandchild (spawn directly), not to remove `detached`.
- **Verified without running the full suite.** The Node.js reproduction script confirmed: `spawn("bun", ["run", "test:unit"], { detached: true })` can leave streams undrained; `spawn("bun", ["test", ...], { detached: true })` drains promptly. Keep validation phrased as "all pass" unless the exact current test count is verified immediately before editing the spec.
