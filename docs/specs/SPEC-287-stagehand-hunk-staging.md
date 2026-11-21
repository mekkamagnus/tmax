# SPEC-287 — Stagehand hunk-level staging (#291)

## Goal

Stagehand T1: WHOLE-hunk stage / unstage / worktree-discard from the
diff views, via `git apply` with the reconstructed patch on stdin.

## Design

- **Hunk extraction** (`stagehand-diff-hunk-patch idx`, pure over the
  view's recorded raw diff): the FILE HEADER block (`diff --git`,
  `index`, `---`, `+++` **and `new file mode` / `deleted file
  mode`** — the block since the last `diff --git`) verbatim + the
  hunk verbatim (`@@` header + body + the `\ No newline` marker
  carried WITH it). The #289 parser's classes define the boundaries;
  a new file header or another meta line ends a hunk. (Gate r1: the
  mode lines MUST ride in the header — dropping them made the patch
  module-shaped and `git apply` staged a PHANTOM dev/null path into
  the index; the corruption is regression-tested on both the
  staged-new-file unstage and the worktree-deleted-file stage.)
- **The ops** (the diff view's keymap; `s` worktree-view, `u`
  cached-view, `D` worktree-view behind the n-FIRST y/n confirm —
  a bare Enter cancels): `git apply --cached -`, `git apply
  --cached -R -`, and `git apply -R -` (worktree mutation, NOT an
  index op) respectively — each flag its OWN argv element, the patch
  on STDIN via `process-write` + the NEW `process-close-stdin` (the
  EOF `git apply -` reads until; without it the apply waits forever),
  argv-based (no shell; no pathspec args — the patch carries the
  paths, and `--` after the patch would parse as a second patch).
- **Availability**: a key that does not apply in the current view
  no-ops with a status (`s stages worktree hunks (open with d)` /
  `u unstages cached hunks`) — checked BEFORE the cursor and refusal
  lookups.
- **Refusals (named, no-op)**: binary (`Binary files … differ`),
  rename/copy hunks (file-level ops per #287), mode-only changes.
- **The apply lifecycle** (sentinel-driven): the apply runs
  `sh -c "git apply <flags> - 2>&1"` (a FIXED constant command — no
  user data crosses the shell; the patch rides stdin) because git
  apply's diagnostics go to STDERR and make-process filters see
  STDOUT only — the 2>&1 merge is what makes the failure line
  possible. Exit 0 → the view refreshes IN PLACE on the SAME side
  (proper argv list elements; the empty result renders the clean
  `no changes on this side` notice with the state cleared — the
  refresh is bound to `g`, the hint's action); ≠ 0 → `apply failed
  (N) <first-stderr-line> — refresh and retry` (a stale diff lands
  here; the view does NOT auto-retry); nothing applied.
- **View state**: the diff view records its side (`worktree` |
  `cached`), root, and paths at open (threaded from BOTH status `d`
  dispatch sites — the row and the section header, whose paths are
  the section's distinct list) — the hunk ops read it to know which
  side they act on, and the REFRESH scopes to those paths. The
  refusal scan is scoped to the TARGET FILE's section (a rename on
  an unrelated file in the view does not block this file's hunk).
- Selected-line staging is SPLIT OUT → **#331 (filed)**.

## Completion criteria

- [x] Real temp-repo tests prove ONLY the intended change: stage-hunk
      leaves the worktree byte-identical and the index changed
      (two-hunk file: hunk A staged, hunk B untouched — both sides
      asserted on actual contents); unstage mirrors; discard changes
      only the worktree (the index diff identical before/after)
- [x] Refusal classes: binary, rename (via the cached view — the
      valid key there), mode-only; stale-diff (the INDEX diverging —
      the --cached apply reads the index, a worktree-only edit would
      not make it stale) with the retry hint; malformed patch input
      (garbage on stdin through the module's own callbacks) → the
      named error, nothing applied
- [x] The no-final-newline round-trip (stage → the index shows the
      marker's effect via `git show :file`; unstage → the index
      restored byte-exact; the worktree untouched throughout); the
      discard cancel (a bare Enter); the `s` key dispatches via
      handleKey; #331 filed before close
- [x] Gate r1: the phantom-dev/null corruption regression-tested BOTH
      ways (a staged new file's unstage; a worktree-deleted file's
      stage — ls-files asserts no dev/null); the post-apply refresh
      RENDERS (the remaining hunk visible; the last hunk → the clean
      empty notice + state cleared); the failure message carries the
      apply's stderr line; the refusal scope is the target file's
      section
