# ADR-0155 — evaluator parity tests assert correctness, not just sync==async (#48)
## Status: Accepted
## Context
`test/unit/evaluator-sync-async-parity.test.ts` only asserted that the sync and
async evaluator paths **agreed** — never that either was correct. Its
`while + dolist` case contained the broken `setq` idiom (BUG-31); both paths
returned the identical Left error, so parity passed and the suite reported green
on a case that should evaluate to 6. This masking defect let the `setq`
alpha-blocker ship undetected.

## Decision
Add a **correctness oracle** to every parity case (test-only, no production change):
- Each case carries `expected` (correct value) or `expectedError`.
- An `unwrap` helper (lists recurse, nil→null, scalars→value) compares a
  TLispValue against a plain JS expected value.
- The loop asserts the oracle (`expectedError`⇒both reject; `expected`⇒both
  produce it) in addition to the retained sync==async agreement.
- Renamed the mislabeled "while + dolist" (was only `dolist`) → "dolist
  accumulator (setq)" expected 6; added a real "while accumulator (setq)"
  expected 3; replaced the wrong "error: arity `(+ 1)`" (the oracle revealed
  `(+ 1)` returns 1) with "error: non-numeric `(+ \"a\" 1)`".

## Consequences
- An agreed-but-wrong result now fails the suite (verified by tampering:
  corrupting an expected made it fail). The "green on broken setq" mode is gone.
- The oracle immediately paid for itself: it caught that `(+ 1)` is not an error.
- Test-only; no production behavior change. 39/39 pass.
- Cosmetic note: `unwrap` covers nil/number/string/boolean/list (the table's
  shapes); a future symbol-returning case would need its expected as
  `{symbol:'name'}`.

Spec: [CHORE-67](../specs/CHORE-67-parity-correctness-oracles.md). Issue: #48.
Verify-gate: PASS (0 gaps).
