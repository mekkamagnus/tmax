# Feature: `rename-buffer`, `bury-buffer`, `balance-windows` — buffer/window hygiene

## Goals

- Add Emacs-conventional `rename-buffer` (rename the current buffer's display
  name, distinct from its file path) and `bury-buffer` (demote the current
  buffer to the bottom of the recency order) at the T-Lisp/M-x layer.
- Add `balance-windows` to equalize window heights/widths after splits, so a
  session with several panes can be reset to even sizes in one command.
- Make all three **M-x-discoverable** via docstrings and give the buffer ones
  SPC-led bindings in the existing `SPC x` group (SPEC-067: no `C-x` bindings).

## Completion Criteria (Definition of Done)

- [ ] `(defun rename-buffer (new-name))` exists in
      `src/tlisp/core/commands/buffers.tlisp`, exported, with a docstring, backed
      by a new `buffer-rename` TypeScript primitive that re-keys the buffers
      `Map` and `bufferMetadata` for the current buffer — eval-35.
- [ ] `(defun bury-buffer (&optional name))` exists in
      `src/tlisp/core/commands/buffers.tlisp`, exported, with a docstring, backed
      by a new `buffer-bury` TypeScript primitive that demotes the buffer's
      recency so it sinks in `buffer-list-details` ordering — eval-35.
- [ ] `(defun balance-windows)` exists in
      `src/tlisp/core/commands/windows.tlisp`, exported, with a docstring, backed
      by a new `balance-windows` TypeScript primitive that equalizes window
      heights (horizontal splits) and widths (vertical splits) across all windows
      — eval-35.
- [ ] `rename-buffer` does **not** change `(buffer-filename)` (renaming a buffer
      is a display-name change, not a save-as); a subsequent `save-buffer` still
      writes to the original file.
- [ ] `bury-buffer` on the current buffer leaves the current buffer in place but
      moves it to the **least-recent** position, so `next-buffer`/`switch-buffer`
      rank it last; `bury-buffer` of a non-current named buffer buries that one.
- [ ] `balance-windows` on a 2-window horizontal split yields equal heights
      (within 1 row); on a vertical split, equal widths; with one window, no-op.
- [ ] Bindings `SPC x r` → `(rename-buffer …)` (or a minibuffer-prompted wrapper)
      and `SPC x z` → `(bury-buffer)` in `normal` mode in
      `src/tlisp/core/bindings/normal.tlisp`, alongside the existing `SPC x`
      group; `C-w =` → `(balance-windows)` (extends the existing `C-w` window
      prefix at `windows.tlisp:43`).
