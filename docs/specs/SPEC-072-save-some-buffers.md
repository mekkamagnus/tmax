# Feature: `save-some-buffers` — bulk-save all modified buffers (quit safety)

## Goals

- Provide an Emacs-conventional `save-some-buffers` command that iterates every
  live buffer and saves each modified one, so a single command (or a quit) can
  flush all pending edits.
- Close the **data-loss-on-quit** gap: quitting tmax today discards unsaved
  buffers silently; wire a save-some pass into the quit pre-check so the user is
  prompted before any modified buffer is lost.
- Make the command **M-x-discoverable** and `:`-reachable (`:wa`), reusing the
  existing single-buffer `save-buffer` primitive.

## Completion Criteria (Definition of Done)

- [ ] `(defun save-some-buffers)` exists in
      `src/tlisp/core/commands/save.tlisp`, exported from the
      `editor/commands/save` module, with a docstring.
- [ ] It iterates `(buffer-list-details)` (or `(buffer-list)` + per-buffer
      metadata), and for each buffer where `(buffer-modified-p)` is true it
      prompts y/n and runs `save-buffer` on "yes" — eval-23.
- [ ] Special buffers (`*scratch*`, `*Messages*`, `*daemon*`) are skipped
      (never treated as save candidates; they have no associated file).
