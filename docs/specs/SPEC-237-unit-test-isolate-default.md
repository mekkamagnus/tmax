# SPEC-237 — `bun test --isolate` as the default unit-test mode

Issue: #237 — adopt Bun 1.4's `--isolate` for `test:unit` (fresh global + module registry per test file; leaked handles/timers cleaned between files)
Status: landed (ADR-0264)
Date: 2026-11-10

## Goal

Make `--isolate` the default mode of the `test:unit` wrapper (`scripts/run-unit-tests.ts`), per the issue: it directly targets our order-dependence history (BUG-16-class "passes solo, fails in suite") and is the prerequisite for `--parallel` (#239). The non-isolate baseline exists at this exact commit (main `209aa24`: **55/55 batches, 0 fail, exit 0**, recorded in the #242 cycle) — the isolate run is the comparison.

## Design

1. Wire `--isolate` through the wrapper's `bun test` invocations (the wrapper batches 5 files per invocation with `--dots` + BUG-16 force-exit; the flag slots into each batch's args). `TMAX_UNIT_NO_ISOLATE=1` opts out for A/B comparisons.
2. Fix any test that only passes via shared module/global state between files — the isolate run is the detector; every failure it surfaces is an order-dependence bug being caught, not a regression.
3. The BUG-16 harness stays: isolate cleans handles BETWEEN files, but the end-of-batch exit-stall (signal handlers on unreffed timers keeping the loop alive) is a within-process tail the harness still force-exits after the summary line.

## Completion criteria

1. Isolate-default `bun run test:unit` green solo — same bar as the non-isolate baseline (all batches, 0 fail, exit 0) — with the wall-clock recorded next to the non-isolate number (single runs on a load-avg-~12 host: directional, not benchmark-grade; `--parallel` #239 is the speed lever, isolation is the correctness lever).
2. Any isolate-surfaced order-dependence fixed at the test/production site (not by reordering batches).
3. `TMAX_UNIT_NO_ISOLATE=1` documented in the wrapper comment; A/B numbers in the ADR.
4. ADR-0264 + index line.

## Out of scope

`--parallel` (#239 — next issue, builds on this), CI sharding (#241), the adw-* test routing (already excluded from test:unit).