- [ ] No `C-x` bindings are introduced (SPEC-067 compliance).
- [ ] All three commands are **M-x-discoverable** (docstrings + bindings satisfy
      `command-detail-interactive-p`).
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`,
      and `bun run test:tmax-use` all pass; the eval-35 playbook is green.

## Description

Three Emacs-parity hygiene commands are absent from tmax's T-Lisp layer.
`rename-buffer` lets a user give a buffer a memorable display name without
touching its file (useful for two buffers visiting same-named files in different
directories, or for `*scratch*`-style scratch buffers). `bury-buffer` demotes a
buffer to the bottom of the recency order so it stops appearing first in
`switch-buffer`/`next-buffer`. `balance-windows` re-equalizes pane sizes after a
sequence of splits and resizes. None of the three exist anywhere in the tree
(confirmed: no `rename-buffer`/`bury-buffer`/`balance-windows` in `src/`). Each
needs a small TypeScript primitive because T-Lisp cannot mutate the buffers
`Map`, the recency metadata, or the windows array directly.

## User Story

**As a** tmax user with a cluttered buffer list and an uneven window layout,
**I want** to rename a buffer so I can tell same-named files apart, bury a buffer
so it stops jumping to the front of the picker, and re-balance my panes after
several splits,
**So that** my session stays navigable as it grows.

## Problem Statement

The Alpha audit (`alpha-audit-2026-08-01.md`) flagged several buffer/window
hygiene commands as missing at the T-Lisp/M-x layer. Concretely (verified by
grepping the tree):

- **`rename-buffer`**: no `rename-buffer` / `buffer-rename` / `set-buffer-name`
  primitive exists in `src/`. Buffers are keyed by name in the `buffers`
  `Map<string, TextBuffer>` (`src/editor/api/buffer-ops.ts`) with parallel
  metadata in `bufferMetadata` (`src/editor/editor.ts:129`
  `Map<string, { filename?, modified, recency }>`). T-Lisp cannot re-key either
  map, so a new `buffer-rename` primitive is required. The display name must be
  kept distinct from `buffer-filename` (renaming is not save-as).
- **`bury-buffer`**: recency is mutated only inside `Editor` via private
  `touchBuffer`/`updateBufferMetadata`
  (`src/editor/editor.ts:2239, 2767-2786`); there is no T-Lisp primitive to
  *demote* recency, and `buffer-detail-more-recent-p`
  (`src/tlisp/core/commands/buffers.tlisp:6-7`) ranks buffers by the `recency`
  field that `buffer-list-details` exposes (`src/editor/editor.ts:1108`). So a
  `buffer-bury` primitive that lowers the recency value is required for
  `bury-buffer` to have any effect on `switch-buffer`/`next-buffer` ordering.
- **`balance-windows`**: window sizing is delta-only
  (`window-resize-height`/`window-resize-width` in
  `src/editor/api/window-ops.ts:223, 263`), there is no absolute
  `window-set-height` setter and no `window-height` reader exposed to T-Lisp.
  `split-window` (`window-ops.ts:55-99`) shows the size model: heights/widths
  derive from `getTerminalSize()` and the optional `height`/`width` fields on
  the `Window` contract (`src/core/contracts/editor.ts:148-158`). Equalizing
  across all windows is cleanest as one dedicated `balance-windows` primitive
  that reads `getWindows()`/`setWindows()`/`getTerminalSize()` (all in scope of
  `createWindowOps`).

## Solution Statement

Three primitives + three T-Lisp wrappers:

1. **`buffer-rename`** TS primitive (`src/editor/api/buffer-ops.ts`): for the
   current buffer, look up its `TextBuffer` and metadata, delete the old name
   from both `buffers` and `bufferMetadata`, re-insert under `new-name`
   preserving `filename`/`modified`/`recency`, then `setCurrentBuffer` keeps the
   same buffer object current. The T-Lisp `(rename-buffer new-name)` wrapper
   validates the name is non-empty and not already in use, then calls it and
   messages `"Renamed to <new-name>"`. **Filename is untouched.**
2. **`buffer-bury`** TS primitive (`src/editor/api/buffer-ops.ts`, needs the
   `bufferMetadata` mutation path threaded in — see Implementation Plan): for the
   named buffer (default current), set its recency to the **minimum** of the
   current recency values (so it sinks below all others in
   `buffer-detail-more-recent-p` ordering). The T-Lisp `(bury-buffer)` wrapper
   calls it and reports the buried name.
3. **`balance-windows`** TS primitive (`src/editor/api/window-ops.ts`): group
   windows by split axis, then set each window's `height`/`width` to
   `floor(terminalSize / count)` (the same `getTerminalSize()`-derived math
   `split-window` uses at lines 67-99), assigning the remainder to the last
   window so heights sum to the terminal size. The T-Lisp wrapper is a thin
   `(balance-windows)` calling the primitive.

Bindings: `SPC x r` (rename — opens a minibuffer read for the new name via
`read-from-minibuffer`/`completing-read`), `SPC x z` (bury), and `C-w =`
(balance, extending the existing `C-w` window prefix registered at
`src/tlisp/core/commands/windows.tlisp:43`). All get docstrings. No `C-x`
bindings (SPEC-067).

## Relevant Files

Read these before implementing (paths verified against the current tree):

- **`src/tlisp/core/commands/buffers.tlisp`** — where `rename-buffer` and
  `bury-buffer` are added and exported (extend the `export` list on line 2).
  Relevant existing pieces: `buffer-detail-more-recent-p` (line 6-7, the
  recency comparator `bury-buffer` affects), `current-buffer-name` (line 47-49),
  `switch-buffer-accept` (line 23-29, the model for a name-validating accept).
- **`src/editor/api/buffer-ops.ts`** — where `buffer-rename` and `buffer-bury`
  primitives are added inside `createBufferOps` (line 40). `buffer-switch`
  (line 88) is the model for arg validation; the `buffers` `Map` closure gives
  write access to the key set. **Note:** `buffer-bury` needs to mutate
  `bufferMetadata` recency, which `createBufferOps` does **not** currently close
  over — the recency mutator lives on `Editor` (`touchBuffer`/
  `updateBufferMetadata`, `editor.ts:2767-2786`). Thread a `renameBuffer` /
  `buryBuffer` callback from `Editor` into `createBufferOps` (mirroring how
  `setCurrentFilename`/`setBufferModified` are already threaded in, lines 46-47),
  or expose two new `defineRaw` primitives on `Editor` itself (like
  `buffer-list-details` at `editor.ts:1096`). The `defineRaw` route is simpler.
- **`src/editor/editor.ts`** — `bufferMetadata` (line 129),
  `touchBuffer`/`updateBufferMetadata` (lines 2239, 2767-2786),
  `getBufferDetails` (drives `buffer-list-details`, line 1096), `defineRaw`
  registration mechanism. `buffer-rename` / `buffer-bury` are cleanest as
  `defineRaw` primitives here, since they need private metadata access.
- **`src/tlisp/core/commands/windows.tlisp`** — where the `balance-windows`
  wrapper is added and exported (extend the `export` list on line 2). The
  existing `C-w` prefix binding (line 43) is where `C-w =` is registered (a
  prefix-dispatch addition, mirroring how `s`/`v`/`w`/`q` already dispatch).
- **`src/editor/api/window-ops.ts`** — where the `balance-windows` primitive is
  added inside `createWindowOps` (line 30). `split-window` (lines 55-99) is the
  size model: it reads `getTerminalSize()` (line 67) and derives
  `height`/`width` from it; `setWindows` (line 26) writes the array.
  `window-resize-height` (line 223) and `window-resize-width` (line 263) are the
  delta-only setters that motivate a dedicated balance primitive.
- **`src/core/contracts/editor.ts:148-158`** — the `Window` contract: optional
  `height` (rows) and `width` (columns) fields, `splitType`
  `'horizontal' | 'vertical'`.
- **`src/tlisp/core/bindings/normal.tlisp:247-252`** — the `SPC x` binding block
  where `SPC x r` / `SPC x z` are added in `normal` mode.
- **`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`** — the
  `command-detail-interactive-p` rule (docstring OR binding ⇒ M-x-visible).
- **`docs/specs/SPEC-067-cx-reassigned-vim-decrement.md`** — the binding
  constraint: no `C-x <key>` (so no Emacs `C-x b` bury or `C-w`-via-`C-x`
  confusion); the `C-w` window prefix is unaffected (it is already the tmax
  window prefix, see `windows.tlisp:43`).

### New Files

- **`tmax-use/playbooks/eval-35-buffer-window-hygiene.yaml`** — the e2e playbook
  (authored by a later workflow, not this spec).

## Implementation Plan

### Phase 1 — `rename-buffer`

1. In `src/editor/editor.ts`, add a `defineRaw("buffer-rename", …)` primitive
   (next to `buffer-list-details`, line 1096) that: takes `new-name`, finds the
   current buffer's old name, errors if `new-name` already exists or is empty,
   then re-keys `buffers` and `bufferMetadata` (preserving `filename`/`modified`/
   `recency`) and keeps the same buffer object current. Returns the new name.
2. In `src/tlisp/core/commands/buffers.tlisp`, add `(defun rename-buffer
   (new-name) …)` that calls `(buffer-rename new-name)` and messages
   `(concat "Renamed to " new-name)`. Add a docstring.
3. (Optional, M-x-friendly) add a `rename-buffer-interactive` wrapper that reads
   the new name via `read-from-minibuffer` (`minibuffer.tlisp:116`) — note
   `read-string` is a stub (`tlisp-api.ts:1314-1319`), so use
   `read-from-minibuffer`/`completing-read`.
4. Export `rename-buffer` on line 2. Verify: `bun run typecheck:src`.

### Phase 2 — `bury-buffer`

5. In `src/editor/editor.ts`, add a `defineRaw("buffer-bury", …)` primitive that:
   takes an optional name (default current), computes
   `min(recency across bufferMetadata) - 1`, sets that buffer's recency to it via
   `updateBufferMetadata(name, { recency })` so it ranks below all others in
   `buffer-detail-more-recent-p`. Returns the buried name.
6. In `buffers.tlisp`, add `(defun bury-buffer (&optional name) …)` calling
   `(buffer-bury name)` with a docstring; message the buried name.
7. Export `bury-buffer` on line 2. Verify: `bun run typecheck:src`.

### Phase 3 — `balance-windows`

8. In `src/editor/api/window-ops.ts`, add an `ops.set("balance-windows", …)`
   primitive: read `getWindows()` and `getTerminalSize()` (line 28). If one
   window, return nil. Determine the dominant axis from the windows' `splitType`
   (or from whether `width` differs across windows): for horizontal splits set
   each `height` to `floor((terminalSize.height - statusRows) / count)` with the
   remainder on the last; for vertical splits set each `width` to
   `floor(terminalSize.width / count)` likewise. `setWindows(updated)`.
9. In `windows.tlisp`, add `(defun balance-windows () (balance-windows))`-style
   wrapper — but since the primitive is named `balance-windows`, expose it via
   the module export directly (the T-Lisp name and primitive name can coincide;
   alternatively name the primitive `window-balance` and the T-Lisp command
   `balance-windows` for Emacs parity — prefer the latter to match the
   `window-*` primitive convention).
10. Export `balance-windows` on the windows module `export` line (line 2).
    Verify: `bun run typecheck:src`.

### Phase 4 — Bindings + M-x discoverability

11. In `src/tlisp/core/bindings/normal.tlisp` (`SPC x` block, lines 247-252),
    add `(key-bind "SPC x r" "(rename-buffer-interactive)" "normal")` and
    `(key-bind "SPC x z" "(bury-buffer)" "normal")`.
12. Extend the `C-w` window prefix (registered at `windows.tlisp:43`) so `C-w =`
    dispatches to `(balance-windows)` — mirror how the existing `s`/`v`/`w`/`q`
    keys dispatch under `C-w` (the `editor-window-prefix` handler at
    `editor.ts:1184`).
13. Confirm all three commands have non-empty docstrings (steps 2, 6, 9) so
    `command-detail-interactive-p` admits them to M-x (their bindings also
    qualify them independently).
14. Run every command under Test Plan; confirm zero regressions and that
    eval-35 is green.

## Test Plan

**Assigned e2e playbook: eval-35**
(`tmax-use/playbooks/eval-35-buffer-window-hygiene.yaml`, authored by the
playbook workflow). Key assertions (grounded in the harness's `expect` keys:
`result_contains`, `buffer_contains`, `mode`):

- Open a file; `(rename-buffer "work")` → `(buffer-current)`
  `result_contains "work"`; `(buffer-filename)` still returns the original path
  (rename is not save-as); `(save-buffer)` still writes the original file.
- Renaming to an already-used name errors / is rejected.
- With buffers A (current), B, C all visited, `(bury-buffer)` → A's recency is
  now lowest; `(buffer-list-details)` ranks A last, so `(switch-buffer)`
  candidates and `(next-buffer)` no longer prefer A. Burying a named non-current
  buffer (e.g. `(bury-buffer "B")`) buries B specifically.
- After `(split-window "horizontal")` then a manual `window-resize-height`,
  `(balance-windows)` → the two windows have equal height (within 1 row); with
  one window, `(balance-windows)` is a no-op.
- `SPC x r`, `SPC x z`, and `C-w =` produce the same effects as the eval calls.
- `M-x rename-buffer` / `M-x bury-buffer` / `M-x balance-windows` are offered by
  completion (docstrings make them interactive).

**Unit/integration coverage** (in `test/unit/`):

- A unit test for `buffer-rename`: re-keys the buffers map + metadata, preserves
  `filename`/`modified`/`recency`, rejects empty/duplicate names, leaves
  `(buffer-filename)` unchanged. Drive `createBufferOps` (or `defineRaw`) with
  seeded buffers.
- A unit test for `buffer-bury`: sets the named buffer's recency below all
  others, so `getBufferDetails()` (and thus `buffer-list-details`) ranks it last.
- A unit test for `balance-windows`: given a 2-window horizontal split with
  unequal heights, equalizes them; given a vertical split, equalizes widths;
  given one window, no-op; heights/widths sum to the terminal size (within
  rounding).

## M-x Discoverability

`rename-buffer`, `bury-buffer`, and `balance-windows` will each appear in M-x
completion **iff** it has a non-empty docstring **or** a keybinding, per
`command-detail-interactive-p` in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. This spec
satisfies both conditions for each (docstrings in Phases 1-3, bindings in
Phase 4). **SPEC-067 constraint:** the bindings are SPC-led (`SPC x r`,
`SPC x z`) or under the existing `C-w` window prefix (`C-w =`) — no `C-x <key>`
bindings are introduced. (`C-w` is the tmax window prefix per
`windows.tlisp:43`, unrelated to SPEC-067's `C-x` reassignment.)
