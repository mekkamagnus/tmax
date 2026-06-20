# Feature: trt — Watch/TDD, Mocking, Benchmarking & Doctest (RFC-001 0.5.7–0.5.9 + Imp. #11–#14)

> **Backlink.** Implements the developer-experience and advanced-verification portion of
> [RFC-001](../rfcs/RFC-001-trt-framework.md) (Improvements #11, #12, #13, #14). Depends
> on [SPEC-049](SPEC-049-trt-runtime-testing.md) (core + runner + CLI). One of five specs
> that together implement RFC-001: SPEC-049 → SPEC-050 → SPEC-051 → **SPEC-052 (this)** →
> SPEC-053.

## Feature Description

Add the **workflow and advanced-verification** layer to `trt`: watch mode + TDD cycle,
spy-first mocking, benchmarking with regression detection, and examples-as-tests
(doctest). These are all RFC-001 **NICE-tier** features — valuable for a mature test
experience but not on the critical path of "a working self-hosted framework." They share
no deep coupling, but all four are "dev-experience polish" and batch naturally.

## User Story

As a **T-Lisp developer in a fast feedback loop**
I want to **re-run affected tests on file change, drive a Red-Green-Refactor cycle, spy on
function calls, benchmark hot paths, and turn docstring examples into tests**
So that **my TDD workflow is fast, my side effects are verifiable, performance
regressions are caught, and my docs never silently drift from code.**

## Problem Statement

After SPEC-049/050/051, `trt` is a complete *test* framework but offers no *workflow* or
*advanced-verification* tools:

1. **No watch/TDD.** Every change requires a manual `bin/trt` re-run; no affected-test
   selection, no TDD phase tracking (RFC Imp. #12).
2. **No mocking.** Can't verify a function called another, or stub an external dep; spies
   and mocks don't exist (RFC Imp. #13).
3. **No benchmarking.** No way to catch perf regressions or compare implementations (RFC
   Imp. #14).
4. **No doctest.** Docstring/markdown examples can silently drift from the implementation
   (RFC Imp. #11).

## Solution Statement

Four T-Lisp modules, each independent:

- `watch.tlisp` (+ a TS file watcher, since T-Lisp can't watch the FS itself) — `--watch`
  with smart selection (dependency graph), `--tdd` (Red-Green-Refactor), interactive menu
  (a/f/p/t/q), debouncing.
- `mock.tlisp` — `spy-on` (preferred), `mock-fn`, call tracking, verification
  (`should-have-been-called*`), `mock-module` via runtime evaluation. Auto-cleanup per
  test.
- `bench.tlisp` — `deftest-bench`, ops/sec + variance, baselines in `.trt-baselines/`,
  regression detection (`--benchmark`), comparison benches.
- `doctest.tlisp` — extract/run examples from docstrings and markdown, `--docstring-examples`.

All four are NICE-tier, so this spec is explicitly lower priority than 049/050/051 and
should be picked last among the RFC-001 specs.

## RFC-001 → SPEC mapping (this spec's rows)

| RFC-001 improvement | RFC tier |
|---|---|
| 0.5.7 Watch Mode & TDD — Imp. #12 | NICE |
| 0.5.8 Mocking & Spying — Imp. #13 | NICE |
| 0.5.9 Benchmarking — Imp. #14 | NICE |
| Examples as Tests (doctest) — Imp. #11 | NICE |

## Relevant Files

### New Files
- `src/tlisp/core/trt/watch.tlisp` — watch loop + TDD state machine (T-Lisp); selection
  logic over the registry + a dependency graph.
- `src/tlisp/trt/watch-primitives.ts` — the TS file watcher (fs events), since T-Lisp
  can't watch the filesystem itself; calls into the T-Lisp watch loop on change.
- `src/tlisp/core/trt/mock.tlisp` — `spy-on`/`mock-fn`/verification.
- `src/tlisp/core/trt/bench.tlisp` — `deftest-bench` + baselines.
- `src/tlisp/core/trt/doctest.tlisp` — example extraction + execution.
- `test/tlisp/trt-watch.test.tlisp`, `trt-mock.test.tlisp`, `trt-bench.test.tlisp`,
  `trt-doctest.test.tlisp` — self-tests.

### Existing files to change
- `src/tlisp/trt/bootstrap.ts` — load the four new modules at startup.
- `bin/trt` / `cli.tlisp` — add `--watch`, `--tdd`, `--benchmark`, `--docstring-examples`.
- `rules/testing.md` — document the watch/TDD workflow, mocking conventions, doctest
  expectations.

## Implementation Plan

Four independent modules. Implement in any order; each is independently shippable. Mock
and bench have no FS dependencies and are the lowest-risk starting points; watch needs
the TS file-watcher shim; doctest needs the docstring/markdown parser.

## Step by Step Tasks

### Watch & TDD (RFC Imp. #12)
- [ ] **1.1 `watch-primitives.ts`** — TS file watcher over `test/tlisp/` + `src/tlisp/`,
  debounced; emits change events the T-Lisp loop consumes.
- [ ] **1.2 `watch.tlisp`** — `--watch` loop; smart selection via a dependency graph
  (which tests cover which source files); interactive menu (a/f/p/t/q/enter).
- [ ] **1.3 `--tdd` mode** — Red-Green-Refactor cycle tracking; status-line phase output.
- [ ] **1.4 `test/tlisp/trt-watch.test.tlisp`** — change triggers re-run; affected-only
  selection; TDD phase transitions.

### Mocking (RFC Imp. #13)
- [ ] **2.1 `mock.tlisp`** — `spy-on` (preferred, wraps real fn), `mock-fn` (replaces),
  call tracking (args, return, order), verification (`should-have-been-called*`,
  `should-have-been-called-with`, `should-have-been-called-times`).
- [ ] **2.2 `mock-module`** via runtime evaluation (avoid vi.mock-style hoisting
  pitfalls); auto-cleanup per test.
- [ ] **2.3 `test/tlisp/trt-mock.test.tlisp`** — spy call tracking; verification matchers;
  auto-cleanup (no leak across tests).

### Benchmarking (RFC Imp. #14)
- [ ] **3.1 `bench.tlisp`** — `deftest-bench`, ops/sec + variance on a fixed workload;
  baselines in `.trt-baselines/`; `--benchmark` regression detection (threshold);
  comparison benches (A vs B → speedup).
- [ ] **3.2 `test/tlisp/trt-bench.test.tlisp`** — deterministic timing on a fixed
  workload; regression detection trips on a deliberate slowdown; baseline compare.

### Doctest (RFC Imp. #11)
- [ ] **4.1 `doctest.tlisp`** — extract `=>` examples from T-Lisp docstrings and fenced
  blocks from markdown; run them; `--docstring-examples`. Triple-purpose (docs/tests/
  demos).
- [ ] **4.2 `test/tlisp/trt-doctest.test.tlisp`** — examples pass when code matches;
  fail (with the offending example) when it drifts.

### Bootstrap + docs
- [ ] **5.1** Add the four modules to `loadTrtFramework`.
- [ ] **5.2** Update `bin/trt`/`cli.tlisp` and `rules/testing.md`.

## Testing Strategy

- **Self-tests** (T-Lisp): each module has its own `.test.tlisp`.
- **Determinism:** bench tests use a fixed workload and assert relative behavior (regression
  trips on a deliberate slowdown), not absolute timings, to avoid CI flakiness.
- **Watch determinism:** simulate change events in tests rather than relying on real FS
  timing where possible.

## Acceptance Criteria

1. **Watch/TDD.** `--watch` re-runs affected tests on change (debounced) with the
   interactive menu; `--tdd` tracks Red-Green-Refactor.
2. **Mocking.** `spy-on`/`mock-fn` with call tracking + verification matchers +
   auto-cleanup; `mock-module` via runtime evaluation.
3. **Benchmarking.** `deftest-bench` with ops/sec + variance, baselines, regression
   detection, and comparison.
4. **Doctest.** Docstring + markdown examples run as tests via `--docstring-examples`.
5. **No TS growth beyond the watcher.** Only `watch-primitives.ts` is new TS (fs events);
   everything else is T-Lisp. No new TS framework files.
6. **AI-observable preserved.** Bench results, mock verification failures, and doctest
   outcomes all surface in `trt-results` / `--json`.
7. **No regressions:** `bun run typecheck`, `bun test`, `bun run test:daemon`, `bin/trt`,
   `bin/trt --watch` (smoke), `bin/trt --benchmark` all pass.

## Validation Commands

- `bun run typecheck` — TS clean (only `watch-primitives.ts` added).
- `bin/trt test/tlisp/trt-mock.test.tlisp test/tlisp/trt-bench.test.tlisp test/tlisp/trt-doctest.test.tlisp` —
  three non-watch self-tests green.
- `bin/trt test/tlisp/trt-watch.test.tlisp` — watch self-test green (simulated events).
- `bin/trt --benchmark` — bench report; deliberate-slowdown detection trips.
- `bin/trt --docstring-examples` — examples run.
- `bin/trt --watch` — smoke (starts, responds to one simulated change, exits).
- `bun test` — no regressions.
- `bun run test:daemon` — daemon boots with the extended bootstrap.

## Notes

- **All NICE-tier, lowest priority.** If the RFC-001 effort is descoped, this is the spec
  to defer first. The framework is fully functional for its core purpose without it.
- **Watch needs a TS shim.** T-Lisp can't watch the filesystem, so `watch-primitives.ts`
  is the one new TS file — and it's a thin fs-events → callback bridge, not framework
  logic. This matches SPEC-049's "TS keeps what T-Lisp can't bootstrap" rule.
- **Bench determinism.** Absolute timings are CI-flaky; assert relative behavior
  (regression trips on a *deliberate* slowdown) and document the workload.
- **Out of scope:** Test Explorer integration of watch/mock/bench output (SPEC-053).
