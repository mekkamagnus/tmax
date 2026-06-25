# Bug: Worktree isolation creates duplicate worktrees on every resume

## Bug Description

The SPEC-065 worktree-isolation feature creates a new sibling worktree for every pipeline run. But when resuming (`--resume <id> --from-stage <stage>`), the orchestrator creates ANOTHER worktree instead of reusing the one already recorded in `state.worktree_path`. This produced **86 orphaned worktrees** on disk (each with its own branch `adw/<id>`) after repeated resume cycles on a single workspace.

**Expected:** Resume reuses the existing worktree from `state.worktree_path`. No new worktree is created.

**Actual:** Every resume creates a new worktree at `<repo>.<adw-id>/`, but since the path is deterministic (based on the workspace id), the `createWorktree` call either fails (path exists) or the orchestrator ignores the failure and continues without isolation.

The 86 worktrees came from multiple workspaces (not just SPEC-065) — each workspace's resume cycles created worktrees that were never cleaned up.

## Problem Statement

86 orphaned git worktrees accumulated on disk, each consuming ~100MB of disk space and creating a branch that clutters `git branch`. The worktree-creation logic on resume is either missing the "reuse existing" guard, or the guard checks the wrong condition.

## Solution Statement

In `runPipeline`, the `needsFreshSetup` flag must be `false` on resume when `state.worktree_path` exists on disk. The resume path should:
1. Read `state.worktree_path` from the workspace state.
2. If it exists on disk → set `activeWorktreePath` to it, emit `worktree-reused`, skip creation.
3. If it doesn't exist → recreate from `state.base_sha` (or the `worktree-created` event's `from_sha`).
4. Never call `createWorktree` on resume unless the recorded worktree is gone.

Additionally, `commitWorktreeChanges` should run on successful pipeline completion, and the orchestrator should optionally remove the worktree (configurable, default: leave for inspection).

## Steps to Reproduce

1. Launch a pipeline: `bun adws/adw-launch.ts "add feature X"` — creates worktree `tmax.01KVABC/`
2. Kill mid-build
3. Resume: `bun adws/adw-launch.ts --resume 01KVABC` — creates ANOTHER worktree `tmax.01KVABC/` (same path, so `createWorktree` returns Left "already exists", but the orchestrator continues without setting `activeWorktreePath` correctly)
4. Repeat — each resume may create a new branch or leave stale state

## Root Cause Analysis

The orchestrator's `needsFreshSetup` flag is true for ALL non-resume runs AND for resume runs that don't detect an existing worktree. On resume, the orchestrator loads workspace state but doesn't check whether `state.worktree_path` exists before setting `needsFreshSetup = true`. The `createWorktree` call then fails silently (path exists), `activeWorktreePath` is set to the path anyway (or not set at all), and the pipeline runs in an indeterminate state.

The fix: on resume, check `existsSync(state.worktree_path)`. If true → reuse it. If false → recreate. Never call `createWorktree` when the worktree already exists.

## Relevant Files

- **`adws/adw-plan-review-build-patch.ts`** — The `runPipeline` function: the `needsFreshSetup` logic and the resume path's worktree handling. Add the `existsSync(state.worktree_path)` check before `needsFreshSetup`.
- **`adws/adws-modules/worktree.ts`** — `createWorktree` already returns Left when the path exists — the orchestrator should treat that Left as "reuse" on resume, not as an error.

## Validation Commands

- `bun run typecheck:src` — zero errors.
- `bun test test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts` — all pass.
- Manual: launch a pipeline, kill mid-build, resume — verify no new worktree is created (`git worktree list` shows the same worktrees before and after resume).
