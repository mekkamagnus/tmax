# Feature: `(interactive)` declaration for T-Lisp commands

## Feature Description

Add Emacs-style `(interactive)` support to T-Lisp `defun`. A function is an M-x
command candidate iff it is declared `(interactive)` **or** it is bound to a key.
Internal helpers, stdlib, and TS primitives (not key-bound, not declared
interactive) are excluded from the M-x completion list. This mirrors Emacs's
separation of commands (user-callable) from functions (internal), and uses the
key-binding table as the primary "this is a command" signal so the common case
needs no annotation.

## Goals

- `defun` accepts an optional `(interactive)` or `(interactive "spec")` form after
  the docstring.
- `TLispFunction` gains an `interactive?: boolean` field.
- M-x completion (`command-completion-refresh`) filters to commands: declared
  `(interactive)` **OR** key-bound.
- Graceful fallback: if zero commands qualify, the completion table shows all
  callables (current behavior) so M-x is never empty.
- The non-key-bound user-facing commands get `(interactive)` added in their
  `.tlisp` files; key-bound commands need no change.
- Measurable improvement: M-x candidate count drops from ~1,164 to <200
  (measured ~146, an 8× reduction; stdlib + internal helpers removed).

## User Story

As a user, I want M-x to show only the commands I can actually invoke — not
every internal helper, every TS primitive wrapper, and every module export — so
the list is short, the filtering is fast, and I can find what I need without
scrolling through hundreds of irrelevant entries.

## Problem Statement

Today every `defun` is a potential M-x candidate (the old rule: "has a docstring
OR key-bound"). There are 1,164 callables in the completion table, but only the
~146 key-bound + declared-interactive ones are real commands. The rest are
stdlib and internal helpers that clutter the list and slow down completion
(BUG-78).

## Solution Statement

### Phase 1: Parser + type
- The evaluator's `defun` special form checks if the first body form (after the
  docstring) is `(interactive)`. If so, it sets `interactive = true` on the
  `TLispFunction` value and skips the form (doesn't evaluate it as a body
  expression).
- `TLispFunction` gains `interactive?: boolean`.

### Phase 2: Completion filtering
- `callable-command-details` (TS primitive) gains an optional `interactive-only`
  parameter. When truthy, a function is included iff it is a **command**:
  `fn.interactive === true` **OR** it is bound to a key. The key-bound check
  reuses the existing `bindingsByCommand` map — a key binding already declares
  "this is a user-facing command", so it is treated as interactive by default
  (DRY: no need to repeat `(interactive)` in every key-bound defun).
- `command-completion-refresh` (the M-x source, in execute-extended-command.tlisp)
  calls `(callable-command-details t)` and keeps its secondary `trt-`/`should-`
  guard (`command-detail-interactive-p`).
- `describe-function-table` (the SPC-h-f source) is **unchanged** — it calls
  `(callable-command-details)` with no arg, so describe-function still lists
  every callable (no regression to per-symbol help).
- Fallback: if `interactive-only` yields zero candidates (nothing key-bound and
  nothing marked), the full table is returned so M-x is never empty.

### Phase 3: Migration
- `(interactive)` is added to the **non-key-bound** user-facing commands — those
  reachable only via M-x (e.g. `save-buffer`, `query-replace`, `occur`, `dired`,
  `info`, `helpgrep`, `switch-to-buffer`). Key-bound commands need no change
  (Phase 2's key-bound check covers them).
- Do NOT add `(interactive)` to internal helpers (`--` names, `*-candidate`,
  `*-table`, `*-accept`, `*-p` predicates, the `vim-*` state machine), utility
  functions, stdlib, or TS primitives — those are the "inapplicable options"
  the user wants removed from M-x.

## Relevant Files

- `src/tlisp/types.ts` — `TLispFunction` type (add `interactive?: boolean`).
- `src/tlisp/evaluator/form-shapes.ts` — `parseFunctionDef` (detect + strip `(interactive)`).
- `src/tlisp/evaluator.ts` — `evalDefun` (set `fn.interactive`).
- `src/editor/editor.ts` — `callable-command-details` (add `interactive-only` filter).
- `src/tlisp/core/commands/execute-extended-command.tlisp` — `command-completion-refresh` (M-x source).
- `src/tlisp/core/commands/*.tlisp` — add `(interactive)` to non-key-bound user commands.

### New Files
- None.

## Implementation Plan

### Phase 1: Parser + type
Add `interactive` field to `TLispFunction`. In the evaluator's `defun` handler,
check if the first non-docstring body element is a list starting with
`interactive`. If so, set the flag and remove it from the body.

### Phase 2: Completion filtering
Add an optional boolean arg to `callable-command-details`. When truthy, include a
callable iff `fn.interactive === true` OR it is key-bound. Wire the M-x source
(`command-completion-refresh`) to pass it; leave `describe-function-table` (SPC h f)
unfiltered.

### Phase 3: Migration
Add `(interactive)` to the non-key-bound user-facing commands (those reachable
only via M-x). Key-bound commands are auto-included by Phase 2.

## Acceptance Criteria (Completion)
- [ ] `defun` with `(interactive)` sets the flag on `TLispFunction`.
- [ ] `defun` without `(interactive)` leaves the flag unset.
- [ ] M-x completion shows only commands (declared interactive OR key-bound), with the all-callables fallback if none qualify.
- [ ] The non-key-bound user-facing commands have `(interactive)`.
- [ ] M-x candidate count drops from ~1,164 to <200 (measured: ~146, an 8× reduction; stdlib and internal helpers excluded).
- [ ] No regression to describe-function (it shows all, not just interactive).

## Validation Commands
- `bun run typecheck`
- `bun run build`
- `bun test test/unit/interactive.test.ts` (new)
- `bun run bench` (the minibuffer benchmark from CHORE-84 should show improvement)

## Notes
- Emacs reference: `(elisp) Defining Commands`. The `interactive` form can also
  specify argument-prompting codes (e.g., `(interactive "fFile: ")` for
  file-read). This spec implements the bare `(interactive)` form only; argument
  codes are a future enhancement.
- T-Lisp built-in primitives (TS `defineRaw` / `api.set`) are NOT affected — they
  remain M-x candidates (they're the underlying mechanisms). Only T-Lisp `defun`
  commands are filtered.
- Actually: TS primitives should ALSO get an `interactive` flag. Currently all TS
  primitives are callable from M-x, which contributes to the 1,164 count. The
  `defineRaw` / `api.set` infrastructure should support marking primitives as
  non-interactive (the default). This is Phase 4 (optional).
