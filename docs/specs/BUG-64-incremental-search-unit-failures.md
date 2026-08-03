# Bug (pre-existing): 3 `incremental-search` unit tests fail

## Goals

- Restore the 3 `Incremental Search` unit tests to green so `test:unit` reflects reality (and stops aborting the batched runner at this file).

## Completion Criteria (Definition of Done)

- [ ] `bun test test/unit/incremental-search.test.ts` → all green.
- [ ] Root cause identified (cursor-on-match semantics, pattern-narrowing, and/or the full start→update→update→backspace→finish workflow) and either fixed or the tests re-baselined to documented intended behavior.
- [ ] `bun run test:unit` advances past this file (no longer aborts the batch on these failures).

## Bug Description

Three tests in `test/unit/incremental-search.test.ts` fail:

- `search-incremental-update > moves cursor to match when pattern is found`
- `search-incremental-update > narrows match as pattern grows`
- `full isearch workflow > start -> update -> update -> backspace -> finish`

Result: `27 pass / 3 fail`. **Pre-existing** — confirmed by stashing all Emacs-M×-gap `src/` changes (SPEC-071..085) and re-running; the identical 3 failures occur. Not caused by that work. Because `scripts/run-unit-tests.ts` aborts on the first failing batch, these also block the rest of the unit suite from completing.

## Problem Statement

Incremental-search cursor/match behavior drift between the tests' expectations and the current `search-ops.ts`/isearch implementation. The tests assert cursor movement to the match and pattern-narrowing semantics that the live code no longer satisfies.

## Solution Statement

Read `test/unit/incremental-search.test.ts` + `src/editor/api/search-ops.ts` + `src/tlisp/core/commands/isearch.tlisp`; determine whether the tests or the impl drifted (recent isearch changes — e.g. BUG-73 "Fix isearch to match at point" — may have intentionally changed at-point semantics). Reconcile: fix the impl to satisfy intended behavior, or update the tests to the new intended semantics with a reference to the change that introduced it.

## Relevant Files

- `test/unit/incremental-search.test.ts` — the 3 failing tests.
- `src/editor/api/search-ops.ts`, `src/tlisp/core/commands/isearch.tlisp` — the implementation under test.
- Recent isearch-related commits/issues (at-point semantics change).

## Severity / Notes

- **Priority:** medium. Pre-existing; also blocks the full `test:unit` run from completing (cascading). Not from the Emacs-M× gap work.
