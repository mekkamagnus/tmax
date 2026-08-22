# ADR-0249: Fikra worktree isolation — patch-apply-or-refuse handoff

**Date:** 2026-08-22
**Status:** Accepted
**Issue:** #221
**Spec:** SPEC-221

## Context

RFC-027 §D7: running multiple agents on one repo requires per-thread
isolation. The adw pipeline's SPEC-065 precedent (sibling worktrees, never
nested) is proven in this codebase. The handoff between a worktree and the
local tree must never silently merge user and agent work.

## Decision

1. **Sibling worktree per thread** at `<repo>.fikra-<thread-id>/` on
   branch `fikra/<thread-id>`, created from the thread's latest completion
   ref (HEAD when none). Thread STATE stays in the local root's `.tmax`;
   refs are repo-global (shared across worktrees by design).
2. **Handoff is patch-apply-or-refuse, never a merge.** The cumulative
   patch (recorded base → worktree snapshot) is `git apply --check`ed
   BEFORE applying: conflict aborts the whole handoff — the worktree stays
   intact, the patch is saved for manual application, the status names
   what happened. There is no partial application.
3. **Cleanliness is measured against CHECKPOINTS, not HEAD.** Enter
   refuses when the local tree differs from the latest checkpoint (the
   captures ARE the thread's notion of known state; disk == ref is clean).
   `.tmax/` itself is excluded — tmax's own state dir is never user dirt.
4. **Close snapshots FIRST, then judges.** The refuse check compares the
   worktree against the fresh snapshot (not porcelain — which flags the
   very changes the snapshot exists to capture). Pruning removes worktree,
   branch, refs — after exporting the per-turn diffs (retention).
5. **Working-dir indirection**: `fikra-thread-working-dir` (worktree ||
   local root) is the single source for the backend `make-process :cwd`
   and checkpoint captures — agent edits and snapshots land in the right
   tree by construction.

## Consequences

- Concurrent threads on the same file are isolated; the second handoff
  conflicts visibly instead of clobbering (pinned).
- A dirty local tree blocks worktree entry — the user commits or stashes
  first (conservative by design; the checkpoint is the reference).
- The worktree branch is a plain branch; users can inspect it with
  ordinary git while the thread runs.
