# SPEC-284 — Stagehand stage / unstage / discard (#287)

## Goal

Stagehand T0: file-level stage (`s`/`S`), unstage (`u`/`U`), and
discard (`D`) from the #286 status buffer, with argv-safe git
invocations and index-preserving discards.

## Design

- **Module** `src/tlisp/core/stagehand/stage.tlisp` (loaded from
  `bindings/normal.tlisp` after status/commit — the same one-way
  shape; status binds `s`/`u`/`D`/`S`/`U` lazily).
- **`shell-exec-argv`** (NEW builtin, `tlisp-api.ts`): an argv-LIST
  exec with NO shell between the values and the process (`Bun.spawnSync`
  on the array; optional cwd; returns the byte-faithful
  `(stdout stderr exit)` triple like `shell-exec`). `stagehand-git-argv`
  conses `"git"` onto the args — spaces, leading dashes, and unicode
  are structurally safe with `--` before every path (no shell, no
  quoting). PATHSPEC MAGIC still applies to argv paths (codex r1/r2:
  a ':(glob)*.txt' filename globbed siblings) — every path also
  rides `:(literal)`.
- **Per-row matrix**: `s` on Untracked/Unstaged → `git add -- path`;
  `u` on Staged → `git restore --staged -- path` (a staged RENAME
  contributes BOTH paths to ONE invocation — index + worktree of both
  sides asserted); `D` on Unstaged → `git checkout -- path` behind a
  y/n `completing-read` (the kill-buffer-yes-no table pattern; the
  accept handler runs the discard — `y` only; `n`/empty/C-g are
  no-ops); `D` on Untracked REFUSES (`refusing to discard untracked
  file` — no `clean -f` in v1); conflicted rows refuse everything
  (`resolve conflicts first`; #295's conditional-`s` exception arrives
  with #295).
- **Index preservation**: worktree `D` restores the worktree file
  ONLY — a staged+worktree-discarded row re-renders staged-clean with
  the STAGED content in the worktree (tested on actual contents).
- **Header-wide `S`/`U`**: act only on eligible sections (Untracked +
  Unstaged for `S`; Staged for `U`; others no-op with a status). Rows
  process top-to-bottom; the FIRST failure STOPS the run with the
  per-row report `applied K of V visited, failed at <path>: <err>`;
  applied rows stay applied (idempotent re-run tested through a
  read-only `.git` break + fix). The Conflicted section is never
  visited; the report counts VISITED rows only.
- **Success refreshes** via #286's fold-and-cursor-preserving refresh
  (tested); git failure → status names exit + stderr, buffer
  unchanged.

## Completion criteria

- [x] Temp-repo tests assert ACTUAL index + worktree contents after
      each action — staged adds/deletions/renames (both sides), the
      split staged+unstaged discard (worktree = staged content, index
      untouched), and the cancel paths (n + empty)
- [x] Untracked-discard refusal; per-row conflicted refusal (s/u/D);
      header-wide runs exclude the Conflicted section (the conflict
      stays UU) and report only the visited count
- [x] argv-safety fixtures (spaces, leading dash, unicode — staged
      through the real dispatch); failure statuses render; partial
      failure stops with the per-row report and survives an idempotent
      re-run; the `s`/`u`/`D` keys dispatch via handleKey (incl. the
      real y+Enter minibuffer answer)
