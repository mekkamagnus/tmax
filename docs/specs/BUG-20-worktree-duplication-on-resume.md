# Bug: Worktree isolation creates duplicate worktrees on every resume

## Bug Description

The SPEC-065 worktree-isolation feature creates a new sibling worktree for every pipeline run. But when resuming (`--resume <id> --from-stage <stage>`), the orchestrator does not reliably reuse the worktree already recorded in `state.worktree_path`. In the observed failure, resume attempts for workspaces with deterministic paths repeatedly re-entered the worktree creation path; when the recorded path or `adw/<id>` branch already existed, `git worktree add -b adw/<id> <path> HEAD` failed or left the orchestrator without a verified active worktree. Across many affected workspaces, this left **86 orphaned worktrees/branches** on disk.

**Expected:** Resume reuses the existing worktree from `state.worktree_path`. No new worktree is created.

**Actual:** Resume can attempt to create the deterministic worktree path `<repo>.<adw-id>/` again instead of validating/reusing `state.worktree_path`. Since the path and branch are deterministic, repeated resumes for the same workspace should hit path/branch conflicts, not create distinct new paths; the bug to prevent is entering creation instead of setting a verified `activeWorktreePath` from persisted state.

The 86 worktrees came from multiple workspaces (not just SPEC-065) — each workspace's resume cycles created worktrees that were never cleaned up.

## Problem Statement

86 orphaned git worktrees accumulated on disk, each consuming ~100MB of disk space and creating a branch that clutters `git branch`. The worktree-creation logic on resume is either missing the "reuse existing" guard, or the guard checks the wrong condition.

## Solution Statement

In `runPipeline`, separate stage execution from worktree preparation. Resume must not blindly set all setup work to skipped just because `state.worktree_path` exists:

1. Resume from `plan` must still run plan, then review/spec commit/worktree preparation as normal.
2. Resume from `review` must still run review/spec commit/worktree preparation as normal.
3. Resume from `build`, `test`, or `patch-review` must skip only worktree creation when a valid recorded worktree can be reused. Those stages must run with `activeWorktreePath` set and `ADW_WORKTREE=<activeWorktreePath>`.

The resume path should:

1. Load `state.worktree_path`, `state.branch`, and `state.base_sha` into `runPipeline` by either adding those fields to `ResumeContext` in `loadWorkspace`, or by re-reading `adw-state.json` in `runPipeline`. Prefer extending `ResumeContext` so resume state has a single source of truth.
2. If `state.worktree_path` is present, validate that it is a Git worktree for this repository on the expected branch (`state.branch`, normally `adw/<id>`). Use `git worktree list --porcelain`, or equivalent `git rev-parse --show-toplevel` + branch checks, rather than treating any existing directory as reusable.
3. If the recorded worktree is valid → set `activeWorktreePath` to it, emit `worktree-reused` with `{ path, branch }`, and do not call `createWorktree`.
4. If `state.worktree_path` exists as an arbitrary directory, a stale path for another repo, or a worktree on the wrong branch → fail with a clear error. Do not reuse it and do not overwrite it.
5. If `state.worktree_path` is recorded but missing → recreate the worktree from the original base SHA. Add a helper such as `createWorktreeFromBase(rootPath, branch, worktreePath, baseSha)` that runs `git worktree add -b <branch> <worktreePath> <baseSha>` when the branch does not exist.
6. If the branch already exists while recreating a missing path, reuse that branch with `git worktree add <worktreePath> <branch>` only after verifying the branch name matches `state.branch`. Do not delete/recreate the branch.
7. After recreation, update/confirm `state.worktree_path`, emit `worktree-created` with the original `from_sha`, and set `activeWorktreePath`.

`commitWorktreeChanges` should still run on successful pipeline completion. Worktree removal is out of scope for this bug and should not be added here.

## Steps to Reproduce

1. Launch a pipeline: `bun adws/adw-launch.ts "add feature X"` — creates worktree `tmax.01KVABC/`
2. Kill mid-build
3. Resume: `bun adws/adw-launch.ts --resume 01KVABC` — orchestrator re-enters creation instead of validating/reusing `state.worktree_path`; because `tmax.01KVABC/` and/or branch `adw/01KVABC` already exists, `createWorktree` returns Left, but the pipeline can continue without a verified `activeWorktreePath`
4. Repeat across many interrupted workspaces — stale worktrees/branches accumulate and resumes are not guaranteed to run in the intended isolated worktree

