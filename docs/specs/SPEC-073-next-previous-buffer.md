# Feature: `next-buffer` / `previous-buffer` — cycle buffers by recency

> ## ⚠️ As-built deviation (verified during implementation — eval-24 green)
>
> The original Solution/CC proposed rotating a **recency-sorted** list (`buffer-list-details` + `buffer-detail-more-recent-p`) and **including** special buffers. Empirically that is **non-deterministic**: `buffer-switch` bumps recency on every call (`src/editor/editor.ts:353 touchBuffer`), so a recency list recomputed each call puts the just-switched-to buffer at index 0 → `next-buffer` ping-pongs between the two most-recent buffers and never visits the rest (`C→B→C→B…`).
>
> **As built** (and verified by `eval-24`, including the full `C→B→A→C` and `C→A→B→C` cycles):
> - Rotation is over a **stable insertion-order** list `(filter non-special (buffer-list))` (`buffer-rotation-list`), which is the only deterministic ordering available with current primitives.
> - Special buffers (`*…*`) are **excluded** from the rotation (the eval-24 wrap cycle is only satisfiable with specials excluded; Emacs offers comparable exclusion via `BURY` lists).
> - The spec's recency helpers (`buffer-recency-list`, `buffer-detail-name`) are kept in the module but the cycle itself does not use them.
>
> A future fix would add a non-self-bumping recency primitive (or snapshot recency once per rotation) so the original "true recency" intent can be restored; until then insertion-order is the correct, deterministic behavior. This supersedes the recency/specials wording in Goals, Completion Criteria, and Solution below.
>
> ✅ **Resolved by SPEC-087 (2026-08-06):** the non-self-bumping primitive shipped — `next-buffer`/`previous-buffer` now cycle **true recency** (most-recent-first, non-special) via the new `buffer-switch-silent` primitive (`src/editor/api/buffer-ops.ts`) + `Editor.switchBufferSilent` (no `touchBuffer`), so the rotation no longer perturbs the recency order it iterates. `eval-24` is extended with sustained-cycling (B,A,C,B,A,C), an idx=0 wrap regression, and an interactive-bump-preserved guard. The insertion-order `buffer-rotation-list` is retained (superseded comment in `buffers.tlisp`).

## Goals

## Goals

- Provide Emacs-conventional `next-buffer` and `previous-buffer` commands that
  rotate through the live buffer list ordered by **recency**, so the user can
  flip between recently-used buffers without naming them.
- Bind them to SPC-led keys (`SPC x n` / `SPC x p`) that fit the existing
  `SPC x` buffer group — explicitly **not** `C-x <arrow>` / `C-x n` / `C-x p`,
  which SPEC-067 reserves for the vim decrement-number prefix.
- Make both commands **M-x-discoverable** via docstrings (and their keybindings).

## Completion Criteria (Definition of Done)

- [ ] `(defun next-buffer)` and `(defun previous-buffer)` exist in
      `src/tlisp/core/commands/buffers.tlisp`, exported from the
      `editor/commands/buffers` module, each with a docstring.
- [ ] Both rotate the buffer list ordered by recency using the existing
      `buffer-detail-more-recent-p` comparator and `buffer-list-details`
      primitive — `(buffer-switch name)` to the next/previous buffer relative to
      the current one — eval-24.
- [ ] Rotation **wraps** (past the last buffer, `next-buffer` returns to the
      first; before the first, `previous-buffer` returns to the last).
- [ ] Special buffers (`*scratch*`, `*Messages*`, `*daemon*`) are included in the
      rotation by default (matching Emacs), but the cycle never errors when only
      special buffers remain.
- [ ] Bindings `SPC x n` → `(next-buffer)` and `SPC x p` → `(previous-buffer)`
      are registered in `normal` mode in `src/tlisp/core/bindings/normal.tlisp`,
      alongside the existing `SPC x b` / `SPC x s` group.
