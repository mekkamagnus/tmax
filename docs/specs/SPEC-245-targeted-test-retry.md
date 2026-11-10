# SPEC-245 — Targeted per-test `retry` for confirmed flaky tests

**Status:** in progress (branch `issue-245` @ `4cd9655`); lands on main only
after verify-gate PASS + CI green (ADR-0269)
**Issue:** [#245](https://github.com/mekkamagnus/tmax/issues/245)
**Base:** `main` @ `6960916`

## Goal

Adopt Bun 1.4's per-test `retry` for the suite's confirmed-flaky tests —
sparingly and with a written policy — so load-induced flakes stop costing red
CI runs / gate runs without masking real bugs. Explicitly NOT a blanket
`--retry` flag.

## Policy (the deliverable)

Order of preference, from the issue itself:

1. **Fix the flake** (e.g. the busy-machine budget flakes in
   `test-ai-agent-control` and `error-handling` were fixed by raising time
   budgets; #239 fixed cross-worker socket collisions via worker tokens).
2. **`--isolate` / solo** for load-sensitive populations (#237 isolate
   default; tmax-use stays solo per ADR-0265).
3. **Per-test `{ retry: N }`** only when ALL hold:
   - **confirmed flaky** — actually observed failing-then-green, documented
     (ADR/spec/issue), not hypothetical;
   - **investigated** — failure mode understood well enough to state why a
     retry cannot mask a real regression (environmental contention, not
     logic);
   - **minimal N** — one re-attempt (`retry: 1`) unless evidence needs more.
4. Every retry added is **tracked** in the test comment + ADR + issue close
   comment (this spec's Appendix table is the living registry).

## Mechanism (probed on Bun 1.4.4, 2026-11-10)

`test("name", { retry: 1 }, fn)` — the failing first attempt is logged, the
re-run counts as pass. Probe (outside the suite, /tmp): a counter-throwing
test with `{ retry: 1 }` reports `2 pass / 0 fail`. Works under the wrapper's
`--dots --timeout 60000 --parallel` invocation (per-test option, no CLI flag
involved).

## Qualifying set (today: exactly one test)

`test/unit/server-daemon-hardening.test.ts` —
`starting a second server on the same socket rejects`:

- **Confirmed flaky:** observed once in a parallel full-suite run; documented
  as the suite's "known residual" in ADR-0267 (the #240 final-gate work).
- **Investigated:** BUG-16 analyzed the second-start hang race (the test
  already races `start()` against a 2 s timeout and accepts either rejection
  path); post-#239 socket paths are worker-token-scoped, so it is not
  cross-worker collision — the residual is OS-level bind/lock contention
  under parallel load.
- **Retry cannot mask a real bug:** the assertion is "second bind rejects
  (or times out)". A real regression — second server ACCEPTING the taken
  socket — fails deterministically on every attempt; retry would re-fail
  identically. Only the environmental slow-reject path benefits.

Change: `test('…', { retry: 1 }, async () => { … })` + a comment citing
#245/ADR-0269 with the three qualifying reasons.

## Considered and NOT retried

- **tmax-use playbooks / e2e** (the "~100 under concurrent load" population
  from the issue): handled by the stays-solo policy (ADR-0265); per-test
  retry there could mask real e2e regressions. Rejected.
- **August-era CI failures** (`test-bun` reds in the 325–341M run range):
  resolved by #198; nothing left to retry.
- **`test-ai-agent-control` / `error-handling` busy-machine flakes:** already
  fixed via budget increases (policy step 1) — no retry.

## Completion Criteria

1. **Policy documented** in `rules/testing.md` (scope `test/**`): the
   fix-first order, the three qualifying conditions for `{ retry: N }`, and
   the tracking requirement.
2. **One qualifying test carries `{ retry: 1 }`** with a comment stating why
   it qualifies (observed-once citation + investigated failure mode +
   can't-mask rationale).
3. **Registry** — the ADR (and this spec) list every retried test and every
   considered-and-rejected candidate with reasons.
4. **No blanket retry** — no CLI `--retry` flag added to the wrapper, CI, or
   adw invocations; `git diff main..issue-245` adds no other retry.
5. **Verification green** — typecheck:src + typecheck:test clean;
   `bun test test/unit/server-daemon-hardening.test.ts` green; the wrapper
   config (`--dots --timeout 60000 --parallel`) unaffected.
