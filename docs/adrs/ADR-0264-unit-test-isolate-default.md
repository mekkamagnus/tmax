# `bun test --isolate` as the default unit-test mode

## Status

Accepted (2026-11-10) — resolves #237 / SPEC-237. Child of the bun-v1.4.4-upgrade cluster (#233, landed).

## Context

The unit suite carries an order-dependence history (BUG-16-class "passes solo, fails in suite"; the CI-hang era of raw `bun test`). The `test:unit` wrapper (`scripts/run-unit-tests.ts`) already batches 5 files per `bun test` invocation with `--dots` streaming, a per-test timeout, and a force-exit-after-summary harness for the exit-stall tail. Bun 1.4's `--isolate` gives every test file a fresh global + module registry and cleans leaked handles/timers between files — the structural fix for cross-file contamination, and the prerequisite for `--parallel` (#239).

## Decision

**Wire `--isolate` into every `bun test` invocation the wrapper makes; `TMAX_UNIT_NO_ISOLATE=1` opts out for A/B comparisons.**

- The flag slots into the existing batch args (`test --dots --timeout 60000 --isolate …files`); CI needs no workflow change (its `test-bun` job runs `bun run test:unit`, which routes through the wrapper), and `test:adw` — also wrapper-routed — inherits isolation identically.
- The BUG-16 harness stays: isolate cleans handles BETWEEN files; the end-of-batch exit-stall (process-level signal handlers keeping the event loop alive after the summary) is a within-process tail the harness still force-exits.

## A/B evidence (same commit `209aa24`, same host, back-to-back single runs)

| mode | result | user CPU | wall-clock |
|---|---|---|---|
| non-isolate (`TMAX_UNIT_NO_ISOLATE=1`) | 55/55 batches, 0 fail, exit 0 | 300 s | 4 min 43 s |
| **`--isolate`** | **55/55 batches, 0 fail, exit 0** | **262 s** | **4 min 16 s** |

Three findings worth recording:

1. **Zero order-dependence surfaced.** The suite passed identically under fresh-per-file globals — the shared-state bugs `--isolate` exists to catch were already gone (earlier issues burned them down; CI has been green since #198). The flag is now a RATCHET: any future test that leaks cross-file state fails the suite instead of passing by luck.
2. **Wall-clock parity, slight isolate edge.** 4:16 vs 4:43 — isolate is ~9% faster end-to-end (−13% user CPU: 262 s vs 300 s), worth having but not the point. (An earlier draft of this ADR claimed a ~3× speedup off a mis-remembered "~13 min" non-isolate baseline — that figure was the August-era suite (BUG-16 audit, 796 s) conflated with agent sleep-windows; the dedicated leg corrected it. The lesson re-confirms #234's: measure both legs at the same commit, back to back.)
3. Isolation is adopted for CORRECTNESS (the ratchet) and as the #239 `--parallel` prerequisite — not as a performance lever.

## Consequences

- `test:unit` (and `test:adw`) default to isolation; CI's `test-bun` job inherits it with no workflow edit and its wall-clock drops accordingly.
- Any test that only passes via cross-file shared state now fails loudly — fix at the test/production site, never by reordering batches (SPEC-237).
- #239 (`--parallel`) builds directly on this: per-file isolation is what makes concurrent files safe.
- Gates: `bun run typecheck` (4 projects) ✅; isolate-default full `bun run test:unit` solo ✅ — **55/55 batches, 0 fail, exit 0, 4:16**; non-isolate A/B leg ✅ 55/55 (4:43, numbers above); `bun run test:integration` solo ✅ (cited in the issue close comment); CI green on `issue-237`. The cluster's codex review lives on parent issue #233.
