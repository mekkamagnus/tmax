# Feature: `kill-buffer` — close a buffer with a save-on-kill gate at the T-Lisp/M-x layer

## Goals

- Provide an Emacs-conventional `kill-buffer` command at the T-Lisp layer so a
  buffer can be closed from a key, the `:` command line, or M-x — not only via
  the daemon RPC (`kill-buffer` case in `src/server/rpc/handlers/editing.ts:294`).
- Close the **data-loss gap**: killing a modified buffer must prompt to save
  before discarding it, mirroring `save-buffer`'s modified-aware behaviour.
- Make the command **M-x-discoverable** and `:`-reachable (e.g. `:bd`),
  surfacing it through the existing completion/minibuffer infrastructure.

## Completion Criteria (Definition of Done)

- [ ] `(defun kill-buffer &optional name)` exists in
      `src/tlisp/core/commands/buffers.tlisp`, exported from the
      `editor/commands/buffers` module, with a docstring.
- [ ] A new `buffer-kill` TypeScript primitive is exposed to T-Lisp (the buffers
      `Map` is not otherwise mutable from T-Lisp) that removes the named buffer
      from `state.buffers`, captures the active workspace, and switches the
      current buffer to the next-most-recent survivor — reusing the exact
      removal/switch semantics of the `kill-buffer` RPC case
      (`src/server/rpc/handlers/editing.ts:294-311`).
- [ ] Calling `(kill-buffer)` on a buffer where `(buffer-modified-p)` is true
      prompts to save (via `completing-read`, the only working interactive
      mechanism — see Problem Statement); answering "yes" runs `save-buffer`
      then removes the buffer; answering "no" removes it without saving.
- [ ] After `kill-buffer`, the killed name no longer appears in `(buffer-list)`,
      and `(buffer-current)` returns the survivor — eval-22.
- [ ] Killing the current buffer switches to the next buffer by recency
      (using `buffer-detail-more-recent-p`); killing the last live file buffer
      falls back to `*scratch*` rather than leaving no current buffer.
- [ ] `:bd` (and `:bdelete`) on the command line invokes `kill-buffer`
      (handled in `src/tlisp/core/commands/command-line.tlisp`, next to the
      existing `:q`/`:wq` cases).
