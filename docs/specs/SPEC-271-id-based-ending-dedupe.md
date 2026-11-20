# SPEC-271 — id-based turn-ending dedup on replay (#304)

## Goal

Legacy logs replayed duplicate `── completed ──` markers beyond the
already-fixed consecutive case: non-consecutive repeats (intervening
events between two endings of the same turn) and conflicting-status
endings (error + completed interleaved).

## Rule (per the issue's normative text)

- **Turn-boundary identity**: a turn's ENDING is the LAST turn-end for
  its id in the log prefix; earlier endings for the same id drop at
  render regardless of what intervenes.
- **Conflicting statuses**: last by log order wins (errored-then-
  completed renders completed); drops are counted.
- **Distinct ids never merge** — the id rule REPLACES the consecutive
  rule for id'd logs (adjacent same-status turns both render).
- **No-id legacy logs** (probe-era) keep the consecutive rule
  (documented frozen-history fallback). **Mixed logs** (appended across
  the probe→id transition): id'd endings take the id rule, id-less
  endings take the consecutive rule, in one pass (gate r1 guard).

## Implementation

`fikra-event-dedupe-memarkers` dispatches: id'd logs → a BACKWARD scan
(first turn-end seen per id = last by log order; later sightings drop,
counted in `fikra-dedupe-dropped`); no-id logs → the old consecutive
scan unchanged. Replay notes `N stale endings dropped` via `message`
(→ `*Messages*`) when the count is non-zero.

## Completion criteria

- [x] Residual-defect fixtures drove the fix (non-consecutive dup,
      conflicting statuses — both constructed logs render-doubled
      pre-fix)
- [x] Id rule tested: non-consecutive dup drops; conflicting → last
      wins; adjacent distinct ids both render
- [x] No-id fallback preserves the consecutive rule (and does NOT
      dedupe non-consecutive — documented)
