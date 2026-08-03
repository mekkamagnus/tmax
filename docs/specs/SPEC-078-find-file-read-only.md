# Feature: find-file-read-only — open a file view-only

## Goals

- Let a user open a file in a read-only buffer (view it, scroll it, but never accidentally mutate it) — the Emacs `find-file-read-only` affordance.
- Compose the command purely from existing primitives (`find-file-open` + `buffer-set-read-only`); no new TypeScript, no new interpreter surface.
- Make it M-x-discoverable (docstring) and reachable via the existing `SPC x f` file-open prefix family.

## Completion Criteria (Definition of Done)

- [ ] `(find-file-read-only "<path>")` opens the file into a buffer with the correct content AND marks that buffer read-only — verified by `(buffer-current)` showing the path, the buffer text matching the file, and a subsequent `(buffer-insert "x")` being refused with a read-only error (eval-29).
- [ ] The read-only state is scoped to the opened buffer: switching to another buffer and back preserves the read-only flag (the flag is keyed by buffer name in the `readonlyBuffers` set, not a global toggle) — eval-29.
- [ ] A nonexistent path opens an empty new-file buffer that is ALSO read-only (so `find-file-read-only` on a typo'd path can't be silently written to) — eval-29.
- [ ] `(buffer-set-read-only nil)` on the opened buffer re-enables editing (the read-only state is reversible, not permanent) — eval-29.
- [ ] `find-file-read-only` appears in M-x completion (it has a docstring) — eval-29.
- [ ] The command messages the user on open (e.g. `Opened <path>` / `New file <path>`, matching `find-file-open`) so the affordance is observable in `*Messages*` — eval-29.

## Description