## Root Cause Analysis

The orchestrator's setup decision mixes two concerns: which stages still need to run (`plan`, `review`, `build`, `test`, `patch-review`) and whether the Git worktree needs to be created. On resume, `loadWorkspace` currently returns `ResumeContext` with fields such as `baseSha`, but not `worktree_path` or `branch`; `runPipeline` then falls back to deterministic sibling-path initialization instead of using the persisted worktree identity. The `createWorktree` call can fail because the path or branch already exists, and the pipeline may run without a verified active worktree.

The fix: make resume state carry the recorded worktree path/branch/base SHA into `runPipeline`, validate that the recorded path is the expected Git worktree, and skip only worktree creation when it is valid. Do not use `existsSync(state.worktree_path)` alone as the correctness check.

## Relevant Files

- **`adws/adw-plan-review-build-patch.ts`** — The `loadWorkspace`/`ResumeContext` and `runPipeline` functions: carry `worktree_path`/`branch`/`base_sha` into the resume path, split stage execution from worktree preparation, and set `activeWorktreePath` before build/test/patch-review.
- **`adws/adws-modules/worktree.ts`** — Add or reuse helpers to validate an existing worktree against expected repo/branch and to recreate a missing worktree from `base_sha`. Do not treat `createWorktree` failure for an existing path as successful reuse.

## Validation Commands

- `bun run typecheck:src` — zero errors.
- `bun test test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts` — all pass.
- Add a focused unit test in `test/unit/adw-pipeline-loop.test.ts` (or the nearest existing orchestrator resume suite) that seeds `adw-state.json` with `worktree_path`, `branch`, and `base_sha`, resumes from each post-setup stage (`build`, `test`, `patch-review`), and asserts:
  - `createWorktree` is not called.
  - `activeWorktreePath`/`ADW_WORKTREE` passed to stage deps is the recorded worktree path.
  - A `worktree-reused` event is emitted with the recorded path and branch.
- Add a second unit test for missing recorded worktree recreation that seeds `worktree_path`, `branch`, and `base_sha`, makes validation report the path missing, and asserts recreation uses the recorded `base_sha` and branch without deleting the branch.
- Manual: launch a pipeline, kill mid-build, resume — verify no new worktree is created (`git worktree list` shows the same worktrees before and after resume).

## Audit findings (adw-patch-review 2026-06-25T19:30:55.770Z)

**Verdict:** gaps

The implementation diff entirely addresses BUG-18 (API 529 rate-limit retry), not BUG-20 (worktree duplication on resume). Zero changes were made to either of the two files the spec explicitly requires — `adws/adw-plan-review-build-patch.ts` (where `ResumeContext` should be extended and resume worktree validation should live) and `adws/adws-modules/worktree.ts` (where `createWorktreeFromBase` should be added). `git diff d255eaa..HEAD --stat` confirms only BUG-18 files changed (claude-529-retry.ts, adw-build.ts, adw-test.ts, adw-patch-review.ts + 529 tests/ADR). The spec's central requirement — extending `ResumeContext` with `worktree_path`/`branch`/`base_sha` and validating the recorded worktree via `git worktree list --porcelain` rather than `existsSync` — is unfulfilled. The pre-existing resume path at `adws/adw-plan-review-build-patch.ts:981` still uses `existsSync(worktreePath)` alone, which the spec explicitly calls out as the bug to fix. The two spec-required resume tests are absent. Both gates the spec validates against (`typecheck:src`, `bun test test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts`) FAIL.