- [ ] `kill-buffer` is **M-x-discoverable**: it appears in M-x completion
      because it carries a docstring (per `command-detail-interactive-p` in
      `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`).
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`,
      and `bun run test:tmax-use` all pass; the eval-22 playbook is green.

## Description

`tmax` exposes buffer lifecycle operations asymmetrically: the daemon/client RPC
layer has a `kill-buffer` handler (`src/server/rpc/handlers/editing.ts:294-311`),
but there is **no T-Lisp `(defun kill-buffer)`** and therefore no `M-x
kill-buffer`, no `:bd`, and no keybinding. A user driving the embedded editor
(`tmax file.md`) or the TUI client interactively has no way to close a buffer
except by quitting — and there is no save-on-close protection at all. This spec
adds `kill-buffer` to the T-Lisp `editor/commands/buffers` module, backed by a
new `buffer-kill` TypeScript primitive (T-Lisp cannot mutate the buffers `Map`
on its own), and gates removal on a save prompt when the buffer is modified.

## User Story

**As a** tmax user with several buffers open,
**I want** to close the current (or a named) buffer and be prompted to save if
it has unsaved changes,
**So that** I can manage my buffer list without losing edits and without
reaching for `:q` (which quits the whole editor).

## Problem Statement

The Alpha audit (`alpha-audit-2026-08-01.md`) flagged the buffer-lifecycle layer
as partial at the T-Lisp/M-x layer. Concretely for `kill-buffer`:

- The command exists **only** as an RPC case
  (`src/server/rpc/handlers/editing.ts:294-311`). It deletes the buffer from
  `state.buffers`, re-captures the workspace, and syncs frames — but it is
  reachable solely by a JSON-RPC client sending `command: "kill-buffer"`. There
  is no T-Lisp wrapper, so M-x, `:`, and keybindings cannot reach it.
- The buffer primitives T-Lisp **does** have (`src/editor/api/buffer-ops.ts`:
  `buffer-list`, `buffer-switch`, `buffer-modified-p`, `buffer-filename`,
  `set-buffer-modified-p`) are all **read or per-buffer**; none can remove an
  entry from the `buffers` `Map`. So even a hand-written `(defun kill-buffer …)`
  in T-Lisp could not actually delete the buffer without a new primitive.
- There is **no save-on-kill gate anywhere**: the RPC handler deletes the buffer
  unconditionally; `editor-quit` (the only other exit) likewise discards unsaved
  buffers. Killing a modified buffer silently destroys edits.
- The interactive-prompt gap: `read-string` is a **sync stub** that returns `''`
  immediately (`src/editor/tlisp-api.ts:1314-1319`) — there is no real
  synchronous y/n prompt. The only working interactive mechanism is
  `completing-read` (used by `switch-buffer`, `find-file`), so the save prompt
  must be a `completing-read` over a yes/no candidate table.

## Solution Statement

Add a **`buffer-kill`** TypeScript primitive (`src/editor/api/buffer-ops.ts`,
mirroring the RPC case's removal + workspace capture), then a T-Lisp
**`kill-buffer`** in `src/tlisp/core/commands/buffers.tlisp` that:

1. Resolves the target name (`&optional name`, defaulting to
   `(buffer-current)`).
2. If `(buffer-modified-p)` is true for that buffer, opens a `completing-read`
   with a `"Save buffer NAME before killing? (yes/no)"` prompt over a two-entry
   table (`yes` / `no`); the accept function runs `save-buffer` on `yes` and
   does nothing on `no`.
3. Calls `(buffer-kill name)` to remove it; `buffer-kill` switches the current
   buffer to the next-most-recent survivor (or `*scratch*` if none remain),
   reusing the RPC handler's proven switch logic so behaviour is identical
   across daemon/client and embedded paths.
4. Messages `"Killed <name>"`.

Wire `:bd` / `:bdelete` to `(kill-buffer)` in
`src/tlisp/core/commands/command-line.tlisp`. Give `kill-buffer` a docstring so
it is M-x-discoverable. **No C-x bindings** (SPEC-067 reserves `C-x` for the vim
decrement-number prefix); a SPC-led binding is optional and tracked separately
so as not to collide with the existing `SPC x` group.

## Relevant Files

Read these before implementing (paths verified against the current tree):

- **`src/tlisp/core/commands/buffers.tlisp`** — where `kill-buffer` is added.
  Existing exports: `buffer-detail-more-recent-p` (line 6, the recency
  comparator), `switch-buffer`, `current-buffer-name`, `buffer-completion-table`
  (lines 16-21, the model for the yes/no completion table). The new `defun` and
  its completion table are added here and exported on line 2.
- **`src/editor/api/buffer-ops.ts`** — where the `buffer-kill` primitive is
  added. `createBufferOps` (line 40) closes over `buffers` (the `Map`), the
  setters, and `access`. `buffer-switch` (line 88) is the model for arg
  validation; `buffer-modified-p` (line 540) is the gate read. **Note:** to
  switch to the next buffer by recency the primitive needs the same recency data
  `buffer-list-details` returns (`src/editor/editor.ts:1096-1111`), so
  `buffer-kill` should reuse `getBufferDetails()` to pick the survivor.
- **`src/server/rpc/handlers/editing.ts:294-311`** — the existing RPC `kill-buffer`
  case. The new TS primitive must replicate its semantics (delete from
  `state.buffers`, `captureActiveWorkspace`, switch survivor, sync frames) so the
  T-Lisp path and RPC path agree. Consider having the RPC case delegate to
  `(buffer-kill)` so there is one implementation.
- **`src/tlisp/core/commands/command-line.tlisp`** — add `:bd` / `:bdelete`
  clauses alongside the existing `:q` / `:wq` cases (the `editor-dispatch-command-line`
  `cond`).
- **`src/tlisp/core/commands/save.tlisp`** — `save-buffer` (the function the
  prompt calls on "yes"); note it returns early with a message if the buffer has
  no associated file, which `kill-buffer` must tolerate (a file-less modified
  buffer should still be killable after the prompt).
- **`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`** — the
  `command-detail-interactive-p` rule: a command is M-x-visible IFF it has a
  non-empty docstring OR a keybinding. `kill-buffer` gets a docstring.
- **`src/editor/editor.ts`** — `getBufferDetails()` (drives
  `buffer-list-details`, line 1096) and `defineRaw` (the registration mechanism
  for the new `buffer-kill` primitive).
- **`docs/specs/SPEC-067-cx-reassigned-vim-decrement.md`** — the binding
  constraint: **do not** use `C-x` for anything Emacs-y. No `C-x k`.

### New Files

- **`tmax-use/playbooks/eval-22-kill-buffer.yaml`** — the e2e playbook (authored
  by a later workflow, not this spec).

## Implementation Plan

### Phase 1 — `buffer-kill` TypeScript primitive

1. In `src/editor/api/buffer-ops.ts`, inside `createBufferOps`, add
   `api.set("buffer-kill", …)` taking an optional name (default = current
   buffer's name). Validate the name exists; if not, return a `BufferError`.
2. Implement removal + survivor selection: build a recency-ordered list via the
   same data `getBufferDetails()` exposes (the primitive does not have
   `getBufferDetails` in scope, so either thread it in or compute recency from
   `bufferMetadata`; the cleanest route is to expose a small helper on `Editor`
   and call it from the closure). Remove the entry from `buffers`. Pick the next
   survivor: the most-recent **other** buffer, or `*scratch*` if the map is empty
   / only special buffers remain. Call `setCurrentBuffer(survivor)`.
3. Match the RPC case's workspace-capture + frame-sync side effects by having
   the RPC `kill-buffer` case call `(buffer-kill name)` through the editor's
   eval, so both paths share one implementation (avoids drift — the same lesson
   as BUG-58's divergent open paths).
4. Verify: `bun run typecheck:src`.

### Phase 2 — T-Lisp `kill-buffer` with save gate

5. In `src/tlisp/core/commands/buffers.tlisp`, add a `kill-buffer-yes-no-table`
   completion table returning two candidates (`yes`, `no`) and a
   `kill-buffer-save-accept` accept function that runs `save-buffer` on `"yes"`.
6. Add `(defun kill-buffer (&optional name) …)`:
   - Resolve `name` (default `(buffer-current)`).
   - When `(buffer-modified-p)` is true, `(completing-read …)` with the yes/no
     table and `kill-buffer-save-accept`; the completion switches the editor to
     `mx` mode while active (same as `switch-buffer`).
   - Call `(buffer-kill name)`, then `(message (concat "Killed " name))`.
   - **Why `completing-read` and not `read-string`:** `read-string` is a sync
     stub (`src/editor/tlisp-api.ts:1314-1319`) that cannot actually read input.
     `completing-read` is the only real interactive prompt and is already used
     by `switch-buffer`/`find-file`.
7. Export `kill-buffer` (and the helper functions) on the module's `export`
   line (line 2).
8. Verify: `bun run typecheck:src`; `(kill-buffer)` is callable via `--eval`.

### Phase 3 — `:bd` command-line + M-x discoverability

9. In `src/tlisp/core/commands/command-line.tlisp`, add
   `((or (string= line "bd") (string= line "bdelete")) (kill-buffer))` to the
   `editor-dispatch-command-line` `cond`, next to the `:q` clause.
10. Confirm `kill-buffer`'s docstring is non-empty (it is, from step 6) so
    `command-detail-interactive-p` admits it to M-x completion. No extra
    registration is needed.
11. Verify: M-x completion includes `kill-buffer` (eval-22 assertion).

### Phase 4 — Validation

12. Run every command under Test Plan; confirm zero regressions and that
    eval-22 is green.

## Test Plan

**Assigned e2e playbook: eval-22** (`tmax-use/playbooks/eval-22-kill-buffer.yaml`,
authored by the playbook workflow). Key assertions the playbook must cover
(grounded in the eval harness's supported `expect` keys: `result_contains`,
`buffer_contains`, `mode`):

- Open two files (FILE1, FILE2); `(buffer-list)` `result_contains` both names.
- `(kill-buffer)` on the current unmodified buffer → `(buffer-list)` no longer
  contains it; `(buffer-current)` returns the survivor.
- Modify a buffer (`(buffer-insert …)`), then `(kill-buffer)` → the
  save-on-kill gate fires (mode flips to `mx`); drive the prompt to "yes" →
  file is written and buffer removed; "no" → buffer removed, file unchanged.
- Killing a buffer with no associated file does not error.
- `:bd` on the command line kills the current buffer.
- `M-x kill-buffer` is offered by completion (the docstring makes it
  interactive).

**Unit/integration coverage** (in `test/unit/`):

- A unit test for the `buffer-kill` primitive: removes the named buffer, picks
  the recency-correct survivor, falls back to `*scratch*` when none remain,
  errors on an unknown name. Drive `createBufferOps` directly (model on the
  existing `buffer-switch` unit tests).
- A unit test asserting the RPC `kill-buffer` case and the T-Lisp `(kill-buffer)`
  path produce identical buffer-list state after a kill (the single-implementation
  guarantee).

## M-x Discoverability

`kill-buffer` will appear in M-x completion **iff** it has a non-empty docstring
**or** a keybinding, per `command-detail-interactive-p` in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. This spec
satisfies that by giving `kill-buffer` a docstring in step 6. A SPC-led binding
is deliberately **not** added here (to avoid colliding with the `SPC x` group
and to keep the change minimal); if a binding is wanted later, `SPC x k` is the
natural Emacs-`C-x k` analogue and respects SPEC-067 (which forbids the literal
`C-x k`). No `C-x <key>` binding is proposed.
