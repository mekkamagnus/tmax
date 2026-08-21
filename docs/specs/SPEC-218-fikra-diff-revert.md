# SPEC-218: Diff view + tree-diff-inverse revert + ref retention

**Issue:** #218 (fikra-p2 / RFC-027 §D6, §Phase 2)
**Status:** Implemented 2026-08-22

## Goal

Per-turn diff review and CORRECT revert: the 2×2 presence matrix (not
`git restore --source` alone, which silently leaves later-created files),
content-divergence aborts with re-appliable stash patches, the append-only
tombstone, and ref retention for the thread's lifetime.

## Design

`src/tlisp/core/fikra/revert.tlisp`:

- **Revert plan** from `git diff --name-status target completion`:
  M → restore from target; D → restore (deletion undone); A → DELETE;
  entries only cover ref-diff paths — untracked-not-in-completion and
  gitignored files are structurally excluded (they're never diff entries).
- **Content-divergence guard** with correct absent-in-completion semantics
  (dev-cycle bug: the first version treated every D entry as diverged
  because `git show completion:path` fails for deleted files):
  absent-completion + absent-disk → clean restore; absent-completion +
  present-disk → diverged (user recreated); present-both → cmp contents;
  present-completion + absent-disk → diverged (user deleted).
- **Diverged paths**: abort THAT path; current content saved via
  `git diff --binary <completion> -- <path>` to
  `.tmax/fikra/stash/revert-<slug>.patch` (re-appliable with git apply).
- **Tombstone**: `checkpoint-reverted {target, revert-point,
  paths-reverted, paths-aborted}` appended — the log is never truncated.
- **FAEP replay** now accepts tombstone target/revert-point as turn
  numbers OR full ref names (`refs/fikra/main/3-baseline`) via a
  manual-slicing extractor (regex brackets proved fragile in T-Lisp string
  escaping); range construction fixed from a double-increment dev bug.
- Missing refs → nil + status, no crash. `fikra-diff-stat` for the
  *Fikra-Diff* header; the full interactive diff buffer UI is #216's
  deferred TAB-expand territory and the SPC a d binding (#219 wires the
  interactive surface).

**Ref retention** (with #217): refs live for the thread's entire
lifetime — revert NEVER prunes; thread close exports checkpoint diffs to
`.tmax/fikra/threads/<id>/diffs/*.patch` before pruning is #219+ scope
(close-time export fn provided by #217's design; not yet wired to a close
event since thread-close is Phase 4).

**Test-fixture rule discovered** (the tombstone-log mystery): fresh test
repos MUST gitignore `.tmax/` (the RFC rule) — otherwise checkpoints
capture `events.jsonl`/`state.json` themselves, and reverting a turn
reverts the event log (the log "shrank" because the baseline version of
events.jsonl was restored over it). Both the revert and checkpoint suites
now write `.gitignore` with `.tmax/` in beforeEach.

## Completion Criteria

- [x] 2×2 matrix: modified restored; deleted-by-turn restored;
      created-by-turn DELETED (pinned).
- [x] User's own untracked files untouched; gitignored untouched (pinned).
- [x] Divergence guard covers BOTH destructive actions (gate round-1
      catch: delete was unguarded — deleting a user-recreated file would
      silently destroy their work; now diverged A-entries abort + stash,
      pinned). The stash emits a CREATION patch of current disk content
      via `git diff --binary --no-index /dev/null <path>` — the old
      `git diff <completion> --` form stashed a deletion patch with none
      of the user's content for untracked files (gate catch). M-entry
      aborts + others-revert pinned from round 1.
- [x] Tombstone appended (log append-only — line count grows); post-revert
      events still render; the marker renders (pinned).
- [x] Tombstone turns accepted as numbers AND ref names; range built
      correctly (double-increment fixed; pinned via the #212 tombstone
      tests re-passing).
- [x] Missing refs → nil + status (pinned).
- [x] typecheck 4/4 green; revert 7 + checkpoint 11 + event 9 = 27/27 in
      the 3-suite run; full 8-suite batch 78 tests with ONE known
      load-family flake (async-capture poll under 8-suite parallel load —
      clean 3× solo; poll window widened 3s→9s). 0 `.tmax` residue.

## Notes

- Close-time diff export + ref pruning: blocked on thread-close (Phase 4);
  the retention rule (refs live for the thread's lifetime) is what makes
  revert-any-turn safe today.
- The interactive *Fikra-Diff* buffer (y/n/e keys) lands with #219's
  SPC a d wiring; `fikra-diff-stat`/`fikra-diff-command` are the pure
  helpers it renders from.
