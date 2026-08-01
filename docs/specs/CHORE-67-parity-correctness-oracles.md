# Chore: add correctness oracles to the evaluator sync/async parity tests

## Chore Description
`test/unit/evaluator-sync-async-parity.test.ts` only asserted that the sync and
async evaluator paths **agree** — never that either produces the **correct**
value. Its "while + dolist" case contained the broken `setq` idiom (BUG-31);
both paths returned the identical Left error, so the parity assertions passed
and the suite reported green on a case that should evaluate to 6. This test-design
defect actively masked the `setq` alpha-blocker.

## Problem Statement
The parity suite must assert correctness (the right value), not just sync==async
agreement, so agreed-but-wrong bugs cannot ship green.

## Solution Statement
1. Add an `expected` (correct value) / `expectedError` column to every case.
2. Add an `unwrap` helper (lists recurse, nil→null, scalars→value) to compare a
   TLispValue against a plain JS expected value.
3. In the parity loop, assert the correctness oracle: `expectedError` ⇒ both
   paths reject; `expected` ⇒ both produce it. The sync==async parity assertion
   is retained.
4. Rename the mislabeled "while + dolist" case (it was only `dolist`) to
   "dolist accumulator (setq)" with `expected: 6`, and add a real
   "while accumulator (setq)" with `expected: 3`. Replace the wrong "error:
   arity `(+ 1)`" case (the oracle revealed `(+ 1)` succeeds → 1, not an error)
   with "error: non-numeric `(+ \"a\" 1)`".

Codex APPROVE-WITH-CONCERNS honored: expected value/error for every ordinary
case; an actual `while` accumulator test; explicit error assertions; kept
blocked until #41 (setq) landed — it has.

## Relevant Files
- `test/unit/evaluator-sync-async-parity.test.ts` — `unwrap` helper; `expected`/`expectedError` on every case; correctness oracle in the loop.

## Step by Step Tasks
### Task 1 — oracle column + unwrap
**AC**: every case has `expected` or `expectedError`; `unwrap` maps TLispValue→JS for comparison.
### Task 2 — correctness assertion
**AC**: the loop asserts the right value (or error) for each case, in addition to sync==async agreement.
### Task 3 — while + fixed error case
**AC**: a real `while` accumulator case exists; the mislabeled dolist case is renamed; the `(+ 1)` non-error case is corrected.
### Task 4 — Validate
typecheck clean; parity test green; verify-gate PASS.

## Validation Commands
- `bun run typecheck:test`
- `bun test test/unit/evaluator-sync-async-parity.test.ts` — green (39 cases, incl. oracles).

## Notes
- Test-only change (no production code modified).
- The oracle immediately paid off: it revealed `(+ 1)` is not an error (it returns 1).
