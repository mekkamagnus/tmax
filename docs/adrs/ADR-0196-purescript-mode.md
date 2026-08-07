# ADR-0196 — purescript-mode (`#166`)

## Status

Accepted

## Context

PureScript (`.purs`) was missing from the major-mode registry. Its Haskell-derived syntax (significant whitespace, `where`/`do`/`let` blocks, `::` type annotations) follows the same registration-only pattern as the other 20+ major modes.

## Decision

Register `purescript-mode` with `.purs` extension, `nil` syntax-language (no tokenizer), and 4-backslash indent rules (per ADR-0193) covering the common Haskell-style block openers.

## Consequences

- `.purs` files auto-detect to `purescript-mode`.
- Indent rules handle `where`/`do`/`let` blocks and brace blocks (heuristic, not full layout rules).
- Syntax highlighting deferred (no tokenizer — follow-up if needed).
- purs REPL convenience command depends on comint-mode (#165).
- Verify-gate (SPEC-098): **PASS** — 4/4 tests, typecheck clean.
