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
