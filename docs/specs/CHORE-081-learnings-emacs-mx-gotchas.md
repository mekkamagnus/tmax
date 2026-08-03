# Chore: Capture Emacs-M×-gap gotchas in `docs/learnings.md` (#117)

## Goals

- Persistent record (per CLAUDE.md §6) of the non-obvious traps hit during SPEC-071..085, so the next agent doesn't rediscover them.

## Completion Criteria (Definition of Done)

- [x] `docs/learnings.md` has a section covering each of:
  - `buffer-switch` bumps recency on every call → recency-sorted cycling is non-deterministic (SPEC-073).
  - `completing-read` is async → multi-prompt flows need a queue state machine (ADR-0168); a single `defun` can't loop prompts.
  - Cross-module T-Lisp calls resolve via `funcall`, not bare names (the `command-line.tlisp` `:w`/`:bd` fix).
  - `defmodule` rejects `--` names (BUG-63) → use inline lambdas / single-dash.
  - tmax-use "Undefined symbol" is a swallowed `.tlisp` parse error, NOT an evalReady race (BUG-60 corrected) → run playbooks SOLO with `HOME=$(mktemp -d)`.
  - Re-baseline `.chore44-baseline/` whenever the public API intentionally grows.

## Description

These five were paid for in debugging time during the Emacs foundational-M× gap work (SPEC-071..085, BUG-59..67). `docs/learnings.md` is the project's persistent-lessons file (CLAUDE.md §6: "read it at the start of every task").

## Notes

No ADR — this is a docs/learnings chore, not an architectural decision.
