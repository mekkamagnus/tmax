# Feature: write-file — canonical Emacs save-as name + discoverable binding

## Goals

- Give tmax the Emacs-canonical `write-file` name for "save the current buffer to a NEW path" (save-as), as a discoverable alias of the existing `save-file`.
- Expose a memorable leader binding (`SPC f w`) so save-as is reachable from the keyboard, not only via M-x.
- Keep the implementation T-Lisp-only (an alias + a binding), with zero TypeScript changes — `save-file` already accepts a filename and does the right thing.

## Completion Criteria (Definition of Done)

- [ ] `(write-file "<path>")` writes the current buffer to `<path>`, re-associates the buffer with that path, and clears the modified flag — i.e. it behaves exactly like `(save-file "<path>")`. Verified by: status line reports the new filename, `(buffer-modified-p)` returns `nil`, and `cat <path>` shows the buffer text (eval-28).
- [ ] `(write-file "<path>")` messages `"Saved <path>"` exactly as `save-file` does (the alias must share one code path, not reimplement the write) — eval-28.
- [ ] `write-file` appears in M-x completion alongside `save-file` and `save-buffer` (it has a docstring and a binding, so it satisfies `command-detail-interactive-p`) — eval-28.
- [ ] `SPC f w` in normal mode opens the minibuffer / accepts a path and runs save-as through the bound command (the binding is live in `normal.tlisp`) — eval-28.
- [ ] `write-file` honors the same concurrent-modification guard and backup behavior as `save-buffer` (no regression): passing the same path twice is idempotent, and `:w!`-style force is still available through `save-buffer`'s `force` arg — eval-28.
- [ ] No C-x binding is added; the binding is `SPC f w` (SPEC-067: `C-x` is the vim decrement prefix, NOT an Emacs-style prefix) — confirmed by grepping `normal.tlisp` for any new `C-x` line and finding none — eval-28.

## Description

Emacs users reach for `write-file` as the canonical name for "save the current buffer under a different filename" (save-as). tmax already has the behavior — `save-file` in `src/tlisp/core/commands/save.tlisp:41-43` is a thin wrapper over `save-buffer` that forwards a filename — but it has neither the canonical name nor a discoverable key binding, so a user typing `M-x write-file` finds nothing and must learn the non-standard `save-file` name.

This spec adds `write-file` as a documented alias of `save-file` (same `defun` body, one canonical code path) and binds it to `SPC f w` in normal mode. It is a pure T-Lisp change: no TypeScript primitives, no new module, no interpreter work. The whole feature is ~5 lines in `save.tlisp` plus one `key-bind` line in `bindings/normal.tlisp`.

## User Story

As an Emacs-experienced user (or anyone following Emacs conventions) editing a buffer in tmax,
I want to type `M-x write-file` (or `SPC f w`) to save the current buffer to a new path,
so that I can save-as with the command name and key I already know, instead of guessing tmax's private `save-file` name.

## Problem Statement

The prior alpha audit (memory: Alpha audit 2026-08-01) catalogued editor affordances present at the TS-primitive layer but missing/partial at the T-Lisp/M-x layer. `write-file` is exactly that gap: the underlying save-as capability exists and is wired (`save-file` → `save-buffer` → `write-file-content`), but the command is surfaced only under the non-standard name `save-file`, and that name has no key binding at all (it is M-x-only). Concretely:

- `src/tlisp/core/commands/save.tlisp` exports `save-buffer`, `quick-save`, `save-file` — but not `write-file`. So `M-x write-file` yields nothing.
- The save cluster has key bindings for `quick-save` (`SPC x s`, `normal.tlisp:249`) but nothing for save-as. `SPC f` is not yet used as a prefix in `normal.tlisp` (verified: the only `SPC f` occurrence is `SPC x f` → `find-file`, line 248), so `SPC f w` is free.
- SPEC-067 explicitly freed `C-x` for its vim meaning (decrement-number). The Emacs convention `C-x C-w` is therefore off-limits (see `normal.tlisp:243-245` comment), so this spec must NOT propose any `C-x` binding. The SPC leader is the correct path.

## Solution Statement

Add `write-file` as an alias of `save-file` in `src/tlisp/core/commands/save.tlisp`. The alias is a separate `defun` with the same body and its own docstring (so it is independently discoverable in M-x and self-documenting), not a `defalias`/`fset` indirection — matching the existing pattern where `quick-save` and `save-file` are sibling `defun`s that both delegate to `save-buffer`. Export it in the `defmodule` export list.

Bind `SPC f w` to `write-file` in `src/tlisp/core/bindings/normal.tlisp`, introducing the `SPC f` (file) prefix in the same style as the existing `SPC x` prefix block (lines 247-252). The binding is normal-mode only; save-as from insert/command modes is out of scope.

