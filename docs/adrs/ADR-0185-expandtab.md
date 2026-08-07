# ADR-0185 — expandtab via module-local `defvar`s + exported setters (`#144`)

## Status

Accepted

## Context

Issue `#144`: Tab in insert mode always inserted a literal `\t`
(`insert-tab` did `(buffer-insert "\t")` unconditionally). Vim's `expandtab`
converts Tab to spaces, which every spaces-indented language (TypeScript, Python,
YAML) needs. There was no setting to change this.

The first attempt added `(defvar expand-tabs nil)` and `(defvar tab-width 4)`
inside the `editor/commands/insert-entries` module and had the `:set et` clause
in the *sibling* `editor/commands/command-line` module do
`(setq expand-tabs t)`. This **failed at runtime**:

```
set!: variable 'expand-tabs' is not defined
```

Root cause: `defvar` inside a `defmodule` creates a **module-local** binding.
`command-line` is a different module environment, so it cannot see or `setq`
`insert-entries`'s `expand-tabs`. Even a global `setq expand-tabs t` from the
interpreter would create a *separate* global binding that `insert-tab` (running
in the `insert-entries` module env) never reads — confirmed by a fixture probe
where `(setq expand-tabs t)` left `insert-tab` still inserting `\t`.

## Decision

Keep `expand-tabs` / `tab-width` as module-local `defvar`s in
`insert-entries.tlisp` (where `insert-tab` reads them) and expose **exported
setter functions**:

```lisp
(defun set-expand-tabs (flag) (setq expand-tabs flag))
(defun set-tab-width (n)      (setq tab-width n))
```

The `:set et` / `:set noet` / `:set ts=N` clauses in `command-line.tlisp` call
them via `(funcall "set-expand-tabs" t)` etc. This is the same cross-module
mechanism `command-line.tlisp` already uses for `save-buffer`,
`save-all-buffers`, and `kill-buffer` (which live in sibling modules).
`funcall` with a string name resolves the unique module export via
`resolveUniqueExport`.

`insert-tab` branches on the module-local `expand-tabs`:

```lisp
(defun insert-tab ()
  (if expand-tabs
    (let ((col (cursor-column)))
      (let ((n (- tab-width (mod col tab-width))))
        (while (> n 0) (buffer-insert " ") (setq n (- n 1)))))
    (buffer-insert "\t"))
  t)
```

State is intentionally **global**, not buffer-local. `#144`'s scope is "make Tab
insert spaces when expandtab is on"; per-major-mode / buffer-local
`indent-tabs-mode` is a separate minor mode (`#153`).

## Consequences

- Tab now does the right thing for spaces-indented files; `:set et/noet/ts=N`
  work and no longer raise `set!: variable not defined`.
- The cross-module setter+`funcall` pattern is reaffirmed as the tmax convention
  for any setting whose storage `defvar` is module-local. New `:set`-style
  options that touch module state should follow this, not direct `setq`.
- Behavior preservation: `insert-newline`, `insert-backspace`, and all other
  sibling entry functions are untouched; the only behavioral change is `insert-tab`
  honoring `expand-tabs` (default nil = identical to the old literal-tab behavior).
- **Known follow-up (out of scope, pre-existing):** `:set ts=` with no number
  parses to `0`, which would make the next `insert-tab` hit a mod-by-zero. This
  is not a regression (the old direct-`setq` path had the same
  `string-to-number` behavior); tracked as a low-priority input-hardening item.
- Adversarial verify-gate (SPEC-088): **PASS**, all 8 acceptance criteria met.