### Criteria
- **Resume from plan still runs plan, then review/spec-commit/worktree prep** — implemented: adws/adw-plan-review-build-patch.ts:863-864 (shouldRunPlan), :866-867 (shouldRunReview) — pre-existing logic, untouched by this diff but behaves per spec
- **Resume from review still runs review/spec-commit/worktree prep** — implemented: adws/adw-plan-review-build-patch.ts:866-867, setupPhases at :872-967 — pre-existing, unchanged
- **Resume from build/test/patch-review skips ONLY worktree creation when a valid recorded worktree can be reused** — partial: adws/adw-plan-review-build-patch.ts:978-1015 — does skip fresh setup, but uses existsSync alone (line 981) without any validity check; spec explicitly forbids this
- **Load state.worktree_path, state.branch, state.base_sha into runPipeline via ResumeContext (single source of truth)** — missing: adws/adw-plan-review-build-patch.ts:290-300 — ResumeContext interface has only baseSha (line 297); worktree_path and branch fields are absent. State still derives worktreePath from siblingWorktreePath(PROJECT_ROOT, id) at :770, not from state.worktree_path
- **Validate recorded worktree via `git worktree list --porcelain` or rev-parse --show-toplevel + branch checks** — missing: adws/adw-plan-review-build-patch.ts:981 — uses existsSync(worktreePath) alone. adws/adws-modules/worktree.ts has listWorktrees at line 16 but it is not invoked anywhere on the resume path
- **If valid: emit worktree-reused with {path, branch}, do not call createWorktree** — partial: adws/adw-plan-review-build-patch.ts:982-990 emits worktree-reused with path/branch/reason, but the emit is gated on the wrong condition (existsSync), so it can fire for invalid paths
- **If recorded path is arbitrary dir / wrong repo / wrong branch: fail with clear error, do not reuse, do not overwrite** — missing: adws/adw-plan-review-build-patch.ts:978-1015 has no failure path for these cases — any existing directory is silently reused
- **If recorded path missing: recreate via createWorktreeFromBase(rootPath, branch, worktreePath, baseSha) running `git worktree add -b <branch> <path> <baseSha>`** — missing: adws/adws-modules/worktree.ts:148-155 — only createWorktree exists (uses HEAD, not a base SHA). createWorktreeFromBase does not exist anywhere in the repo
- **If branch already exists when recreating missing path: reuse branch via `git worktree add <path> <branch>` only after verifying branch name matches state.branch** — missing: adws/adw-plan-review-build-patch.ts:998-1009 — calls createWorktree (which uses -b flag and fails if branch exists); no branch-exists branch-handling, no name verification
- **After recreation: update/confirm state.worktree_path, emit worktree-created with original from_sha, set activeWorktreePath** — missing: adws/adw-plan-review-build-patch.ts:1004-1008 emits event named 'worktree-recreated' (not 'worktree-created' as spec requires); from_sha is included but event name violates spec
- **commitWorktreeChanges still runs on successful pipeline completion** — implemented: pre-existing; not in diff but spec says it should keep running — no regression introduced
- **Worktree removal NOT added (out of scope)** — implemented: no removal logic added in the diff
- **Gate: bun run typecheck:src zero errors** — missing: gate results show typecheck:src → FAIL (exit 2)
- **Gate: bun test test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts all pass** — missing: gate results show test:unit → FAIL (exit 1)

### Tests
- **Resume from each post-setup stage (build, test, patch-review) with seeded worktree_path/branch/base_sha: assert createWorktree is NOT called** — uncovered: test/unit/adw-pipeline-loop.test.ts:478-548 — existing resume tests do not seed worktree_path and do not assert createWorktree call count; mockWorktreeDeps does not record createWorktree calls
- **Resume from post-setup stages: assert activeWorktreePath/ADW_WORKTREE passed to stage deps equals recorded worktree path** — uncovered: no test inspects the worktree path propagated to build/test/patch-review deps; mockWorktreeDeps at test/unit/adw-pipeline-loop.test.ts:93 is no-op
- **Resume from post-setup stages: assert worktree-reused event emitted with recorded path and branch** — uncovered: test/unit/adw-pipeline-loop.test.ts:292-310 asserts worktree-created with from_sha on fresh runs only; no resume-path assertion of worktree-reused
- **Missing recorded worktree recreation: seeds worktree_path/branch/base_sha, validation reports missing, asserts recreation uses recorded base_sha and branch without deleting branch** — uncovered: no such test exists; the only recreation test path (test/unit/adw-pipeline-loop.test.ts:292) is for fresh runs, uses HEAD not baseSha, and doesn't verify non-deletion
- **Detection of 529 rate-limit in claude -p output (is_error=true AND api_error_status=529)** — covered: test/unit/claude-529-retry.test.ts:50-57 (positive case), :54-56 (negative cases requiring both fields)
- **529 retry with exponential backoff until success** — covered: test/unit/claude-529-retry.test.ts:61-78 — but this is BUG-18 coverage, not BUG-20
- **Manual: kill mid-build + resume verifies no new worktree created (git worktree list unchanged)** — uncovered: spec requires manual verification; no automated or evidence-of-manual test provided for BUG-20

