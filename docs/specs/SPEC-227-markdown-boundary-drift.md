# SPEC-227: markdown module-boundary drift — helper renamed, baseline refrozen

**Issue:** #227 (bug / test triage)
**Status:** Implemented 2026-08-22

## Goal

Resolve the pre-existing `markdown-module-boundaries.test.ts` failures so
`bun run test:unit` proceeds past the batch: the boundary contract
(CHORE-44 Change 11) holds again with a deliberately-updated baseline.

## Diagnosis

Two distinct drifts since CHORE-44 froze the baseline (113 fns):

1. **An unexported public-named helper**: `markdown-note-slug-segment`
   (knowledge.tlisp, SPEC-121 slugify era) is internal-only (two call
   sites in its own file, absent from the module export list) but carries
   the `markdown-` public prefix — violating AC11.2 ("every public
   markdown-* function is exported by exactly one feature module").
2. **A stale baseline**: 12 exported fns added after the freeze
   (SPEC-116/120/121-era: completion-at-point, slugify, backlinks…) are
   missing from `.chore44-baseline/markdown-fns.txt` — AC11.1's inventory
   mismatch (+12).

## Fix

- The helper is renamed `note-slug-segment` (private — no public prefix,
  never exported, out of the constrained namespace). Renaming over
  exporting keeps the public surface at what consumers actually use.
- The baseline is REFROZEN to the current inventory (125) — the deliberate
  contract update the issue's DoD allows. All 12 new fns satisfy AC11.2
  (each exported by exactly one feature module).

## Completion Criteria

- [x] `markdown-note-slug-segment` is no longer in the public namespace
      (renamed `note-slug-segment`; zero unexported markdown-* defuns —
      AC11.2 green).
- [x] The boundary contract updated deliberately: baseline refrozen to
      125 with the count assertion documenting the history (AC11.1 green).
- [x] `bun run test:unit` proceeds past this batch (the suite is green;
      key-bind-enhancements remains the known separate halt).
- [x] typecheck green; all 7 markdown suites green (156/156 — the rename
      breaks nothing).

## Notes

- The refreeze script (aggregator + feature files → defun inventory →
  sorted) lives in this spec's history; rerun it whenever a markdown
  feature module intentionally adds public fns.