- [ ] No `C-x` bindings are introduced (SPEC-067 compliance).
- [ ] `next-buffer` / `previous-buffer` are **M-x-discoverable** (docstrings +
      bindings satisfy `command-detail-interactive-p`).
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`,
      and `bun run test:tmax-use` all pass; the eval-24 playbook is green.

## Description

`tmax` can switch buffers only **by name** — `(switch-buffer)` /
`SPC x b` opens a `completing-read` and the user types/selects a name
(`src/tlisp/core/commands/buffers.tlisp:31-40`). There is no way to rotate to
the next or previous buffer by recency without naming it. Emacs provides
`next-buffer` / `previous-buffer` for exactly this, typically bound to
`C-x <right>` / `C-x <left>`. Because SPEC-067 reassigns `C-x` to the vim
decrement-number prefix, tmax binds these to the `SPC x` leader group instead.
All primitives already exist (`buffer-list-details`, `buffer-detail-more-recent-p`,
`buffer-switch`), so this is a pure T-Lisp addition — no new TypeScript primitive
is required.

## User Story

**As a** tmax user flipping between two or three files,
**I want** a single keystroke that takes me to the next (or previous)
recently-used buffer,
**So that** I can ping-pong between buffers without opening the buffer picker
and typing a name each time.

## Problem Statement

The Alpha audit (`alpha-audit-2026-08-01.md`) flagged buffer navigation as
partial: only named `switch-buffer` exists. Concretely:

- `src/tlisp/core/commands/buffers.tlisp` exports `switch-buffer` (a
  `completing-read` picker) and Emacs-conventional aliases (`switch-to-buffer`,
  `current-buffer-name`, `revert-buffer`) but **no** `next-buffer` /
  `previous-buffer`. There is no rotation command anywhere in the tree.
- The primitives needed already exist and are already composed:
  `buffer-list-details` (`src/editor/editor.ts:1096-1111`) returns per-buffer
  `name` + `recency`; `buffer-detail-more-recent-p`
  (`buffers.tlisp:6-7`) compares two details by recency; `stable-sort` +
  `buffer-detail-more-recent-p` + `buffer-list-details` is already used together
  by `buffer-completion-table` (`buffers.tlisp:21`); `buffer-switch`
  (`buffer-ops.ts:88`) switches by name. So the gap is purely a missing pair of
  T-Lisp functions and their bindings.
- SPEC-067 (`docs/specs/SPEC-067-cx-reassigned-vim-decrement.md`) reserves `C-x`
  as the vim decrement prefix. The Emacs-typical `C-x <right>` / `C-x <left>`
  (and `C-x n` / `C-x p`) are therefore unavailable; the SPC-led `SPC x` group
  is the correct home.

## Solution Statement

Add two pure-T-Lisp functions to `src/tlisp/core/commands/buffers.tlisp`:

1. A shared helper `(buffer-recency-list)` that returns buffer names ordered
   most-recent-first: `(mapcar "buffer-detail-name"
   (stable-sort "buffer-detail-more-recent-p" (buffer-list-details)))` (a
   `buffer-detail-name` one-liner extracts the `"name"` field — mirrors
   `buffer-detail-candidate` at line 9).
2. `(defun next-buffer () …)` — find the index of `(buffer-current)` in the
   recency list, `(buffer-switch (nth (mod (+ idx 1) (length list)) list))`.
   `(defun previous-buffer () …)` — same with `(- idx 1)`. `mod` gives the wrap.
3. Bind `SPC x n` → `(next-buffer)` and `SPC x p` → `(previous-buffer)` in
   `normal` mode, in the existing `SPC x` block (`normal.tlisp:247-252`).

Both functions get docstrings (M-x-discoverable). No new TypeScript primitive.
No `C-x` bindings.

## Relevant Files

Read these before implementing (paths verified against the current tree):

- **`src/tlisp/core/commands/buffers.tlisp`** — where the two functions are
  added and exported (extend the `export` list on line 2). Existing pieces they
  compose: `buffer-detail-more-recent-p` (line 6-7, recency comparator),
  `buffer-detail-candidate` (line 9-14, the model for a `buffer-detail-name`
  extractor), `buffer-completion-table` (line 16-21, the exact
  `stable-sort` + `buffer-list-details` pattern to reuse), `switch-buffer-accept`
  (line 23-29, shows `member`/`buffer-switch` usage), `current-buffer-name`
  (line 47-49, the current-buffer read).
- **`src/editor/editor.ts:1096-1111`** — the `buffer-list-details` primitive.
  Each detail hashmap includes `"name"` and `"recency"` (line 1100, 1108). No
  new primitive needed.
- **`src/editor/api/buffer-ops.ts:88-109`** — `buffer-switch`, the switch
  primitive both functions call.
- **`src/tlisp/core/bindings/normal.tlisp:247-252`** — the `SPC x` binding block.
  `SPC x n` / `SPC x p` are added here in `normal` mode. (Already-present
  siblings: `SPC x f`, `SPC x s`, `SPC x b`, `SPC x u`, `SPC x C-c`.)
- **`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`** — the
  `command-detail-interactive-p` rule (docstring OR binding ⇒ M-x-visible).
- **`docs/specs/SPEC-067-cx-reassigned-vim-decrement.md`** — the binding
  constraint cited in Problem Statement; forbids `C-x <key>` bindings.

### New Files

- **`tmax-use/playbooks/eval-24-next-previous-buffer.yaml`** — the e2e playbook
  (authored by a later workflow, not this spec).

## Implementation Plan

### Phase 1 — Recency helper + the two commands

1. In `src/tlisp/core/commands/buffers.tlisp`, add a one-line
   `(defun buffer-detail-name (details) (hashmap-get details "name"))` helper
   (mirrors `buffer-detail-candidate` line 9-14).
2. Add `(defun buffer-recency-list () (mapcar "buffer-detail-name"
   (stable-sort "buffer-detail-more-recent-p" (buffer-list-details))))` — the
   ordered name list, most-recent first. (This is exactly the
   `buffer-completion-table` sort at line 21, minus the candidate wrapping.)
3. Add `(defun next-buffer () …)`:
   - `(let* ((list (buffer-recency-list)) (cur (buffer-current)) (idx (member-index cur list)))`
   - `(buffer-switch (nth (mod (+ idx 1) (length list)) list))`
   - A small `(defun member-index (x list) …)` helper (or inline loop) returns
     the 0-based position of `x` in `list`; if absent, treat as `-1` so
     `next-buffer` lands on index 0. (`member` is already used at line 25; a
     count-based index helper is a few lines.)
4. Add `(defun previous-buffer () …)` — identical but `(- idx 1)`; `mod` wraps
   `-1` to the last index.
5. Add docstrings to both: e.g. `"Switch to the next buffer in recency order."`.
6. Export `next-buffer`, `previous-buffer` (and the helpers if reusable) on the
   module `export` line (line 2).
7. Verify: `bun run typecheck:src`; `(next-buffer)` callable via `--eval`.

### Phase 2 — Bindings

8. In `src/tlisp/core/bindings/normal.tlisp`, in the `SPC x` block
   (lines 247-252), add:
   - `(key-bind "SPC x n" "(next-buffer)" "normal")`
   - `(key-bind "SPC x p" "(previous-buffer)" "normal")`
9. Verify: `bun run typecheck:src`.

### Phase 3 — M-x discoverability + validation

10. Confirm both functions have non-empty docstrings (step 5) so
    `command-detail-interactive-p` admits them to M-x (their `SPC x` bindings
    also qualify them, independently).
11. Run every command under Test Plan; confirm zero regressions and that
    eval-24 is green.

## Test Plan

**Assigned e2e playbook: eval-24**
(`tmax-use/playbooks/eval-24-next-previous-buffer.yaml`, authored by the playbook
workflow). Key assertions (grounded in the harness's `expect` keys:
`result_contains`, `buffer_contains`, `mode`):

- Open three files (FILE_A, FILE_B, FILE_C) so the recency order is C (newest),
  B, A. With C current, `(next-buffer)` → `(buffer-current)` `result_contains`
  the next-most-recent (wrapping handled below).
- Repeated `(next-buffer)` cycles through all three and wraps back to the start
  (assert `(buffer-current)` returns each name in turn).
- `(previous-buffer)` cycles in the opposite direction and wraps.
- `SPC x n` (keys) and `SPC x p` produce the same rotation as the eval calls.
- Rotation works when only one file buffer + `*scratch*` exist (no error).
- `M-x next-buffer` / `M-x previous-buffer` are offered by completion.

**Unit/integration coverage** (in `test/unit/`):

- A T-Lisp-level test (or a `--eval`-driven unit test) asserting
  `buffer-recency-list` is sorted most-recent-first and that `next-buffer` /
  `previous-buffer` move to the correct neighbour with correct wrap-around for
  a 3-buffer and a 1-buffer list. This can be a daemon `--eval` assertion in the
  playbook or a small unit test driving the interpreter with seeded buffers.

## M-x Discoverability

`next-buffer` and `previous-buffer` will appear in M-x completion **iff** each
has a non-empty docstring **or** a keybinding, per `command-detail-interactive-p`
in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. This spec
satisfies both conditions for each command (docstring in step 5, `SPC x n` /
`SPC x p` binding in step 8). **SPEC-067 constraint:** the bindings are
SPC-led, not `C-x <arrow>` / `C-x n` / `C-x p` — `C-x` is the vim
decrement-number prefix and must not be overloaded with Emacs-style buffer
bindings.