### Edge cases
- **Recorded worktree_path is an arbitrary directory (not a git worktree)** — missed: adws/adw-plan-review-build-patch.ts:981 — existsSync returns true for arbitrary dirs; orchestrator silently treats it as reusable
- **Recorded worktree_path is a stale path belonging to a different repository** — missed: no rev-parse --show-toplevel comparison against PROJECT_ROOT on resume path; adws/adws-modules/worktree.ts:106-115 has the rev-parse plumbing but it is not wired into resume validation
- **Recorded worktree_path is a valid worktree on the wrong branch (not adw/<id>)** — missed: no branch verification on the resume path; spec explicitly requires git worktree list --porcelain or equivalent branch check
- **Recorded worktree_path is missing on disk — must recreate from recorded base_sha (not HEAD) without deleting/recreating branch** — missed: adws/adw-plan-review-build-patch.ts:998 calls createWorktree which uses HEAD (adws/adws-modules/worktree.ts:154); spec requires createWorktreeFromBase with baseSha
- **Branch already exists when recreating missing path** — missed: createWorktree at adws/adws-modules/worktree.ts:148-155 uses `git worktree add -b` which fails if branch exists; no fallback to `git worktree add <path> <branch>` with branch-name verification
- **Resuming the same workspace repeatedly should NOT create distinct new worktrees/branches** — missed: deterministic path at adws/adw-plan-review-build-patch.ts:770 means repeated resumes re-enter creation path and hit conflicts — the exact bug the spec describes; no guard added in this diff
- **529 rate-limit during patch-review audit under concurrent pipelines (BUG-18 scope, NOT BUG-20)** — handled: adws/claude-529-retry.ts:79-106 with backoff [30s,60s,120s]; tests at test/unit/claude-529-retry.test.ts:61-78 — but this is the wrong bug's fix


## Audit findings (adw-patch-review 2026-06-25T20:52:39.205Z)

**Verdict:** gaps

The implementation diff is a BUG-18 fix (API 529 rate-limit retry with exponential backoff), not a BUG-20 fix (worktree duplication on resume). Zero changes were made to either file BUG-20 explicitly requires — `adws/adw-plan-review-build-patch.ts` (where `ResumeContext` should be extended with `worktree_path`/`branch`/`base_sha` and resume worktree validation should live) and `adws/adws-modules/worktree.ts` (where `createWorktreeFromBase` should be added). `git diff d255eaa..HEAD --stat` confirms only BUG-18 files changed. The spec's central requirement — extending `ResumeContext` and validating the recorded worktree via `git worktree list --porcelain` rather than `existsSync` — is entirely unfulfilled. The pre-existing resume path at `adws/adw-plan-review-build-patch.ts:1007` still uses `existsSync(worktreePath)` alone (the exact anti-pattern the spec calls out). The two spec-required resume tests are absent, and both gates the spec validates against (`typecheck:src`, `bun test test/unit/adw-pipeline*.test.ts`) FAIL per the gate results. The BUG-18 work that DID land (claude-529-retry.ts, ADR-0107, dispatcher wrappers in build/test/patch-review, and tests at test/unit/claude-529-retry.test.ts) is orthogonal to BUG-20 and does not address any BUG-20 acceptance criterion.

