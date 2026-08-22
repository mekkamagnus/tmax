# ADR-0247: Markdown boundary drift — private rename over exporting; refrozen baseline

**Date:** 2026-08-22
**Status:** Accepted
**Issue:** #227
**Spec:** SPEC-227

## Context

CHORE-44 Change 11 froze the markdown feature modules' public inventory
(113 fns) with a boundary contract: every `markdown-*`-prefixed defun is
exported by exactly one feature module. Post-freeze feature work
(SPEC-116/120/121) drifted the contract: an internal helper gained a
public-looking name, and 12 legitimately-exported fns were missing from
the baseline.

## Decision

1. **Internal helpers don't carry the public prefix.** The fix for
   `markdown-note-slug-segment` is a RENAME (`note-slug-segment`), not an
   export: exporting would publish an internal implementation detail
   nothing consumes. The prefix IS the visibility contract.
2. **Baselines are refrozen deliberately, with history recorded.** The
   inventory baseline is a snapshot, not scripture — legitimate feature
   growth updates it (113 → 125) with the change documented in the test
   itself so the next drift is attributable.

## Consequences

- The public markdown surface equals what modules actually export;
  nothing internal leaks into the constrained namespace.
- Future public additions require a baseline update — the count assertion
  failing is the signal to either rename (internal) or refreeze (public).
