# SPEC-221: Fikra worktree isolation + patch-apply-or-refuse handoff

**Issue:** #221 (fikra-p4 / RFC-027 §D7)
**Status:** Implemented 2026-08-22

## Goal

Sibling git worktrees per thread — concurrent agents on one repo without
collisions (the adw SPEC-065 precedent). Handoff (`SPC a w`) is
patch-apply-or-refuse, NEVER a merge. Close = snapshot + retention export
+ prune, refusing on unsnapshotable/unmerged state.

## Design

`src/tlisp/core/fikra/worktree.tlisp` (new):

- **Path**: sibling `<dirname(root)>/<basename(root)>.fikra-<thread-id>/`
  (never nested inside the repo), on branch `fikra/<thread-id>`.
- **Enter (local→worktree)**: REFUSES when the local tree differs from the
  thread's latest checkpoint ref (tracked diff or untracked files —
  captures snapshot full disk via add -A, so disk == ref means clean;
  `.tmax/` itself is excluded — it is tmax's own state, never user dirt).
  Creates the worktree from the latest completion ref (HEAD when none) and
  records `worktree` + `worktree-base` in thread state.
- **Handoff (worktree→local)**: snapshot the worktree (checkpoint capture,
  now worktree-aware), compute the cumulative patch
  (`git diff --binary base snapshot`) into
  `.tmax/fikra/patches/<thread>.patch`, then `git apply --check` FIRST:
  conflict → ABORT — the worktree stays intact, the status reports
  CONFLICT, the patch is saved for manual application. Clean → apply.
- **Close**: snapshot FIRST, then refuse if anything on disk is beyond the
  snapshot (tracked diff vs the snapshot ref, or untracked files that
  appeared after it — the pre-snapshot porcelain check tripped on the very
  changes the snapshot exists to capture). Then: export per-turn diffs to
  `.tmax/fikra/threads/<id>/diffs/<n>.patch` (the #217/#218 retention
  step), remove the worktree, delete the branch, delete the thread's
  `refs/fikra/<id>/*`, clear the state fields.
- **Toggle** (`SPC a w`, lazy require per the cycle rules): enter when
  local, hand off when in a worktree.

**Supporting changes:**
- `thread.tlisp`: `fikra-thread-working-dir` (worktree || local root — the
  backend cwd AND checkpoint capture root), `fikra-thread-focus` (id
  setter + lazy state; #222 formalizes switching), `worktree` +
  `worktree-base` persisted in state.json, fresh-state shape.
- `checkpoint.tlisp`: the capture shell line now `cd`s into
  `fikra-thread-working-dir` first (captures land inside worktrees; refs
  are repo-global by design; the temp index stays in the local root's
  .tmax).
- `backend-claude.tlisp`: `make-process :cwd` =
  `fikra-thread-working-dir` — agent edits land in the worktree.
- `chat.tlisp`: the lighter appends ` wt:<id>` only in worktree mode.

## Completion Criteria

- [x] Two threads in worktrees editing the SAME file concurrently never
      cross-contaminate: A's handoff applies only A's edit; B's subsequent
      handoff CONFLICTS (local moved) — refused, patch preserved
      (.tmax/fikra/patches/b.patch), B's worktree intact (pinned).
- [x] Enter on a clean tree creates the sibling worktree on `fikra/<id>`
      from HEAD; `git worktree list` shows it (pinned).
- [x] Enter REFUSES on a dirty local tree (beyond the latest checkpoint);
      the worktree is never created; the status names the reason (pinned).
- [x] tmax's own `.tmax/` does NOT count as dirt (pinned).
- [x] Clean handoff applies the cumulative patch (modified + created
      files) to the local tree (pinned).
- [x] Conflicting handoff ABORTS: local untouched, worktree intact, patch
      saved, status reports CONFLICT (pinned).
- [x] Close prunes worktree + branch + refs (each verified gone), exports
      diffs/<n>.patch first, clears state; the applied content survives
      locally (pinned).
- [x] Close REFUSES on post-snapshot divergence (worktree intact, status
      reports refused) (pinned).
- [x] Lighter carries `wt:<id>` only in worktree mode (pinned on/off/
      after-close); `SPC a w` registered via key-binding lookup (pinned).
- [x] Working dir + backend `:cwd` worktree-aware (pinned via
      fikra-thread-working-dir; the spawn uses the same fn).

## Notes

- `git worktree add` failures surface verbatim (e.g. an existing
  `fikra/<id>` branch) — reported, never silent.
- macOS realpath note for tests: git resolves `/var` → `/private/var`.
- Thread focus switching is the minimal setter; the *Fikra-Threads*
  buffer/project grouping machinery is #222.