### Criteria
- **Resume from plan still runs plan, then review/spec-commit/worktree prep** — implemented: adws/adw-plan-review-build-patch.ts:863-864 (shouldRunPlan), :866-867 (shouldRunReview), setupPhases at :872-967 — pre-existing logic, untouched by this diff but behaves per spec
- **Resume from review still runs review/spec-commit/worktree prep** — implemented: adws/adw-plan-review-build-patch.ts:866-867, setupPhases at :872-967 — pre-existing, unchanged by this diff
- **Resume from build/test/patch-review skips ONLY worktree creation when a valid recorded worktree can be reused** — partial: adws/adw-plan-review-build-patch.ts:1004-1029 — the else-branch does skip fresh setup, but the validity check at :1007 is `existsSync(worktreePath)` alone, which the spec explicitly forbids; no repo/branch verification is performed before reuse
- **Load state.worktree_path, state.branch, state.base_sha into runPipeline via ResumeContext (single source of truth)** — missing: adws/adw-plan-review-build-patch.ts:290-299 — ResumeContext interface has only `baseSha` (line 298); `worktreePath` and `branch` fields are absent. State still derives worktreePath from `siblingWorktreePath(PROJECT_ROOT, id)` at :770, not from `state.worktree_path`
- **Validate recorded worktree via `git worktree list --porcelain` or rev-parse --show-toplevel + branch checks** — missing: adws/adw-plan-review-build-patch.ts:1007 uses `existsSync(worktreePath)` alone. adws/adws-modules/worktree.ts:372 has `listWorktrees` but it is not invoked anywhere on the resume path; `detectWorktree` (worktree.ts:104) is also not consulted on resume
- **If valid: emit `worktree-reused` with {path, branch}, do not call createWorktree** — partial: adws/adw-plan-review-build-patch.ts:1009-1015 emits `worktree-reused` with path/branch/reason, but the emit is gated on the wrong condition (`existsSync` at :1007), so it can fire for arbitrary dirs, stale paths, or wrong-branch worktrees
- **If recorded path is arbitrary dir / wrong repo / wrong branch: fail with clear error, do not reuse, do not overwrite** — missing: adws/adw-plan-review-build-patch.ts:1004-1029 has no failure path for these cases — any existing directory is silently reused; no rev-parse --show-toplevel comparison, no branch verification
- **If recorded path missing: recreate via `createWorktreeFromBase(rootPath, branch, worktreePath, baseSha)` running `git worktree add -b <branch> <path> <baseSha>`** — missing: adws/adws-modules/worktree.ts:148-157 — only `createWorktree` exists and uses HEAD (line 154). `createWorktreeFromBase` does not exist anywhere in the repo. Resume path at adw-plan-review-build-patch.ts:1018 calls `createWorktree`, not the spec-required baseSha variant
- **If branch already exists when recreating missing path: reuse branch via `git worktree add <path> <branch>` only after verifying branch name matches state.branch** — missing: adws/adws-modules/worktree.ts:154 uses `git worktree add -b <branch> ... HEAD` which fails if branch exists. No branch-existence fallback, no name verification, no test coverage. Resume path at adw-plan-review-build-patch.ts:1018 inherits this failure mode
- **After recreation: update/confirm state.worktree_path, emit `worktree-created` with original from_sha, set activeWorktreePath** — missing: adws/adw-plan-review-build-patch.ts:1024-1028 emits event named `worktree-recreated` (NOT `worktree-created` as spec requires); `from_sha` is included but the event name violates the spec contract
- **commitWorktreeChanges still runs on successful pipeline completion** — implemented: pre-existing behavior; spec says it should keep running — no regression introduced by this diff
- **Worktree removal NOT added (out of scope)** — implemented: no removal logic added in the diff — `removeWorktree` exists at worktree.ts:168 but is not newly invoked on resume
- **Gate: `bun run typecheck:src` zero errors** — missing: gate results: typecheck:src → FAIL (exit 2)
- **Gate: `bun test test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts` all pass** — missing: gate results: test:unit → FAIL (exit -1)

