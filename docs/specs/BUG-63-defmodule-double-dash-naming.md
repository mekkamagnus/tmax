# Bug: `defmodule` does not define functions whose names contain `--`

## Goals

- A `(defun name-with--double-dash …)` inside a `(defmodule …)` is callable after `require-module`, like any other `defun`.

## Completion Criteria (Definition of Done)

- [ ] A double-dash `defun` defined in a module and loaded via `require-module` resolves (a `funcall`/quoted call returns its value, not "Undefined symbol").
- [ ] A unit test in `test/unit/` covers `defmodule` + `--` naming (single-dash, double-dash, triple-dash all export).
- [ ] `bun run typecheck` + `bun run test:unit` pass.

## Bug Description

While implementing SPEC-073 it was found that `defun` names containing `--` (e.g. `buffer--non-special`) **parse** fine and work in a bare interpreter, but are left **UNDEFINED** when defined inside a `(defmodule …)` and loaded via `require-module`. Single-dash neighbours in the same module define correctly. The double-dash name simply never enters the module's export table.

The implementer worked around it by replacing the named helper with an inline `(lambda …)` filter predicate. So this is latent, not blocking — but it is a real interpreter/module-system defect that will surprise future T-Lisp authors (the `--` convention is common for "private" helpers in Lisp dialects).

## Problem Statement

The module symbol/export machinery mishandles `--` in symbol names. Any module author following the conventional `module--private-helper` naming will hit an unexplained "Undefined symbol" at load time and have no obvious path to the cause.

## Solution Statement

Investigate the module export/registration path (the `defmodule` / `export` / `require-module` resolution in `src/tlisp/`) for how symbol names are tokenised/compared; fix so double-dash (and generally any otherwise-legal symbol name) exports identically to single-dash. Add the unit test above.

## Relevant Files

- `src/tlisp/` — the module system: `defmodule`, `export`, `require-module`, and the symbol-resolution path (grep for `defmodule` / `require-module` / `moduleRegistry`).
- `test/unit/` — add a module-loading test for `--` names.

## Severity / Notes

- **Priority:** low. Workaround (inline lambda / single-dash rename) is trivial; no user-facing impact yet. Filed so it is not lost.