- [ ] File-less modified buffers are reported via `(message …)` ("Buffer NAME
      has no associated file") and skipped rather than crashing on `save-buffer`.
- [ ] `editor-quit` (`src/editor/api/bindings-ops.ts:47`) runs
      `save-some-buffers` as a pre-check when any buffer is modified, so
      quitting prompts to save instead of discarding — the data-loss-on-quit
      gap is closed.
- [ ] `:wa` (and `:wsave`) on the command line invokes `save-some-buffers`
      (handled in `src/tlisp/core/commands/command-line.tlisp`, next to `:w`).
- [ ] `save-some-buffers` is **M-x-discoverable**: it appears in M-x completion
      because it carries a docstring (per `command-detail-interactive-p` in
      `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`).
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`,
      and `bun run test:tmax-use` all pass; the eval-23 playbook is green.

## Description

`tmax` can save only one buffer at a time (`save-buffer` /
`quick-save` in `src/tlisp/core/commands/save.tlisp`). There is no
`save-some-buffers` / `save-all`: to persist a multi-buffer session the user
must visit and `:w` each buffer individually. Worse, `editor-quit`
(`src/editor/api/bindings-ops.ts:47-61`) emits the quit signal with **no
modified-buffer check at all** — quitting with three unsaved buffers silently
destroys all three. This spec adds `save-some-buffers` to the T-Lisp
`editor/commands/save` module (iterating `buffer-list` and prompting per
modified buffer via the only working interactive mechanism,
`completing-read`) and wires a save-some pre-check into `editor-quit` so the
quit path no longer loses data.

## User Story

**As a** tmax user editing several files across multiple buffers,
**I want** a single command that saves every modified buffer (asking first), and
a quit that refuses to discard my unsaved edits without warning,
**So that** I never lose work to a hasty `:q` and don't have to walk each buffer
by hand.

## Problem Statement

The Alpha audit (`alpha-audit-2026-08-01.md`) flagged bulk-save and quit-safety
as missing at the T-Lisp/M-x layer. Concretely:

- Only single-buffer save exists: `save-buffer` (`src/tlisp/core/commands/save.tlisp`),
  plus the `quick-save` / `save-file` wrappers. No iteration over all buffers,
  no "save all".
- `editor-quit` (`src/editor/api/bindings-ops.ts:47-61`) immediately returns the
  `EDITOR_QUIT_SIGNAL` eval error. It does **not** consult
  `(buffer-modified-p)` for any buffer. `:q` (`command-line.tlisp`) and
  `:wq` likewise quit (or save-only-current-then-quit) with no multi-buffer
  guard. **Quitting discards unsaved buffers silently — a data-loss bug.**
- The interactive-prompt gap (same as SPEC-071): `read-string` is a sync stub
  (`src/editor/tlisp-api.ts:1314-1319`), so per-buffer y/n prompting must use
  `completing-read` over a yes/no table — the same mechanism `switch-buffer`
  uses. (For the quit path specifically, this means the quit pre-check flips to
  `mx` mode to ask, then returns to the prior mode — matching how every other
  `completing-read` in the codebase behaves.)

## Solution Statement

Add `(defun save-some-buffers)` to `src/tlisp/core/commands/save.tlisp` that:

1. Walks `(buffer-list-details)` (the primitive at `src/editor/editor.ts:1096`
   that already returns `name`, `filename`, `modified`, `special` per buffer —
   no new primitive needed).
2. Skips buffers where `modified` is false or `special` is true; for each
   remaining buffer, opens a `completing-read` with prompt
   `"Save buffer NAME? (yes/no)"` over a yes/no table; on "yes", switches to
   that buffer and calls `save-buffer` (guarding the file-less case with
   `buffer-filename`).
3. Returns to the original buffer and messages a summary
   (`"Saved N buffer(s)"`).

Wire `:wa` to `(save-some-buffers)` in `command-line.tlisp`. For quit safety,
redefine the quit path so that **before** emitting `EDITOR_QUIT_SIGNAL`,
`editor-quit` checks whether any buffer is modified (a new tiny primitive
`some-buffer-modified-p`, or a T-Lisp `(catch 'found …)` walk over
`buffer-list-details`); if so, it runs `save-some-buffers` first. Because
`editor-quit` is a primitive that returns an `Either.left` signal, the save-some
pre-check is best done in T-Lisp at the `:q`/`:wq`/`SPC x C-c` call sites (which
already call a T-Lisp wrapper) rather than inside the primitive itself — add a
`editor-quit-safe` T-Lisp wrapper that runs the pre-check then calls
`editor-quit`. Give `save-some-buffers` a docstring so it is M-x-discoverable.
**No C-x bindings** (SPEC-067); SPC-led / `:`-only.

## Relevant Files

Read these before implementing (paths verified against the current tree):

- **`src/tlisp/core/commands/save.tlisp`** — where `save-some-buffers` is added.
  Existing exports: `save-buffer` (line ~9, the per-buffer save with
  concurrent-modification + backup logic), `quick-save`, `save-file`. The new
  `defun` is added here and exported on line 2. `save-buffer`'s early-return on
  no-`buffer-filename` (line ~14) is the behaviour `save-some-buffers` must
  tolerate per-buffer.
- **`src/editor/editor.ts:1096-1111`** — the `buffer-list-details` primitive.
  Returns per-buffer `name`, `filename`, `major-mode`, `modified`, `characters`,
  `lines`, `current`, `special`, `recency`. **No new primitive is needed for the
  iteration** — this already exposes the `modified` and `special` flags.
- **`src/editor/api/bindings-ops.ts:47-61`** — `editor-quit`. The quit signal is
  an `Either.left({ type: 'EvalError', … message: 'EDITOR_QUIT_SIGNAL' })`.
  The save-some pre-check lives in T-Lisp (`editor-quit-safe`) at the call sites,
  not inside this primitive, so the primitive stays a pure signal.
- **`src/tlisp/core/commands/command-line.tlisp`** — the
  `editor-dispatch-command-line` `cond`. Add `:wa` next to the existing `:w`
  clause (the `(string= line "w")` case). The `:q`/`:wq` clauses are where
  `editor-quit-safe` replaces the bare `editor-quit` call for quit safety.
- **`src/tlisp/core/bindings/normal.tlisp:252`** — `(key-bind "SPC x C-c"
  "(editor-quit)" "normal")`. Swap to `(editor-quit-safe)` so the leader-key
  quit also prompts.
- **`src/tlisp/core/commands/buffers.tlisp:6,16-21`** — `buffer-detail-more-recent-p`
  and `buffer-completion-table` are the model for the yes/no completion table
  the per-buffer prompt uses.
- **`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`** — the
  `command-detail-interactive-p` rule (docstring OR binding ⇒ M-x-visible).
- **`src/editor/tlisp-api.ts:1314-1319`** — the `read-string` stub. Cited to
  justify using `completing-read` for the y/n prompt instead.

### New Files

- **`tmax-use/playbooks/eval-23-save-some-buffers.yaml`** — the e2e playbook
  (authored by a later workflow, not this spec).

## Implementation Plan

### Phase 1 — `save-some-buffers` command

1. In `src/tlisp/core/commands/save.tlisp`, add a `save-some-yes-no-table`
   completion table (two candidates: `yes`, `no`) and a
   `save-some-save-accept` helper that, given a buffer name and answer `"yes"`,
   switches to that buffer and calls `save-buffer`.
2. Add `(defun save-some-buffers () …)`:
   - Save the starting buffer name (`(buffer-current)`) to restore at the end.
   - Iterate `(buffer-list-details)`. For each detail: skip if `modified` is
     nil/false, skip if `special` is true. Otherwise `(completing-read …)` with
     prompt `(concat "Save buffer " name "? (yes/no)")`; on accept `"yes"`,
     `(buffer-switch name)` then `(save-buffer)`; if `(buffer-filename)` is nil,
     `(message (concat "Buffer " name " has no associated file"))` and continue.
   - Restore the starting buffer, `(message (concat "Saved " count "
     buffer(s)"))`.
3. Export `save-some-buffers` on the module `export` line (line 2).
4. Verify: `bun run typecheck:src`; `(save-some-buffers)` callable via `--eval`.

### Phase 2 — `:wa` command-line + quit safety

5. In `src/tlisp/core/commands/command-line.tlisp`, add
   `((or (string= line "wa") (string= line "wsave")) (save-some-buffers))` to
   the `editor-dispatch-command-line` `cond`, next to `:w`.
6. Add `(defun editor-quit-safe () …)` (in `save.tlisp` or a small
   `editor-ops` module) that runs `save-some-buffers` when any buffer is
   modified, then calls `editor-quit`. Detect "any modified" by walking
   `buffer-list-details` (or a `(catch 'found …)` over `(buffer-list)` reading
   `buffer-modified-p` per buffer via `buffer-switch` — but prefer the details
   walk to avoid mutating the current buffer).
7. Replace the bare `(editor-quit)` call in the `:q` / `:q!` / `:quit` clause
   of `command-line.tlisp` with `(editor-quit-safe)`. (`:q!` keeps the bare
   `editor-quit` — the `!` form explicitly discards, mirroring vim.) Likewise
   swap `SPC x C-c` in `normal.tlisp:252` to `(editor-quit-safe)`.
8. Verify: `bun run typecheck:src`.

### Phase 3 — M-x discoverability

9. Confirm `save-some-buffers`'s docstring is non-empty (step 2) so
   `command-detail-interactive-p` admits it to M-x completion. No extra
   registration needed.
10. Verify M-x completion includes `save-some-buffers` (eval-23 assertion).

### Phase 4 — Validation

11. Run every command under Test Plan; confirm zero regressions and that
    eval-23 is green.

## Test Plan

**Assigned e2e playbook: eval-23**
(`tmax-use/playbooks/eval-23-save-some-buffers.yaml`, authored by the playbook
workflow). Key assertions (grounded in the harness's `expect` keys:
`result_contains`, `buffer_contains`, `mode`):

- Open two files, modify both (`(buffer-insert …)`); `(save-some-buffers)`
  prompts for each; answer "yes" to both → both files on disk reflect the edits
  (`buffer_contains` the new text when re-opened, or assert via `(buffer-modified-p)`
  → false for each).
- A modified file-less buffer is reported and skipped (no crash); a modified
  file buffer is saved.
- Special buffers (`*scratch*`) are never prompted even if "modified".
- `:wa` saves all modified buffers.
- Quit safety: with a modified buffer, `:q` triggers the save-some prompt before
  quitting; `:q!` quits immediately (discard confirmed).
- `M-x save-some-buffers` is offered by completion (the docstring makes it
  interactive).

**Unit/integration coverage** (in `test/unit/`):

- A unit test for `save-some-buffers` driving `completing-read`'s accept function
  directly (bypassing the minibuffer): given a details list with two modified
  file buffers and one unmodified, the accept path calls `save-buffer` exactly
  twice and leaves the unmodified buffer untouched. Mock or stub
  `write-file-content` to assert call counts.
- A unit test that `editor-quit-safe` calls `save-some-buffers` when any buffer
  is modified and calls `editor-quit` directly when none are.

## M-x Discoverability

`save-some-buffers` will appear in M-x completion **iff** it has a non-empty
docstring **or** a keybinding, per `command-detail-interactive-p` in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. This spec
satisfies that with the docstring from step 2. No keybinding is added here (the
existing `SPC x s` is `quick-save`, single-buffer; a future `SPC x S` or
`SPC x a` could bind `save-some-buffers` but is out of scope to keep the change
minimal). No `C-x <key>` binding is proposed — SPEC-067 reserves `C-x` for the
vim decrement-number prefix; specifically there is no Emacs-style `C-x s`.
