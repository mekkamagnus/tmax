# ADR-0319 — Refreeze the CHORE-44 baselines after drift

**Issue:** #338 · **Spec:** [SPEC-338](../specs/SPEC-338-baseline-drift.md)
**Status:** accepted · **Date:** 2026-11-23

## Context

CHORE-44's frozen inventories are the guard against silent API
drift, but the freeze is manual — two landings skipped it (#335's 12
markdown defuns; `scan-visible-column` from an earlier landing),
leaving three tests red on main and normalizing red-as-background.

## Decision

Refreeze by REGENERATION, not hand-editing: the markdown list is
rewritten by the test's own derivation (the defun-regex walk over
markdown.tlisp + commands/markdown/*), and the static list takes
scan-visible-column at its sorted position (a +1 file line, 438 →
439 — #308's two names were already frozen on its branch; only the
AC7.1 ANCHOR lagged by three) with the count carried 436 → 439 under
the landing-history comment convention. The
regeneration approach makes the frozen set exactly what the test
derives — no transcription layer to drift itself.

## Consequences

- The three inventory tests are green; the guard is armed again.
- The lesson (landing that adds API surface must refreeze in the
  SAME branch) is recorded in the #338 close and the burn-down
  ledger; #308's branch demonstrated the right pattern.
