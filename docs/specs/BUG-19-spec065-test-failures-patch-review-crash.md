# Bug: SPEC-065 — 10 remaining test failures + patch-review crashes on empty gather

## Bug Description

Two distinct bugs block SPEC-065 (worktree isolation) from completing:

**Bug A — 10 unit test failures.** After the test-stage parser fix (BUG-18), the test stage correctly reports `passed=3179, failed=10`. The 10 failures are:
- 9 in `test/unit/adw-plan-resume-by-spec.test.ts` — the spec-path discovery tests call `runPipeline` with mocked deps but don't pass `mockWorktreeDeps` as the 4th argument. The orchestrator's `runPipeline` defaults `worktreeDeps` to `realWorktreeDeps`, which calls real git commands that fail inside the test's temp directory (same root cause as the 15 failures fixed in `adw-pipeline-loop.test.ts`).
- 1 in `test/unit/workspace.test.ts > findWorkspaceBySpecPath > matches on exact spec_path string` — likely a path-normalization mismatch after the `normalizeSpecPath` changes (SPEC-065 build + my `basename` fallback fix).
- ~10 duplicate failures appear in `test/unit/syntax/scopes/tlisp-scope.test.ts` — these are **test pollution** (the `adw-plan-resume-by-spec` test names appear inside the scope test's output, indicating shared global state or bun test isolation failure). Fixing the 9 real failures should eliminate these duplicates.

**Bug B — patch-review crashes with exit code 1 on every run.** Patch-review has crashed 7 times across 2 days, always with the same pattern:
- The `gather` event shows `files_changed: []` and `git_warning: 'no build base_sha; diff may include pre-existing dirty changes'`
- `gather.md` is **never written** (0 bytes / doesn't exist)
- `raw-output.jsonl` is **never written** (doesn't exist)
- The stage crashes with `exit code 1` within ~5 min of starting

The crash happens because patch-review runs **inside the worktree** (`../tmax.01KVSZNCP1`), but the `gather` step uses `git diff` to build the audit context. Since the worktree was created from main's HEAD and the build's changes are committed on the `adw/<id>` branch, `git diff` against the worktree's own HEAD shows **nothing changed** — the diff is empty because everything is committed. With an empty diff (`files_changed: []`), the gather step has no content to write, the auditor gets an empty `gather.md`, and `claude -p` either errors or produces no parseable verdict, causing exit code 1.

**Expected (Bug A):** All 3179+ tests pass; the 10 failures are mock-setup issues, not implementation gaps.

**Expected (Bug B):** Patch-review gathers the build's committed changes (the diff between `adw/<id>` and main) and produces a PASS/GAPS verdict.

**Actual (Bug A):** 10 tests fail because `mockWorktreeDeps` isn't passed.
**Actual (Bug B):** Patch-review crashes every time because the gather step finds an empty diff.

## Problem Statement

**Bug A:** The `adw-plan-resume-by-spec.test.ts` tests are the last holdout from SPEC-065's worktree-integration changes. They need the same `mockWorktreeDeps` fix applied to `adw-pipeline-loop.test.ts`. The `workspace.test.ts` failure needs a path-normalization check.

**Bug B:** Patch-review's gather step uses `git diff` to build the audit context, but inside a worktree where all changes are committed to the branch, the diff is empty. The gather step needs to diff against the **merge base** (where the worktree branched from main), not the worktree's own HEAD.

## Solution Statement

**Bug A:** Add `mockWorktreeDeps` to `adw-plan-resume-by-spec.test.ts` (same pattern as the `adw-pipeline-loop.test.ts` fix). Fix the `workspace.test.ts` path assertion.

**Bug B:** The `gatherContext` function in `patch-reviewer.ts` needs to use `git merge-base` (or `git diff <merge-base>..HEAD`) instead of a plain `git diff` when running inside a worktree. The merge base is where `adw/<id>` diverged from `main` — diffing from there captures all the build's committed changes. Alternatively, the orchestrator should record the `base_sha` (main's HEAD at worktree-creation time) in the workspace state and pass it to patch-review's `--diff-base` flag.

## Steps to Reproduce

### Bug A
```bash
# Run the 2 failing test files:
cd ../tmax.01KVSZNCP1  # (or main, same failures)
bun test test/unit/adw-plan-resume-by-spec.test.ts test/unit/workspace.test.ts
# Result: 10 fail
```

### Bug B
```bash
# Resume SPEC-065 at patch-review:
bun adws/adw-launch.ts --script adw-plan-review-build-patch.ts --resume 01KVSZNCP1 --from-stage patch-review
# Result: patch-review crashes with exit code 1 after ~5 min
# Check: agents/01KVSZNCP1/patch-reviewer/gather.md does not exist
# Check: agents/01KVSZNCP1/patch-reviewer/raw-output.jsonl does not exist
```

## Root Cause Analysis

### Bug A
`adw-plan-resume-by-spec.test.ts` calls `runPipeline(deps, args, agentsDir)` with only 3 arguments. The 4th argument (`worktreeDeps`) defaults to `realWorktreeDeps`, which calls real git commands. Inside the test's temp directory (which is not a git repo), these fail. The fix is identical to the `adw-pipeline-loop.test.ts` fix: define a `mockWorktreeDeps` object and pass it as the 4th argument.

The `workspace.test.ts` failure is likely the `normalizeSpecPath` basename fallback interacting with the test's expected path format.

### Bug B
The SPEC-065 worktree-isolation flow is:
1. Plan creates spec → commits to main
2. Create worktree on `adw/<id>` from main's HEAD
3. Build runs in worktree → edits files → commits (via `commitWorktreeChanges`)
4. Patch-review runs in worktree → `gatherContext` runs `git diff` → **empty diff** (everything is committed to the branch)

The gather step was designed for the old (non-worktree) flow where the build left uncommitted changes in the working tree. Inside a worktree where changes are committed, the diff needs to compare the branch against its merge base with main.

## Relevant Files

Use these files to fix the bug:

### Existing Files to Modify

- **`test/unit/adw-plan-resume-by-spec.test.ts`** — Add `mockWorktreeDeps` (same as `adw-pipeline-loop.test.ts`) and pass it as the 4th arg to all `runPipeline` calls. Also add the missing `TaskEither` import.
- **`test/unit/workspace.test.ts`** — Fix the `findWorkspaceBySpecPath > matches on exact spec_path string` test for the `normalizeSpecPath` basename fallback behavior.
- **`adws/adws-modules/patch-reviewer.ts`** — `gatherContext`: when running inside a worktree (detect via `ADW_WORKTREE` env or `worktree_path` in state), use `git merge-base <main> HEAD` to find the diff base, then `git diff <merge-base>..HEAD` to capture all committed changes. When NOT in a worktree, keep the existing `git diff` behavior.
- **`adws/adw-plan-review-build-patch.ts`** — Record `base_sha` (main's HEAD at worktree-creation time) in the workspace state, so patch-review can use `--diff-base <base_sha>`.

## Step by Step Tasks

### Task 1: Fix the 9 adw-plan-resume-by-spec test failures

**User Story**: As a developer, I want the spec-path discovery tests to pass so the full suite is green.

- Add `mockWorktreeDeps` to `test/unit/adw-plan-resume-by-spec.test.ts` (copy the exact object from `adw-pipeline-loop.test.ts`).
- Add `TaskEither` to the imports.
- Pass `mockWorktreeDeps` as the 4th argument to every `runPipeline(...)` call.

**Acceptance Criteria**:
- [ ] `bun test test/unit/adw-plan-resume-by-spec.test.ts` — 0 fail.
- [ ] The `mockWorktreeDeps.detectWorktree` mock returns `Right(false)`.

### Task 2: Fix the workspace.test.ts failure

**User Story**: As a developer, I want the workspace path tests to pass.

- Read the failing test and determine whether `normalizeSpecPath`'s basename fallback changes the expected path format.
- Fix the assertion to match the new behavior (basename fallback returns `{ relative: basename(input), absolute: input }`).

**Acceptance Criteria**:
- [ ] `bun test test/unit/workspace.test.ts` — 0 fail.

### Task 3: Fix patch-review gather for worktree (empty diff)

**User Story**: As a pipeline operator, I want patch-review to audit the build's committed changes inside a worktree, not crash on an empty diff.

- In `gatherContext` (`patch-reviewer.ts`): when `ADW_WORKTREE` is set OR the state has `worktree_path`, compute the merge base: `git merge-base main HEAD` (or use a recorded `base_sha` from state).
- Use `git diff <merge-base>..HEAD` instead of `git diff` (plain working-tree diff).
- If `base_sha` is recorded in the workspace state, prefer `git diff <base_sha>..HEAD`.
- When NOT in a worktree, keep the existing `git diff` behavior (backward compat).
- Ensure `gather.md` is always written — even if the diff is empty, write a note saying "no changes detected" so the auditor has something to read.

**Acceptance Criteria**:
- [ ] `gather.md` is always written (non-empty).
- [ ] Inside a worktree, `gather.md` contains the diff of committed changes (branch vs merge-base).
- [ ] Outside a worktree, behavior is unchanged (working-tree diff).
- [ ] Patch-review does NOT crash with exit code 1.

### Task 4: Record base_sha at worktree creation

**User Story**: As a pipeline operator, I want the orchestrator to record the base commit so patch-review knows what to diff against.

- In `adw-plan-review-build-patch.ts`, when creating the worktree: record `git rev-parse HEAD` (main's HEAD) as `base_sha` in the workspace state.
- Pass `base_sha` to patch-review's `--diff-base` flag (or let patch-review read it from state).

**Acceptance Criteria**:
- [ ] `adw-state.json` includes `base_sha` when a worktree is created.
- [ ] Patch-review uses `base_sha` for the diff when available.

### Task 5: Validate

- Run all validation commands. All must pass.

**Acceptance Criteria**:
- [ ] `bun test test/unit/adw-plan-resume-by-spec.test.ts test/unit/workspace.test.ts` — 0 fail.
- [ ] `bun test test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts` — 0 fail.
- [ ] `bun run typecheck:src` — 0 errors.
- [ ] `bun test test/unit/adw-test.test.ts` — all pass.

## Validation Commands

- `bun run typecheck:src` — zero errors.
- `bun test test/unit/adw-plan-resume-by-spec.test.ts` — 0 fail (was 9 fail).
- `bun test test/unit/workspace.test.ts` — 0 fail (was 1 fail).
- `bun test test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts` — 0 fail.
- `bun test test/unit/adw-test.test.ts` — all pass (44+ tests).
- Manual: resume SPEC-065 at patch-review and verify `gather.md` is written + patch-review produces a verdict (not exit code 1).

## Notes

- **The patch-review crash is SPEC-065-specific.** It only happens inside a worktree where changes are committed. In the old (non-worktree) flow, the build left uncommitted dirt and `git diff` captured it. The worktree flow commits everything, so the diff is empty. This is a direct consequence of SPEC-065's commit lifecycle (commitWorktreeChanges in finalize).
- **The test pollution in tlisp-scope.test.ts** (duplicate failures) should disappear once the 9 real failures in adw-plan-resume-by-spec.test.ts are fixed. Those are not real failures — bun's test isolation is leaking the test names across files. If they persist after fixing the 9, investigate bun's `--max-concurrency` or test-file isolation.
- **`base_sha` is the architecturally correct solution** for the diff problem. Recording it at worktree-creation time gives patch-review an unambiguous diff base, regardless of whether main has advanced since the worktree was created. The merge-base fallback is a safety net for when `base_sha` isn't recorded (backward compat).
- **Prior fixes that are confirmed working** (do NOT regress): the codex parser fix (`lastBunSummaryCount`), the batch resolve (`resolveUnitTests` plural), the wall-clock budget (`TRACK_BUDGET_MS`), the drain-safe `runRaw`/`runCapture`, the BUG-18 `bun test` direct spawn. These are all solid — this bug is about the remaining test failures and the patch-review gather crash, not the infrastructure.
