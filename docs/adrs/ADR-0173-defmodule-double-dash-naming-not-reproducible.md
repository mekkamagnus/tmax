# ADR-0173 — `defmodule` handles `--`/`---` defun names correctly; BUG-63 was a source typo (#112 / BUG-63)

## Status

Accepted

## Context

BUG-63 reported that a `(defun name--private …)` inside a `(defmodule …)` was
left "Undefined symbol" after `require-module`, while single-`-` neighbours in
the same module defined correctly. A burn-down investigation hypothesised the
name was lost between the module-body `defun` binding and the export set —
suspecting symbol-interning or an export-name split on `-`.

A full re-investigation (spec
`docs/specs/BUG-63-defmodule-double-dash-naming.md`, 2026-08-06) traced the
export and lookup machinery end-to-end and **disproved the report**: the
module system handles `--`/`---` names identically to single-`-` names on every
code path. The "Undefined symbol" the original reporter hit was caused by the
`(export …)` list naming a *different* symbol than the `(defun …)` — a source
typo (the SPEC-073 module exported `buffer-non-special` but defined
`buffer--non-special`). The workaround (an inline `(lambda …)`) "fixed" it by
removing the mismatched name entirely.

Evidence gathered against `main`: `-` is a legal symbol char
(`src/tlisp/tokenizer.ts`), the parser preserves symbol `.value` verbatim, the
export set is built straight from the parsed symbol values
(`src/tlisp/evaluator/module-forms.ts`), `evalDefun` binds the identical raw
string (`src/tlisp/evaluator.ts`), and `evalSymbol` splits on `/` only — never
on `-`. Registry dumps confirmed `exports` and the env binding agree for `--`
names. End-to-end qualified, selective, and unique-export calls all return the
expected values when the export name matches the defun name.

## Decision

Make **no interpreter/module-system code change** — the code is correct, and any
"fix" there would be changing correct code on the basis of a misdiagnosed
report. The only warranted change is a regression-guard test so the question
never needs re-investigation.

Add one focused test to `test/unit/module-system.test.ts` that defines a module
exporting a single-`-`, a double-`-` (`--`), and a triple-`-` (`---`) defun
(with matching export names), then asserts each resolves via qualified call,
selective import (`:import`), and unqualified unique-export resolution. Close
#112 as not-reproducible.

## Consequences

- The `--`/`---` private-helper naming convention (common in Lisp dialects) is
  confirmed safe to use inside `defmodule`, provided the `(export …)` list names
  the defun symbols exactly.
- Future "Undefined symbol on a `--` name" reports have a bisect trail: dump
  `(moduleRegistry).resolve(name).exports` and `.env.lookup(name)`; if they
  disagree, the bug is in `evalDefmoduleForm` or `evalDefun`; if they agree but
  lookup fails, it is in `evalSymbol`. Today neither branch reproduces.
- No production code changed; the CHORE-44 baseline and all existing behaviour
  are unaffected.