### Tests
- **Resume from each post-setup stage (build, test, patch-review) with seeded worktree_path/branch/base_sha: assert createWorktree is NOT called** — uncovered: test/unit/adw-pipeline-loop.test.ts:488-507 — existing resume tests do not seed worktree_path/branch/base_sha and do not assert createWorktree call count; mockWorktreeDeps.createWorktree at :102 is a no-op that does not record calls
- **Resume from post-setup stages: assert activeWorktreePath/ADW_WORKTREE passed to stage deps equals recorded worktree path** — uncovered: no test inspects the worktree path propagated to build/test/patch-review deps; mockWorktreeDeps at test/unit/adw-pipeline-loop.test.ts:98-105 has no spy on the path forwarded to children
- **Resume from post-setup stages: assert `worktree-reused` event emitted with recorded path and branch** — uncovered: test/unit/adw-pipeline-loop.test.ts:292-310 asserts worktree-created with from_sha on fresh runs only; no resume-path assertion of worktree-reused exists
- **Missing recorded worktree recreation: seeds worktree_path/branch/base_sha, validation reports missing, asserts recreation uses recorded base_sha and branch without deleting branch** — uncovered: no such test exists; the only recreation test path (test/unit/adw-pipeline-loop.test.ts:292) is for fresh runs, exercises createWorktree (HEAD, not baseSha), and does not verify non-deletion of the branch
- **Manual: kill mid-build + resume verifies no new worktree created (git worktree list unchanged)** — uncovered: spec requires manual verification; no automated test and no evidence-of-manual verification provided for BUG-20
- **Detection of 529 rate-limit in claude -p output (is_error=true AND api_error_status=529) — BUG-18 scope, NOT BUG-20** — covered: test/unit/claude-529-retry.test.ts:50-57 (positive case), :54-56 (negative cases requiring both fields) — but this covers BUG-18, not BUG-20
- **529 retry with exponential backoff until success — BUG-18 scope, NOT BUG-20** — covered: test/unit/claude-529-retry.test.ts:61-78 — but this is BUG-18 coverage, irrelevant to BUG-20 acceptance

### Edge cases
- **Recorded worktree_path is an arbitrary directory (not a git worktree)** — missed: adws/adw-plan-review-build-patch.ts:1007 — `existsSync` returns true for arbitrary dirs; orchestrator silently treats it as reusable and emits worktree-reused
- **Recorded worktree_path is a stale path belonging to a different repository** — missed: no rev-parse --show-toplevel comparison against PROJECT_ROOT on the resume path; adws/adws-modules/worktree.ts:106-115 has rev-parse plumbing in detectWorktree but it is not wired into resume validation
- **Recorded worktree_path is a valid worktree on the wrong branch (not adw/<id>)** — missed: no branch verification on the resume path; spec explicitly requires `git worktree list --porcelain` or equivalent branch check; adws/adws-modules/worktree.ts:372 listWorktrees exists but is unused here
- **Recorded worktree_path is missing on disk — must recreate from recorded base_sha (not HEAD) without deleting/recreating branch** — missed: adws/adw-plan-review-build-patch.ts:1018 calls createWorktree which uses HEAD (adws/adws-modules/worktree.ts:154); spec requires createWorktreeFromBase with baseSha, which does not exist
- **Branch already exists when recreating missing path** — missed: createWorktree at adws/adws-modules/worktree.ts:148-157 uses `git worktree add -b` which fails if branch exists; no fallback to `git worktree add <path> <branch>` with branch-name verification, and no test
- **Resuming the same workspace repeatedly should NOT create distinct new worktrees/branches (the central BUG-20 scenario)** — missed: deterministic path at adws/adw-plan-review-build-patch.ts:770 + existsSync-only guard at :1007 means repeated resumes re-enter creation/conflict paths — the exact bug the spec describes; no guard added in this diff
- **529 rate-limit during patch-review audit under concurrent pipelines (BUG-18 scope, NOT BUG-20)** — handled: adws/claude-529-retry.ts:79-106 with backoff [30s,60s,120s]; tests at test/unit/claude-529-retry.test.ts:61-78 — correctly handled but belongs to the wrong bug for this spec


## Audit findings (adw-patch-review 2026-06-25T21:58:55.760Z)

**Verdict:** gaps

The implementation diff is a BUG-18 fix (API 529 rate-limit retry with exponential backoff), not a BUG-20 fix (worktree duplication on resume). Zero changes were made to either file BUG-20 explicitly requires — `adws/adw-plan-review-build-patch.ts` (where `ResumeContext` must be extended with `worktree_path`/`branch`/`base_sha` and resume worktree validation must live) and `adws/adws-modules/worktree.ts` (where `createWorktreeFromBase` must be added). `git diff d255eaa..HEAD --stat` confirms only BUG-18 files changed: claude-529-retry.ts (new), ADR-0107 (new), claude-529-retry.test.ts (new), and 529-wrapper injections in adw-build.ts/adw-test.ts/adw-patch-review.ts. The spec's central requirement — extending `ResumeContext` and validating the recorded worktree via `git worktree list --porcelain` rather than `existsSync` — is entirely unfulfilled. The pre-existing resume path at `adws/adw-plan-review-build-patch.ts:1007` still uses `existsSync(worktreePath)` alone (the exact anti-pattern the spec calls out). `createWorktreeFromBase` does not exist anywhere in the repo. The two spec-required resume tests are absent, and both gates the spec validates against (`typecheck:src`, `bun test test/unit/adw-pipeline*.test.ts`) FAIL per the gate results. The BUG-18 work that did land is orthogonal to BUG-20 and addresses none of its acceptance criteria.

