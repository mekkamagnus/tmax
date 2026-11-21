# SPEC-287 — Stagehand hunk-level staging (#291)

## Goal

Stagehand T1: WHOLE-hunk stage / unstage / worktree-discard from the
diff views, via `git apply` with the reconstructed patch on stdin.

## Design

- **Hunk extraction** (`stagehand-diff-hunk-patch idx`, pure over the
  view's recorded raw diff): the FILE HEADER block (`diff --git`,
  `index`, `---`, `+++` — the block since the last `diff --git`)
  verbatim + the hunk verbatim (`@@` header + body + the
  `\ No newline` marker carried WITH it). The #289 parser's classes
  define the boundaries; a new file header or another meta line ends
  a hunk.
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
- **The apply lifecycle** (sentinel-driven): exit 0 → `hunk applied`
  + the view refreshes IN PLACE (same side; the #289 contract); ≠ 0
  → `apply failed (N) <first-stderr-line> — refresh and retry` (a
  stale diff lands here; the view does NOT auto-retry); nothing
  applied.
- **View state**: the diff view records its side (`worktree` |
  `cached`), root, and paths at open (threaded from the status `d`
  dispatch) — the hunk ops read it to know which side they act on.
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