Because the alias delegates to the same `save-buffer` code path, it inherits — for free — the concurrent-modification guard (#65 / BUG-55), backup-file creation, filename re-association (`set-buffer-filename`), modified-flag clearing, and the `Saved <path>` message. No behavior is reimplemented.

## Relevant Files

Read these files before implementing:

- **`src/tlisp/core/commands/save.tlisp`** — the save command module. `save-buffer` (lines 7-33) is the canonical implementation; `save-file` (lines 41-43) is the existing save-as wrapper this spec aliases. Add `write-file` as a sibling `defun` here, and add it to the `export` list on line 2.
- **`src/tlisp/core/bindings/normal.tlisp`** — the key-binding registry. The `SPC x` prefix block lives at lines 247-252. Add `SPC f w` → `write-file` in a new `SPC f` prefix block nearby, mirroring the style. The SPEC-067 note at lines 243-245 explains why no `C-x` binding may be added.
- **`src/tlisp/core/commands/execute-extended-command.tlisp`** — defines `command-detail-interactive-p` (lines 15-19): a function is M-x-discoverable IFF it has a non-empty docstring OR a binding. `write-file` gets BOTH (a docstring and `SPC f w`), so it will appear in M-x completion. Cite this when justifying the docstring requirement.
- **`docs/specs/SPEC-067-vim-parity-implementation.md`** — the spec that freed `C-x` for vim decrement. This spec explicitly defers to it: no `C-x` binding.
- **`docs/specs/BUG-58-embedded-w-save-no-filename.md`** — documents the `set-buffer-filename` / buffer-association invariant `save-buffer` relies on. The `write-file` alias inherits this path unchanged.

### New Files

- **`tmax-use/playbooks/eval-28-write-file.yaml`** — the e2e playbook driving `write-file` through the real daemon/client stack (see Test Plan). Authored by the separate playbook-writing workflow, not this spec.

## Implementation Plan

1. **Add the `write-file` defun.** In `src/tlisp/core/commands/save.tlisp`, immediately after `save-file` (line 43), add:
   ```lisp
   (defun write-file (filename)
     "Save the current buffer to FILENAME and re-associate it (save-as).
   Emacs-canonical name for save-as; delegates to save-buffer. Bound to SPC f w.
   Note: SPC-led, not C-x C-w — SPEC-067 reserves C-x for vim decrement."
     (save-buffer filename))
   ```
   The body is identical to `save-file` deliberately: both names share one code path. The distinct docstring keeps each self-documenting in M-x.
2. **Export it.** On line 2, change `(export save-buffer quick-save save-file)` to `(export save-buffer quick-save save-file write-file)`.
3. **Bind `SPC f w`.** In `src/tlisp/core/bindings/normal.tlisp`, after the `SPC x` block (line 252), add a new `SPC f` (file) prefix block:
   ```lisp
   ;; SPC f prefix (file operations). SPEC-067: C-x is the vim decrement
   ;; prefix, NOT an Emacs-style prefix — so save-as is SPC-led, not C-x C-w.
   (key-bind "SPC f w" "(write-file ...)" "normal")
   ```
   The exact binding body (raw path vs. minibuffer `completing-read`) should match how `find-file` resolves its argument — check whether `find-file`'s minibuffer pattern (`find-file.tlisp:6-17`) is reused or whether `write-file` should accept a literal path from the caller. Prefer the minibuffer prompt path so the binding is interactive; if a `read-file-name`/`completing-read` helper exists, reuse it. If the implementation needs a small minibuffer wrapper, add it alongside the binding.
4. **Verify M-x discoverability.** Confirm via `command-detail-interactive-p` semantics that `write-file` now appears in M-x completion (it has a docstring AND a binding).

## Test Plan

- **e2e playbook `eval-28`** (assigned). Key assertions the playbook must cover:
  - Open a buffer with content; `(write-file "<new-path>")` → status reports the new filename, `(buffer-filename)` returns the new path, `(buffer-modified-p)` is `nil`, and `cat <new-path>` shows the content.
  - `write-file` messages `"Saved <new-path>"` (same message as `save-file`).
  - `write-file` is present in M-x completion candidates (assert via the M-x completion table or by invoking it through M-x).
  - The `SPC f w` binding is live (drive it through the daemon/client stack, not just eval).
  - No new `C-x` binding exists (negative check: the SPC binding is the only save-as affordance).
- **Unit/integration coverage.** Extend `test/unit/editor.test.ts` (or the save-cluster test) with: `(write-file "/tmp/x")` writes the file and re-associates the buffer identically to `(save-file "/tmp/x")`; calling both on the same buffer reaches the same end state. No new TS primitive is added, so no `file-primitives.test.ts` change is needed.
- **Regression.** `save-file` and `save-buffer` behavior is unchanged (the alias adds a name; it does not alter the shared code path). The `:w!` force path and the BUG-55 concurrent-modification guard are untouched.

## M-x Discoverability

A function appears in M-x completion IFF it has a docstring OR a keybinding, per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. `write-file` gets BOTH a docstring and the `SPC f w` binding, guaranteeing it is discoverable through M-x. The docstring is required independently so the command is self-documenting even before the binding is considered; the binding makes it reachable from the keyboard. This dual coverage is the standard the save cluster already follows (`quick-save` has both a docstring and `SPC x s`).