### Criteria
- **Resume from plan still runs plan, then review/spec-commit/worktree prep** — implemented: adws/adw-plan-review-build-patch.ts:863-864 (shouldRunPlan), :866-867 (shouldRunReview), setupPhases at :872-967 — pre-existing logic untouched by this diff but behaves per spec
- **Resume from review still runs review/spec-commit/worktree prep** — implemented: adws/adw-plan-review-build-patch.ts:866-867, setupPhases at :872-967 — pre-existing, unchanged by this diff
- **Resume from build/test/patch-review skips ONLY worktree creation when a valid recorded worktree can be reused** — partial: adws/adw-plan-review-build-patch.ts:1004-1030 — else-branch does skip fresh setup, but the validity check at :1007 is `existsSync(worktreePath)` alone, which the spec explicitly forbids; no repo/branch verification is performed before reuse
- **Load state.worktree_path, state.branch, state.base_sha into runPipeline via ResumeContext (single source of truth)** — missing: adws/adw-plan-review-build-patch.ts:290-299 — ResumeContext interface has only `baseSha` (line 298); `worktreePath` and `branch` fields are absent. State still derives worktreePath from `siblingWorktreePath(PROJECT_ROOT, id)` at :770, not from `state.worktree_path`
- **Validate recorded worktree via `git worktree list --porcelain` or rev-parse --show-toplevel + branch checks** — missing: adws/adw-plan-review-build-patch.ts:1007 uses `existsSync(worktreePath)` alone. adws/adws-modules/worktree.ts:372 has `listWorktrees` and :104 has `detectWorktree`, but neither is invoked anywhere on the resume path
- **If valid: emit `worktree-reused` with {path, branch}, do not call createWorktree** — partial: adws/adw-plan-review-build-patch.ts:1009-1015 emits `worktree-reused` with path/branch/reason, but the emit is gated on the wrong condition (`existsSync` at :1007), so it can fire for arbitrary dirs, stale paths, or wrong-branch worktrees
- **If recorded path is arbitrary dir / wrong repo / wrong branch: fail with clear error, do not reuse, do not overwrite** — missing: adws/adw-plan-review-build-patch.ts:1004-1030 has no failure path for these cases — any existing directory is silently reused; no rev-parse --show-toplevel comparison, no branch verification
- **If recorded path missing: recreate via `createWorktreeFromBase(rootPath, branch, worktreePath, baseSha)` running `git worktree add -b <branch> <path> <baseSha>`** — missing: adws/adws-modules/worktree.ts:148-157 — only `createWorktree` exists and uses HEAD (line 154). `createWorktreeFromBase` does not exist anywhere in the repo (grep returns zero hits). Resume path at adw-plan-review-build-patch.ts:1018 calls `createWorktree`, not the spec-required baseSha variant
- **If branch already exists when recreating missing path: reuse branch via `git worktree add <path> <branch>` only after verifying branch name matches state.branch** — missing: adws/adws-modules/worktree.ts:154 uses `git worktree add -b <branch> ... HEAD` which fails if branch exists. No branch-existence fallback, no name verification, no test coverage. Resume path at adw-plan-review-build-patch.ts:1018 inherits this failure mode
- **After recreation: update/confirm state.worktree_path, emit `worktree-created` with original from_sha, set activeWorktreePath** — missing: adws/adw-plan-review-build-patch.ts:1024-1029 emits event named `worktree-recreated` (NOT `worktree-created` as spec requires); `from_sha` is included but the event name violates the spec contract
- **commitWorktreeChanges still runs on successful pipeline completion** — implemented: pre-existing behavior; spec says it should keep running — no regression introduced by this diff
- **Worktree removal NOT added (out of scope)** — implemented: no removal logic added in the diff — `removeWorktree` exists at adws/adws-modules/worktree.ts:168 but is not newly invoked on resume
- **Gate: `bun run typecheck:src` zero errors** — missing: gate results: typecheck:src → FAIL (exit 2)
- **Gate: `bun test test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts` all pass** — missing: gate results: test:unit → FAIL (exit 1)

