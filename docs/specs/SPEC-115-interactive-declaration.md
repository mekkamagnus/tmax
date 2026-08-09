# Feature: `(interactive)` declaration for T-Lisp commands

## Feature Description

Add Emacs-style `(interactive)` support to T-Lisp `defun`. Only functions
declared `(interactive)` are M-x candidates. Internal helpers without
`(interactive)` are excluded from the completion list, the key-binding
discoverability surface, and the `describe-*` command tables. This mirrors
Emacs's separation of commands (user-callable) from functions (internal).

## Goals

- `defun` accepts an optional `(interactive)` or `(interactive "spec")` form after
  the docstring.
- `TLispFunction` gains an `interactive?: boolean` field.
- M-x completion (`describe-function-table`) filters to `interactive === true` only.
- Graceful fallback: if zero functions are marked interactive (e.g., before
  migration completes), the completion table shows all callables (current behavior).
- The ~50-80 user-facing commands get `(interactive)` added in their `.tlisp` files.
- The ~1,100 internal helpers do NOT get `(interactive)` — they disappear from M-x.
- Measurable improvement: M-x candidate count drops from ~1,164 to ~50-80.

## User Story

As a user, I want M-x to show only the commands I can actually invoke — not
every internal helper, every TS primitive wrapper, and every module export — so
the list is short, the filtering is fast, and I can find what I need without
scrolling through hundreds of irrelevant entries.

## Problem Statement

Today every `defun` is a potential M-x candidate. There are 1,164 callables in
the completion table, but only ~50-80 are user-facing commands. The rest are
internal helpers that clutter the list and slow down completion (BUG-78).

## Solution Statement

### Phase 1: Parser + type
- The evaluator's `defun` special form checks if the first body form (after the
  docstring) is `(interactive)`. If so, it sets `interactive = true` on the
  `TLispFunction` value and skips the form (doesn't evaluate it as a body
  expression).
- `TLispFunction` gains `interactive?: boolean`.

### Phase 2: Completion filtering
- `callable-command-details` (TS primitive) gains an optional `interactive-only`
  parameter. When true, it filters to `interactive === true`.
- `describe-function-table` (T-Lisp) passes `interactive-only: true` to
  `callable-command-details`.
- Fallback: if the result is empty (no functions marked interactive), re-call
  without the filter (shows all — current behavior).

### Phase 3: Migration
- Add `(interactive)` to the ~50-80 user-facing commands across all `.tlisp`
  command files. These are the functions with key bindings, M-x discoverability, or
  that a user would invoke directly.
- Do NOT add `(interactive)` to internal helpers, utility functions, or TS
  primitives.

## Relevant Files

- `src/tlisp/types.ts` — `TLispFunction` type (add `interactive?: boolean`).
- `src/tlisp/evaluator.ts` — `defun` special form evaluation (detect `(interactive)`).
- `src/editor/api/describe-ops.ts` — `callable-command-details` (add interactive filter).
- `src/tlisp/core/commands/describe.tlisp` — `describe-function-table` (pass filter).
- `src/tlisp/core/commands/*.tlisp` — add `(interactive)` to user-facing commands.

### New Files
- None.

## Implementation Plan

### Phase 1: Parser + type
Add `interactive` field to `TLispFunction`. In the evaluator's `defun` handler,
check if the first non-docstring body element is a list starting with
`interactive`. If so, set the flag and remove it from the body.

### Phase 2: Completion filtering
Add an optional boolean arg to `callable-command-details`. When true, skip
callables where `interactive !== true`. Wire `describe-function-table` to pass it.

### Phase 3: Migration
Grep for all `(defun` in `src/tlisp/core/commands/*.tlisp`. For each, decide:
user-facing (add `(interactive)`) or internal (skip). Rule of thumb: if it has a
`key-bind`, a docstring mentioning "Bound to", or appears in the cheatsheet, it's
interactive.

## Acceptance Criteria (Completion)
- [ ] `defun` with `(interactive)` sets the flag on `TLispFunction`.
- [ ] `defun` without `(interactive)` leaves the flag unset.
- [ ] M-x completion shows only interactive commands (fallback to all if none marked).
- [ ] The ~50-80 user-facing commands have `(interactive)`.
- [ ] M-x candidate count drops from ~1,164 to <100.
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
