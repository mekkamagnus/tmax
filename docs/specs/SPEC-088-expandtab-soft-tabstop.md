# Feature: expandtab / soft tabstop (`#144`)

## Feature Description

Vim's `expandtab` setting converts the Tab key into the right number of spaces to
reach the next tab stop, instead of inserting a literal `\t`. tmax had no such
setting: Tab in insert mode always inserted a single literal tab character
(`src/tlisp/core/commands/insert-entries.tlisp`, `insert-tab`). This blocks
correct per-language indentation (e.g. Go uses tabs, TypeScript uses spaces).

This feature adds two global editor settings and wires them through the vim
`:set` command line:

- `expand-tabs` — when non-nil, Tab inserts spaces; when nil, Tab inserts `\t`.
- `tab-width` — columns per tab stop (default 4).
- `:set et` / `:set expandtab` → spaces; `:set noet` / `:set noexpandtab` → tabs.
- `:set ts=N` / `:set tabstop=N` → set the tab stop width.

## User Story

As a tmax user editing code in a spaces-indented language (TypeScript, Python, YAML),
I want Tab to insert spaces to the next tab stop,
So that my indentation matches the file's existing style instead of inserting literal tabs.

## Problem Statement

`insert-tab` unconditionally did `(buffer-insert "\t")`. There was no way to make
Tab produce spaces, so any file that uses spaces for indentation got a stray tab
on every Tab press. Two cross-cutting problems had to be solved:

1. **Behavior** — Tab must compute `tab-width - (column mod tab-width)` spaces when
   `expand-tabs` is on.
2. **Module scoping** — `expand-tabs` and `tab-width` are `defvar`s inside the
   `editor/commands/insert-entries` module, so they are module-local. The
   `:set et` dispatch lives in the sibling `editor/commands/command-line` module.
   A direct `(setq expand-tabs t)` from `command-line` errors with
   `set!: variable 'expand-tabs' is not defined` (it cannot see the sibling
   module's binding), and even a global `setq` from the interpreter would create a
   *different* binding that `insert-tab` never reads.

## Solution Statement

Keep `expand-tabs` and `tab-width` as module-local `defvar`s in
`insert-entries.tlisp` (where `insert-tab` reads them) and expose **exported
setter functions** `set-expand-tabs` and `set-tab-width`. The `:set et/noet/ts=N`
clauses in `command-line.tlisp` call those setters via `(funcall "set-expand-tabs" …)`
— the same cross-module mechanism `command-line.tlisp` already uses for
`save-buffer`, `save-all-buffers`, and `kill-buffer`. This respects the tmax
convention that cross-module state changes go through exported functions, not
direct `setq` into another module's environment.

`insert-tab` becomes:
```lisp
(defun insert-tab ()
  (if expand-tabs
    (let ((col (cursor-column)))
      (let ((n (- tab-width (mod col tab-width))))
        (while (> n 0) (buffer-insert " ") (setq n (- n 1)))))
    (buffer-insert "\t"))
  t)
```

This is intentionally **global** state, not buffer-local. Per-issue scope (#144)
is "make Tab insert spaces when expandtab is on"; buffer-local / per-major-mode
`indent-tabs-mode` is tracked separately as the `indent-tabs` minor mode (#153).
Global `defvar`s are the minimal, YAGNI-respecting implementation.

## Relevant Files

- `src/tlisp/core/commands/insert-entries.tlisp`
  - Defines `expand-tabs`, `tab-width` `defvar`s, the `set-expand-tabs` /
    `set-tab-width` setters, and rewrites `insert-tab`. Exports the two setters.
- `src/tlisp/core/commands/command-line.tlisp`
  - `:set et`/`:set expandtab`/`:set noet`/`:set noexpandtab`/`:set ts=N` clauses
    now call the setters via `funcall` (was a broken direct `setq`).

### New Files

- `test/unit/expandtab.test.ts` — regression coverage (8 tests).

## Implementation Plan

### Phase 1: insert-entries.tlisp (settings + setters + insert-tab)
- Add `expand-tabs` (default nil) and `tab-width` (default 4) `defvar`s.
- Add `set-expand-tabs (flag)` and `set-tab-width (n)` exported setters.
- Rewrite `insert-tab` to branch on `expand-tabs`.

### Phase 2: command-line.tlisp (:set dispatch)
- Route `:set et`/`:set expandtab` → `(funcall "set-expand-tabs" t)`.
- Route `:set noet`/`:set noexpandtab` → `(funcall "set-expand-tabs" nil)`.
- Route `:set ts=N` → `(funcall "set-tab-width" (string-to-number …))`.

### Phase 3: tests
- `test/unit/expandtab.test.ts`: default tab, spaces at col 0/2/5, tab-width 2,
  revert to tab, and the `:set et/noet/ts` command paths.

## Testing Strategy

### Unit Tests
- `expandtab.test.ts` drives the interpreter directly (`(insert-tab)`,
  `(funcall "set-expand-tabs" …)`, `(editor-dispatch-command-line "set et")`) and
  asserts on `(buffer-text)`.

### Edge Cases
- Column already on a tab-stop boundary (col 0, 4 with tw=4) → full `tab-width` spaces.
- Column mid-stop (col 2, 5 with tw=4) → partial spaces to the next stop.
- Empty buffer: `cursor-move` clamps to the line's end, so col-N tests pre-fill content.
- Toggling off (`:set noet`) must restore literal `\t` behavior.

## Acceptance Criteria

- [ ] With `expand-tabs` nil, `(insert-tab)` inserts exactly one `\t`.
- [ ] With `expand-tabs` t and `tab-width` 4, `(insert-tab)` at column 0 inserts 4 spaces.
- [ ] With `expand-tabs` t and `tab-width` 4, `(insert-tab)` at column 2 inserts 2 spaces.
- [ ] With `expand-tabs` t and `tab-width` 4, `(insert-tab)` at column 5 inserts 3 spaces.
- [ ] `set-tab-width` 2 changes the stop width to 2.
- [ ] `:set et` enables spaces; `:set noet` restores literal tabs; `:set ts=N` sets the width.
- [ ] `:set et/noet/ts=N` no longer raise `set!: variable not defined`.
- [ ] `bun run typecheck` is clean and `expandtab.test.ts` (8 tests) passes.

## Validation Commands

- `bun run typecheck` — clean across src/test/tmax-use/bench.
- `bun test test/unit/expandtab.test.ts` — the 8 #144 regression tests green.
- `bun test test/unit/core-bindings.test.ts` — confirms core bindings load (no `.tlisp` parse errors).

## Notes

- The earlier broken draft committed `(setq expand-tabs t)` directly in
  `command-line.tlisp`; this fails at runtime with `set!: variable 'expand-tabs'
  is not defined` because module `defvar`s are module-local. The setter+`funcall`
  pattern is the established tmax fix (see `save-buffer`, `kill-buffer` calls in
  the same file).
- Buffer-local / per-mode `indent-tabs-mode` is explicitly out of scope (#153).
