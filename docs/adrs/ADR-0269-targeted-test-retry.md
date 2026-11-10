# Targeted per-test `retry` for confirmed flaky tests

## Status

Accepted (2026-11-10) — resolves #245 / SPEC-245. Builds on #233 (Bun 1.4.4,
which ships per-test retry), #237 (isolate default), #239 (parallel suite +
worker-token socket scoping), and #198 (the August CI-failure population
resolved).

## Context

#245 asked for Bun 1.4's per-test `retry` on "known-flaky tests (sparingly)"
— the documented flake population (~100 under concurrent load) is the
tmax-use/playbook population, already handled by the stays-solo policy
(ADR-0265). In `test:unit` proper, the current confirmed-flake inventory is
**one test**: `server-daemon-hardening > starting a second server on the same
socket rejects`, observed once in a parallel full-suite run and recorded as
the suite's "known residual" in ADR-0267. (The August-era `test-bun` CI reds
were resolved by #198; the busy-machine budget flakes in
`test-ai-agent-control` / `error-handling` were fixed by raising budgets —
the fix-first policy already in practice.)

Mechanism probed on Bun 1.4.4 (2026-11-10, outside the suite):
`test("n", { retry: 1 }, fn)` logs the failing first attempt and counts the
re-run as pass (`2 pass / 0 fail`); it is a per-test option, so the wrapper's
`--dots --timeout 60000 --parallel` invocation is untouched.

## Decision

1. **Policy adopted** (written into `rules/testing.md`): fix first, then
   isolate/solo, then per-test `{ retry: 1 }` only for tests that are
   *confirmed* flaky (observed failing-then-green, documented), *investigated*
   (failure mode understood; retry cannot mask a real regression), with
   minimal N. No blanket CLI `--retry` anywhere.
2. **Applied to exactly one test**: `starting a second server on the same
   socket rejects` gets `{ retry: 1 }`. It qualifies because the flake was
   observed once and documented (ADR-0267); BUG-16 already investigated the
   second-start hang race (the test races `start()` against a 2 s timeout and
   accepts either rejection path); and the can't-mask property holds — the
   assertion is "second bind rejects"; a real regression (second server
   accepting the taken socket) fails deterministically on every attempt, so
   only the environmental slow-reject path can benefit from a retry.
3. **Registry**: this ADR is the living registry of retried tests. Rejected
   candidates recorded here: tmax-use playbooks/e2e (solo policy; retry could
   mask real e2e regressions); the August CI population (resolved by #198);
   the budget flakes (fixed at the source).

## Consequences

- One fewer class of false-red full-suite runs (CI `test-bun`, the #240 adw
  final gate) — the known residual now self-heals one attempt instead of
  costing a resume/re-run.
- The bar for the NEXT retry is written down: an undocumented or
  uninvestigated flake does not qualify — fix it or isolate it instead.
- Gates: typecheck:src + typecheck:test clean ✅;
  `bun test test/unit/server-daemon-hardening.test.ts` 17/17 ✅; retry
  mechanism probe recorded in SPEC-245 ✅; wrapper/CI/adw invocations
  unchanged (no `--retry` flag anywhere) ✅.