Emacs provides `find-file-read-only` to open a file for inspection without risking edits — useful for logs, config under `/etc`, reference files, or anything a user wants to read but not change. tmax has both halves of this at the primitive layer (`find-file-open` opens a file; `buffer-set-read-only` toggles a buffer's read-only flag, enforced by `buffer-insert`/`buffer-delete`/`buffer-delete-range` in `src/editor/api/buffer-ops.ts`) but no command that composes them. A user must `M-x find-file` then `M-x buffer-set-read-only` in two steps.

This spec adds a single T-Lisp `defun`, `find-file-read-only`, in `src/tlisp/core/commands/find-file.tlisp` that calls `find-file-open` and then `(buffer-set-read-only t)`. It is ~6 lines of T-Lisp. No TypeScript changes.

## User Story

As a user inspecting a file I must not modify (a system config, a log, a reference document),
I want to open it view-only with one command (`M-x find-file-read-only`),
so that any accidental keystroke in normal/insert mode is refused rather than silently corrupting the file, and so I can save (`:w`) without overwriting the original because the buffer refuses edits.

## Problem Statement

The alpha audit (memory: Alpha audit 2026-08-01) catalogued TS primitives present but not surfaced at the T-Lisp/M-x layer. `find-file-read-only` is the canonical example:

- `buffer-set-read-only` exists and is enforced: `buffer-ops.ts:766-799` sets the flag in the `readonlyBuffers` set, and `buffer-insert` (line 265), `buffer-delete` (line 312), `buffer-delete-range` (line 452), and `buffer-insert-at-position` (line 362) all short-circuit with a `ReadOnly` error when `isReadonly()` is true. The enforcement is real and tested.
- `find-file-open` exists (`find-file.tlisp:23-44`) and handles both the file-exists and new-file branches, including setting the filename association (`set-buffer-filename`) — the exact path BUG-58 showed is load-bearing for `:w`.
- But there is no `find-file-read-only` command. The two primitives are never composed. `rg find-file-read-only` across `src/`, `test/`, and `docs/specs/` returns zero hits (confirmed). A user wanting view-only must run two M-x commands and remember to set the flag after every open.

## Solution Statement

Add `(defun find-file-read-only (&optional path))` to `src/tlisp/core/commands/find-file.tlisp`. It mirrors the `find-file` minibuffer-prompt pattern (`find-file.tlisp:6-17`): when called with a path, open it directly; when called without, defer to `completing-read` with the file-completion table (reusing `find-file-accept`-style handling, or a dedicated read-only accept handler). After `find-file-open` succeeds, call `(buffer-set-read-only t)`.

Because `find-file-open` runs first and establishes the buffer + filename association, the subsequent `buffer-set-read-only` operates on the now-current buffer by name — the same mechanism `isReadonly()` looks up. No TS changes are required: the read-only enforcement and the file-open path already exist and are independently tested.

Export `find-file-read-only` in the `defmodule` export list (line 2). No key binding is strictly required for M-x discoverability (the docstring alone satisfies `command-detail-interactive-p`), but this spec recommends adding `SPC x f` is NOT remapped (that stays `find-file`); view-only open stays M-x-reachable. If a binding is desired later, it should be SPC-led (e.g. `SPC f r`) — never `C-x` (SPEC-067).

## Relevant Files

Read these files before implementing:

- **`src/tlisp/core/commands/find-file.tlisp`** — the find-file module. `find-file-open` (lines 23-44) is the open primitive to compose; `find-file` (lines 6-17) and `find-file-accept` (lines 19-21) show the minibuffer-prompt pattern to mirror. Add `find-file-read-only` here and export it on line 2.
- **`src/editor/api/buffer-ops.ts`** — `buffer-set-read-only` (lines 766-799) is the primitive this command wraps. Note it accepts `t`/`nil`/boolean/number; the command should pass `t`. The `isReadonly()` helper (lines 62-67) is what every edit primitive consults, so the flag is authoritatively enforced. Lines 265, 312, 362, 452 are the refusal sites — cite these as proof of enforcement.
- **`src/tlisp/core/commands/execute-extended-command.tlisp`** — `command-detail-interactive-p` (lines 15-19): a docstring alone makes `find-file-read-only` M-x-discoverable.
- **`src/tlisp/core/commands/save.tlisp`** — `save-buffer` reads `(buffer-filename)` and writes. Because `find-file-open` sets the filename (line 31 / 41), a read-only buffer still has a filename, but `save-buffer` is NOT blocked by read-only (read-only guards `buffer-insert`/`delete`, not the write primitive). This is acceptable — Emacs `C-x C-q` toggles read-only before saving — and is called out so the implementer does not assume read-only prevents `:w`.
- **`docs/specs/BUG-58-embedded-w-save-no-filename.md`** — establishes that `find-file-open`'s `set-buffer-filename` call is load-bearing; this spec must NOT bypass `find-file-open` (doing so would re-introduce the BUG-58 no-filename-on-`:w` failure mode for the read-only buffer).

### New Files

- **`tmax-use/playbooks/eval-29-find-file-read-only.yaml`** — the e2e playbook (see Test Plan). Authored by the playbook-writing workflow.

## Implementation Plan

1. **Add the defun.** In `src/tlisp/core/commands/find-file.tlisp`, after `find-file-open` (line 44), add:
   ```lisp
   (defun find-file-read-only (&optional path)
     "Open PATH (or prompt) into a read-only buffer — view without editing.
   Composes find-file-open + buffer-set-read-only. The read-only flag is
   reversible: (buffer-set-read-only nil) re-enables editing."
     (if path
       (find-file-open path)
       (completing-read
         "Find file (read-only): "
         "file-completion-table"
         nil nil ""
         "find-file-history"
         "find-file-read-only-accept"))
     (buffer-set-read-only t))
   ```
   Add a matching `find-file-read-only-accept` minibuffer handler mirroring `find-file-accept` (lines 19-21) if the no-arg branch is used. The `(buffer-set-read-only t)` runs on the now-current buffer after open.
2. **Export it.** On line 2, change the export to include `find-file-read-only` (and `find-file-read-only-accept` if added).
3. **Confirm enforcement.** Verify (by reading `buffer-ops.ts`) that the read-only flag is keyed by buffer name in the `readonlyBuffers` set, so switching away and back preserves it — no extra plumbing needed.
4. **(Optional) binding.** Do NOT remap `SPC x f`. If a binding is wanted, add `(key-bind "SPC f r" "(find-file-read-only)" "normal")` in `normal.tlisp` near the file-affordance block — never a `C-x` binding (SPEC-067). Binding is optional for this spec; the docstring already satisfies M-x discoverability.

## Test Plan

- **e2e playbook `eval-29`** (assigned). Key assertions:
  - `(find-file-read-only "<existing>")` opens the file: `(buffer-current)` is `<existing>`, buffer text matches, AND a follow-up `(buffer-insert "x")` returns a read-only error (`ReadOnly`).
  - Read-only is buffer-scoped: open buffer A read-only, switch to buffer B (editable), switch back to A → A is still read-only.
  - Nonexistent path: `(find-file-read-only "/tmp/does-not-exist-xyz")` opens an empty buffer that is ALSO read-only (a follow-up insert is refused).
  - Reversibility: `(buffer-set-read-only nil)` on the read-only buffer re-enables edits (a follow-up `(buffer-insert "x")` succeeds).
  - M-x discoverability: `find-file-read-only` appears in M-x completion (assert via the command completion table).
  - Observable message: the open produces an `Opened`/`New file` message in `*Messages*` (inherited from `find-file-open`).
- **Unit/integration coverage.** Extend `test/unit/editor.test.ts` (or a read-only-focused test) with: `find-file-read-only` sets the read-only flag on the current buffer; `buffer-insert`/`buffer-delete` are refused afterward; the flag is reversible via `buffer-set-read-only nil`. The `buffer-set-read-only` primitive itself is already covered; this test exercises the composition.
- **Regression.** `find-file` (non-read-only) is unchanged. The read-only flag does not block `save-buffer` (documented above), so existing save tests are unaffected.

## M-x Discoverability

A function appears in M-x completion IFF it has a docstring OR a keybinding, per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. `find-file-read-only` gets a docstring, which alone satisfies the predicate — it will appear in M-x completion without requiring a binding. (The optional `SPC f r` binding, if added, is a bonus for keyboard reachability, not a discoverability requirement.) This matches the convention used across the command libraries: every exported `defun` carries a one-line docstring so it is self-documenting in M-x.