### Tests
- **Resume from each post-setup stage (build, test, patch-review) with seeded worktree_path/branch/base_sha: assert createWorktree is NOT called** — uncovered: test/unit/adw-pipeline-loop.test.ts:102 — mockWorktreeDeps.createWorktree is a no-op that does not record calls; existing resume tests do not seed worktree_path/branch/base_sha and do not assert createWorktree call count
- **Resume from post-setup stages: assert activeWorktreePath/ADW_WORKTREE passed to stage deps equals recorded worktree path** — uncovered: test/unit/adw-pipeline-loop.test.ts:98-105 — no test inspects the worktree path propagated to build/test/patch-review deps; mockWorktreeDeps has no spy on the path forwarded to children
- **Resume from post-setup stages: assert `worktree-reused` event emitted with recorded path and branch** — uncovered: test/unit/adw-pipeline-loop.test.ts:292-310 asserts worktree-created with from_sha on fresh runs only; no resume-path assertion of worktree-reused exists
- **Missing recorded worktree recreation: seeds worktree_path/branch/base_sha, validation reports missing, asserts recreation uses recorded base_sha and branch without deleting branch** — uncovered: no such test exists; the only recreation test path (test/unit/adw-pipeline-loop.test.ts:292) is for fresh runs, exercises createWorktree (HEAD, not baseSha), and does not verify non-deletion of the branch
- **Manual: kill mid-build + resume verifies no new worktree created (git worktree list unchanged)** — uncovered: spec requires manual verification; no automated test and no evidence-of-manual verification provided for BUG-20
- **Detection of 529 rate-limit in claude -p output (is_error=true AND api_error_status=529) — BUG-18 scope, NOT BUG-20** — covered: test/unit/claude-529-retry.test.ts:50-57 (positive case), :54-56 (negative cases requiring both fields) — correctly covers BUG-18 but irrelevant to BUG-20 acceptance
- **529 retry with exponential backoff until success — BUG-18 scope, NOT BUG-20** — covered: test/unit/claude-529-retry.test.ts:61-78 — correctly covers BUG-18 but irrelevant to BUG-20 acceptance

### Edge cases
- **Recorded worktree_path is an arbitrary directory (not a git worktree)** — missed: adws/adw-plan-review-build-patch.ts:1007 — `existsSync` returns true for arbitrary dirs; orchestrator silently treats it as reusable and emits worktree-reused
- **Recorded worktree_path is a stale path belonging to a different repository** — missed: no rev-parse --show-toplevel comparison against PROJECT_ROOT on the resume path; adws/adws-modules/worktree.ts:106-115 has rev-parse plumbing in detectWorktree but it is not wired into resume validation
- **Recorded worktree_path is a valid worktree on the wrong branch (not adw/<id>)** — missed: no branch verification on the resume path; spec explicitly requires `git worktree list --porcelain` or equivalent branch check; adws/adws-modules/worktree.ts:372 listWorktrees exists but is unused here
- **Recorded worktree_path is missing on disk — must recreate from recorded base_sha (not HEAD) without deleting/recreating branch** — missed: adws/adw-plan-review-build-patch.ts:1018 calls createWorktree which uses HEAD (adws/adws-modules/worktree.ts:154); spec requires createWorktreeFromBase with baseSha, which does not exist
- **Branch already exists when recreating missing path** — missed: createWorktree at adws/adws-modules/worktree.ts:148-157 uses `git worktree add -b` which fails if branch exists; no fallback to `git worktree add <path> <branch>` with branch-name verification, and no test
- **Resuming the same workspace repeatedly should NOT create distinct new worktrees/branches (the central BUG-20 scenario)** — missed: deterministic path at adws/adw-plan-review-build-patch.ts:770 + existsSync-only guard at :1007 means repeated resumes re-enter creation/conflict paths — the exact bug the spec describes; no guard added in this diff
- **529 rate-limit during patch-review audit under concurrent pipelines (BUG-18 scope, NOT BUG-20)** — handled: adws/claude-529-retry.ts:79-106 with backoff [30s,60s,120s]; tests at test/unit/claude-529-retry.test.ts:61-78 — correctly handled but belongs to the wrong bug for this spec

