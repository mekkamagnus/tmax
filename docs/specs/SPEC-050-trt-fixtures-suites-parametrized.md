# Feature: trt — Fixtures, Suites & Parametrized Tests (RFC-001 0.6.2/0.6.3 + Imp. #6/#7)

> **Backlink.** Implements the fixtures, suites, and parametrized-tests portion of
> [RFC-001](../rfcs/RFC-001-trt-framework.md) (Improvements #1, #6, #7). Depends on
> [SPEC-049](SPEC-049-trt-runtime-testing.md) (the self-hosted core + `deftest` macro +
> runner must exist). One of five specs that together implement RFC-001:
> SPEC-049 (core) → **SPEC-050 (this)** → SPEC-051 → SPEC-052 → SPEC-053.

## Feature Description

Add the **organization layer** to the `trt` framework established in SPEC-049: reusable
fixtures with scopes and dependency injection, nested test suites with lifecycle hooks,
and table-driven parametrized tests. After this spec, a test author can express shared
setup, hierarchical grouping, and case matrices natively in T-Lisp — the patterns that
RFC-001 Improvements #1/#6/#7 call for and that the old TS-builtin framework exposed but
which were removed (along with their bun tests) during the SPEC-049 rewrite.

This is **SHOULD-tier** work (fixtures, suites) plus **NICE-tier** (parametrized). All
three are shippable together as one coherent "organization" unit.

## User Story

As a **T-Lisp test author**
I want to **share setup/teardown via fixtures, group related tests in nested suites, and
run one test body across many inputs**
So that **my test suite stays DRY, hierarchically organized, and covers edge cases
without copy-paste.**

## Problem Statement

After SPEC-049, `trt` has `deftest`, `should-*`, isolation, and the structured runner.
But:

1. **No fixtures.** Every test repeats its own buffer creation / state setup. The old
   TS-builtin `deffixture`/`with-fixture` was removed in SPEC-049; coverage for it was
   deleted from bun and must be re-established here in T-Lisp.
2. **Flat structure.** No `describe-suite`, so a file with 30 tests has no grouping,
   no shared `:before-all`/`:after-all`, and no selective execution. The old
   `defsuite`/`deftest-suite` was removed; coverage re-established here.
3. **No parametrization.** Testing the same logic across N inputs means N near-identical
   `deftest`s. RFC-001 Imp. #6 asks for `deftest-parametrized` (table-driven).

## Solution Statement

Three new T-Lisp modules under `src/tlisp/core/trt/`, each a pure-T-Lisp extension of the
SPEC-049 registry/runner:

- `fixtures.tlisp` — `deffixture` with `:scope` (`each`/`once`/`all` ≡ RFC `:function`/
  `:suite`/`:file`), `with-fixture`, auto-cleanup (even on failure), and fixture
  dependency injection (a fixture may request another).
- `suites.tlisp` — `describe-suite` with unlimited nesting and hooks
  (`:before-all`/`:after-all`/`:before-each`/`:after-each`), selective execution,
  `:skip`/`:only`.
- `parametrize.tlisp` — `deftest-parametrized` with table-driven `:cases`, per-case names,
  macro-expands to individual tests.

These extend the SPEC-049 runner: a suite/fixture is just metadata the runner consults
when scheduling a test; the result store shape is unchanged (a parametrized case is a
normal result row with a derived name like `name [case 2/4]`).

## RFC-001 → SPEC mapping (this spec's rows)

| RFC-001 improvement | RFC tier |
|---|---|
| 0.6.2 Fixtures (`deffixture`, scopes, deps) — Imp. #1 | SHOULD |
| 0.6.3 Test Suites (`describe-suite`, hooks) — Imp. #7 | SHOULD |
| Parametrized Tests — Imp. #6 | NICE |

## Relevant Files

### New Files
- `src/tlisp/core/trt/fixtures.tlisp` — `deffixture`, `with-fixture`, scope handling, DI,
  cleanup.
- `src/tlisp/core/trt/suites.tlisp` — `describe-suite`, hook storage, nesting,
  `:skip`/`:only`.
- `src/tlisp/core/trt/parametrize.tlisp` — `deftest-parametrized`, case expansion.
- `test/tlisp/trt-fixtures.test.tlisp`, `test/tlisp/trt-suites.test.tlisp`,
  `test/tlisp/trt-parametrize.test.tlisp` — self-tests (extend the `trt-self` pattern).

### Existing files to change
- `src/tlisp/trt/bootstrap.ts` — load the three new modules at startup (after
  `trt.tlisp`/`assertions.tlisp`).
- `rules/testing.md` — document fixtures/suites/parametrized as the native organization
  primitives.

> **No TS framework files change here.** The SPEC-049 rewrite already removed
> `test-framework.ts` etc. This spec is pure T-Lisp extension; the only TS touch is adding
> three `eval` calls to the bootstrap loader.

## Implementation Plan

Single phase, three modules. Each module lands with its self-tests before the next.

## Step by Step Tasks

### Fixtures (RFC Imp. #1 / 0.6.2)
- [ ] **1.1 `fixtures.tlisp`** — `deffixture` defines a named fixture with a body and an
  optional `:scope` (`each` default, `once`, `all`). `with-fixture` acquires the fixture,
  binds its result, and registers cleanup. Cleanup runs even on test failure (unwind).
- [ ] **1.2 Fixture dependency injection** — a fixture body may itself call `with-fixture`
  on another; acquisition is memoized within the relevant scope so a `:once` dependency
  isn't re-created per test.
- [ ] **1.3 `test/tlisp/trt-fixtures.test.tlisp`** — scopes behave (each vs once vs all),
  DI resolves, cleanup runs on failure, no state leaks across tests.

### Suites (RFC Imp. #7 / 0.6.3)
- [ ] **2.1 `suites.tlisp`** — `describe-suite` registers a named suite with a body of
  tests/sub-suites and hooks (`:before-all`/`:after-all`/`:before-each`/`:after-each`).
  Nesting is unlimited; hooks compose outer→inner.
- [ ] **2.2 Selective execution** — `:skip t` / `:only t` on suites and tests; the runner
  honors `--suite` filtering.
- [ ] **2.3 `test/tlisp/trt-suites.test.tlisp`** — nesting works, hook order is
  outer-before-all → inner-before-each → test → inner-after-each → … → outer-after-all;
  `:skip`/`:only` behave.

### Parametrized (RFC Imp. #6)
- [ ] **3.1 `parametrize.tlisp`** — `deftest-parametrized name :cases '((args…) …)` macro-
  expands to one `deftest` per case, with per-case derived names (`name [case k/n]`).
- [ ] **3.2 `test/tlisp/trt-parametrize.test.tlisp`** — N cases produce N result rows;
  one failing case fails only that row; `trt-results` count reflects cases.

### Bootstrap + docs
- [ ] **4.1** Add the three modules to `loadTrtFramework` in `bootstrap.ts`.
- [ ] **4.2** Update `rules/testing.md`.

## Testing Strategy

- **Self-tests** (T-Lisp): each module has its own `.test.tlisp` exercising the happy path
  + the cleanup-on-failure and no-leak guarantees.
- **Isolation** (re-uses SPEC-049's isolation contract): two `trt-run`s produce identical
  results, including across suites/fixtures.
- **Runner integration**: a parametrized case appears in `trt-results` as a normal row;
  `trt --json` lists each case under `tests`.

## Acceptance Criteria

1. **Fixtures.** `deffixture` with `:scope` (`each`/`once`/`all`), `with-fixture`,
   dependency injection, and auto-cleanup on failure — all T-Lisp in `fixtures.tlisp`.
2. **Suites.** `describe-suite` with unlimited nesting, all four hook types composing
   outer→inner, and `:skip`/`:only`/`--suite` filtering — all T-Lisp in `suites.tlisp`.
3. **Parametrized.** `deftest-parametrized` expands to per-case tests with derived names;
   each case is an independent result row.
4. **Re-homed coverage.** The fixture/suite behavior deleted from bun in SPEC-049 is now
   covered by T-Lisp self-tests (closing that gap).
5. **No TS growth.** Only `bootstrap.ts` changes in TS (three new `eval`s). No new TS
   framework files.
6. **AI-observable preserved.** Fixtures/suites/parametrized cases all surface in
   `trt-results` / `--json` per-test data — no stdout-only observation introduced.
7. **No regressions:** `bun run typecheck`, `bun test`, `bun run test:daemon`,
   `bin/trt` all pass.

## Validation Commands

- `bun run typecheck` — TS clean (only `bootstrap.ts` changed).
- `bin/trt test/tlisp/trt-fixtures.test.tlisp test/tlisp/trt-suites.test.tlisp test/tlisp/trt-parametrize.test.tlisp` —
  new self-tests green, exit 0.
- `bin/trt --json | jq '.stats'` — full suite still parses.
- `bun test` — bun suite unchanged (no regressions).
- `bun run test:daemon` — daemon still boots with the extended bootstrap.

## Notes

- **Why one spec for three features.** Fixtures, suites, and parametrized tests all extend
  the same "scheduling metadata" layer of the runner and share the same self-test
  patterns. Splitting them further would create three specs that each touch
  `bootstrap.ts` and re-litigate the same registry-extension questions. They are
  cohesive.
- **Scope naming.** RFC-001 names scopes `:function`/`:suite`/`:file`; this spec exposes
  them as `each`/`once`/`all` (clearer) and documents the mapping. Both names can be
  accepted if low-cost.
- **Out of scope:** async fixtures (need SPEC-012 → SPEC-051), coverage of fixture-only
  setup code (SPEC-051), Test Explorer grouping (SPEC-053).
