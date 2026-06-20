# Feature: trt — Async, Snapshots & Coverage (RFC-001 0.5.5/0.5.6 + Imp. #8/#9/#10)

> **Backlink.** Implements the async-testing, snapshot-testing, and coverage-reporting
> portion of [RFC-001](../rfcs/RFC-001-trt-framework.md) (Improvements #8, #9, #10).
> Depends on [SPEC-049](SPEC-049-trt-runtime-testing.md) (core + runner) and, for the
> async half, on [SPEC-012](SPEC-012-tlisp-async-primitives.md) (T-Lisp async primitives).
> One of five specs that together implement RFC-001: SPEC-049 → SPEC-050 → **SPEC-051
> (this)** → SPEC-052 → SPEC-053.

## Feature Description

Add the **non-deterministic-input** and **completeness-measurement** capabilities to
`trt`: async tests (with timeouts and fake timers), snapshot tests (external + inline,
with interactive update), and coverage reporting (line/branch/function, multiple formats,
thresholds). After this spec, `trt` can test timer- and async-driven code, lock
serializable values against baselines, and measure how much T-Lisp code the suite
exercises.

This spec carries a **hard prerequisite** the others don't: the async half needs T-Lisp
async primitives (`async-let`, promise values, context-aware I/O) that don't exist yet —
they are [SPEC-012](SPEC-012-tlisp-async-primitives.md). **The async and fake-timer work
in this spec cannot start until SPEC-012 lands.** Snapshots and coverage have no such
dependency and can proceed independently.

Tier: async + coverage are SHOULD; snapshots are NICE.

## User Story

As a **T-Lisp test author**
I want to **test async/timer-driven code, lock values against snapshots, and measure
coverage**
So that **I can verify non-deterministic behavior, catch unintended output drift, and
know how complete my suite is.**

## Problem Statement

After SPEC-049 + SPEC-050, `trt` handles synchronous, organized tests. But:

1. **No async tests.** Code that uses `async-let` or timers can't be tested through
   `deftest` — there's no `done` callback, no timeout, no fake-clock. RFC-001 Imp. #8
   asks for `deftest-async` + `should-await-*` + fake timers. (Blocked on SPEC-012.)
2. **No snapshots.** Detecting unintended changes to serializable outputs requires manual
   comparison. RFC-001 Imp. #9 asks for `should-match-snapshot` + `.snap` files +
   interactive update.
3. **No coverage.** The old `test-coverage.ts` (403 lines) was a function-level TS module
   left untouched by SPEC-049 but never exposed to a runner. RFC-001 Imp. #10 asks for
   line/branch/function coverage with text/JSON/HTML/lcov and thresholds. `basic-coverage.test.ts`
   (which tested `test-coverage.ts` directly) was removed in SPEC-049; coverage must be
   re-established here, with the TS module shrunk to low-level counters and reporting
   moved to T-Lisp.

## Solution Statement

Three modules, two with a clean TS/T-Lisp split:

- `async.tlisp` — `deftest-async` with `done` callback + `:timeout`, `should-await-equal`/
  `should-await-throw`, and fake timers (`with-fake-timers`/`advance-timers`). **Builds on
  SPEC-012's promise values and async evaluator path.**
- `snapshots.tlisp` — `should-match-snapshot`, external `.snap` files + inline snapshots,
  `--update-snapshots` interactive (U/K/D/S/A/Q), diff view. Pure T-Lisp over a small TS
  file-IO helper.
- `coverage.tlisp` — line/branch/function tracking (wraps the shrunk TS counters),
  text/JSON/HTML/lcov reports, thresholds with `--coverage`, exclusion patterns. **Shrinks
  `src/tlisp/test-coverage.ts` → `src/tlisp/trt/coverage-primitives.ts`** (low-level
  counters only; reporting/thresholds move to T-Lisp).

## RFC-001 → SPEC mapping (this spec's rows)

| RFC-001 improvement | RFC tier | Dependency |
|---|---|---|
| 0.6.4 Async Testing (`deftest-async`, fake timers) — Imp. #8 | SHOULD | **SPEC-012** |
| Snapshot Testing — Imp. #9 | NICE | none |
| 0.6.6 / 0.5.6 Coverage (line/branch/func, formats, thresholds) — Imp. #10 | SHOULD | none |

## Relevant Files

### New Files
- `src/tlisp/core/trt/async.tlisp` — async test macro + fake timers.
- `src/tlisp/core/trt/snapshots.tlisp` — snapshot assertions + update flow.
- `src/tlisp/core/trt/coverage.tlisp` — coverage reporting + thresholds (T-Lisp).
- `src/tlisp/trt/coverage-primitives.ts` — low-level counters (the shrunk remainder of
  `test-coverage.ts`).
- `test/tlisp/trt-async.test.tlisp`, `test/tlisp/trt-snapshots.test.tlisp`,
  `test/tlisp/trt-coverage.test.tlisp` — self-tests.
- `test/unit/trt-coverage-primitives.test.ts` — bun test for the shrunk TS counters
  (re-homes the intent of the deleted `basic-coverage.test.ts`).

### Existing files to change
- `src/tlisp/test-coverage.ts` — **shrunk** to `src/tlisp/trt/coverage-primitives.ts`
  (counters only; reporting/thresholds/exclusions move to `coverage.tlisp`). The original
  file is removed.
- `src/tlisp/trt/bootstrap.ts` — load the three new T-Lisp modules at startup.
- `bin/trt` / `cli.tlisp` — add `--coverage` (enforces thresholds, non-zero exit if
  below) and `--update-snapshots`.
- `rules/testing.md` — document coverage as a native gate; snapshot workflow.

## Implementation Plan

Two parallel tracks that can proceed independently, plus the shared bootstrap update:

- **Track A (no deps):** snapshots, then coverage (coverage shrinks the TS file).
- **Track B (blocked on SPEC-012):** async + fake timers. Do not start until SPEC-012 is
  implemented and its promise/async-evaluator path is stable.

The spec is "done" only when both tracks land. If SPEC-012 slips, ship Track A first and
carry Track B forward — snapshots + coverage are valuable alone.

## Step by Step Tasks

### Track A — Snapshots (RFC Imp. #9)
- [ ] **A.1 `snapshots.tlisp`** — `should-match-snapshot` compares a serializable value
  against a stored baseline; first run writes the baseline. External `.snap` files keyed
  by test name; inline snapshots via `should-match-inline-snapshot`.
- [ ] **A.2 `--update-snapshots`** — interactive prompt (U/K/D/S/A/Q) on mismatch; CI
  (non-interactive) mode fails on mismatch. Diff view (unified) for `D`.
- [ ] **A.3 `test/tlisp/trt-snapshots.test.tlisp`** — first-run writes baseline; second
  run compares; update rewrites; mismatch fails.

### Track A — Coverage (RFC Imp. #10 / 0.5.6)
- [ ] **A.4 Shrink `test-coverage.ts` → `coverage-primitives.ts`** — keep only the
  low-level counters; delete reporting/threshold/format code.
- [ ] **A.5 `coverage.tlisp`** — line/branch/function tracking over the TS counters;
  text/JSON/HTML/lcov report generation; `--coverage` flag; threshold enforcement
  (`trt-coverage-thresholds`); exclusion patterns (inline + file-level).
- [ ] **A.6 `test/unit/trt-coverage-primitives.test.ts`** — bun test for the TS counters
  (re-homes `basic-coverage.test.ts`).
- [ ] **A.7 `test/tlisp/trt-coverage.test.tlisp`** — T-Lisp test for reporting +
  thresholds (below threshold → non-zero exit in CI mode).

### Track B — Async (RFC Imp. #8 / 0.5.5) — blocked on SPEC-012
- [ ] **B.1 `async.tlisp`** — `deftest-async` with `done` callback + `:timeout`;
  `should-await-equal` / `should-await-throw`. **Requires SPEC-012's promise values and
  async evaluator.** Do not implement before SPEC-012 lands.
- [ ] **B.2 Fake timers** — `with-fake-timers` / `advance-timers` for deterministic
  timer-based tests.
- [ ] **B.3 `test/tlisp/trt-async.test.tlisp`** — `done` resolves; timeout fails the test;
  fake timers advance deterministically; rejected promises surface as test errors.

### Bootstrap + docs
- [ ] **C.1** Add the three modules to `loadTrtFramework` (async module gated on SPEC-012
  availability — load conditionally or error clearly if SPEC-012's primitives are absent).
- [ ] **C.2** Update `bin/trt`/`cli.tlisp` for `--coverage`/`--update-snapshots`.
- [ ] **C.3** Update `rules/testing.md`.

## Testing Strategy

- **Self-tests** (T-Lisp): each module has its own `.test.tlisp`.
- **TS counter test** (bun): `trt-coverage-primitives.test.ts` for the shrunk TS layer.
- **Edge cases:** async test exceeding `:timeout` → recorded failed; promise rejection →
  recorded failed with error; snapshot first-run writes baseline; coverage below
  threshold → non-zero exit in CI mode; `--update-snapshots` rewrites on accept.

## Acceptance Criteria

1. **Async.** `deftest-async` with `done` + `:timeout`, `should-await-*`, and fake timers
   — all T-Lisp in `async.tlisp`, riding SPEC-012's primitives.
2. **Snapshots.** `should-match-snapshot` (external + inline), `--update-snapshots`
   interactive, CI non-interactive fail-on-mismatch — all in `snapshots.tlisp`.
3. **Coverage.** Line/branch/function tracking in a shrunk `coverage-primitives.ts`;
   reporting + thresholds + exclusions in `coverage.tlisp`; `--coverage` enforces
   thresholds.
4. **`test-coverage.ts` removed** and shrunk to `coverage-primitives.ts`; the deleted
   `basic-coverage.test.ts` intent is re-homed (bun test for the primitives, T-Lisp test
   for reporting).
5. **Dependency honored.** Track B does not merge before SPEC-012; if it does, the
   `async.tlisp` module loads only when SPEC-012's promise type exists.
6. **AI-observable preserved.** Coverage stats, snapshot outcomes, and async results all
   surface in `trt-results` / `--json`.
7. **No regressions:** `bun run typecheck`, `bun test`, `bun run test:daemon`, `bin/trt`,
   `bin/trt --coverage` all pass.

## Validation Commands

- `bun run typecheck` — TS clean.
- `bun test test/unit/trt-coverage-primitives.test.ts` — shrunk TS counters.
- `bin/trt test/tlisp/trt-snapshots.test.tlisp test/tlisp/trt-coverage.test.tlisp` —
  Track A self-tests green (can run before SPEC-012).
- `bin/trt test/tlisp/trt-async.test.tlisp` — Track B self-tests green (only after
  SPEC-012).
- `bin/trt --coverage` — report prints; below-threshold → non-zero exit.
- `bin/trt --json --coverage | jq '.coverage'` — coverage in structured output.
- `bin/trt --update-snapshots` — interactive flow works.
- `bun test` — no regressions.
- `bun run test:daemon` — daemon boots with the extended bootstrap.

## Notes

- **The SPEC-012 dependency is load-bearing.** The original SPEC-049 draft listed
  `deftest-async` as just another Phase 4 deliverable, but T-Lisp has no async primitives
  today — there's nothing for `done` or `should-await-*` to await against. Splitting
  async out and gating it on SPEC-012 is the fix. Snapshots and coverage proceed
  independently.
- **Coverage TS shrink is the last piece of the SPEC-049 "remove TS framework" arc.**
  SPEC-049 deliberately left `test-coverage.ts` alone (out of scope); this spec finishes
  the job, keeping only perf-sensitive counters in TS.
- **Out of scope:** watch-mode re-runs on coverage change (SPEC-052), coverage-by-suite
  attribution in the Test Explorer (SPEC-053).
