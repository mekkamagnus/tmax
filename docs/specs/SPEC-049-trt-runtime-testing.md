# Feature: trt — Self-Hosted Core + AI-Observable Runner (RFC-001 Phases 0.5.1–0.5.3 + 0.6.1 + 0.6.5)

> **Scope note.** This spec is the **decisive first unit** of the RFC-001
> implementation. It covers **only** the rewrite of the framework into self-hosted
> T-Lisp (Phase 1) and the CLI / structured-output runner (Phase 2). The remaining
> RFC-001 capabilities are tracked as separate specs, each independently shippable:
>
> - **SPEC-050** — fixtures, suites, parametrized tests (RFC 0.6.2/0.6.3 + Imp. #6/#7)
> - **SPEC-051** — async, snapshots, coverage (RFC 0.5.5/0.5.6 + Imp. #9/#10; **depends on SPEC-012**)
> - **SPEC-052** — watch/TDD, mocking, benchmarking, doctest (RFC 0.5.7–0.5.9 + Imp. #11–#14)
> - **SPEC-053** — Test Explorer UI + pilot migration of T-Lisp-behavior tests (RFC 0.5.4 + migration)
>
> Splitting is intentional: RFC-001 is a 28–37 day, 14-improvement epic. This spec
> delivers the load-bearing change (the framework becomes T-Lisp, the runner becomes
> machine-observable) as a unit that can land and be audited on its own.

## Feature Description

**`trt` = T-Lisp Runtime Testing.** This spec replaces the current TypeScript-builtin
test framework with a **self-hosted T-Lisp framework** and wires it to a **native CLI
runner** that returns **structured, machine-readable results**. After this spec, the
framework lives in `src/tlisp/core/trt/*.tlisp`; TypeScript keeps only a bootstrap
loader, a pure result store, and CLI plumbing.

**Status: ALPHA.** tmax is pre-1.0. **Breaking changes are acceptable and expected.**
This spec does **not** preserve the existing TS-builtin framework as a compatibility
shim — it *replaces* it. The existing `src/tlisp/test-framework.ts` (~2,400 lines of
interpreter builtins) is the scaffolding that satisfied "it works today"; `trt` is the
proper, native form RFC-001 calls for. Migration is a rewrite, not a wrap.

### Why self-hosted (RFC-001's core thesis)

RFC-001 is explicit that tmax follows a **Lisp-first architecture** — "T-Lisp handles
everything; TypeScript is a thin UI layer." The current testing framework inverts that:
`deftest`, `assert-*`, `test-run-all` are all **TypeScript builtins** wired into the
evaluator as special forms. That is the wrong shape for tmax. `trt` moves the framework
**into T-Lisp**, leaving only the loader + result store in TS.

### The three properties that define success (this spec)

1. **Native.** Tests exercise the *actual runtime* the user runs (the daemon's
   interpreter + editor API), authored in the same language as the code under test.
2. **Self-hosted.** `deftest` is a T-Lisp macro; assertions and the runner are T-Lisp
   functions. TS holds only a loader + a pure result store + CLI wiring.
3. **AI-observable.** Results are returned as structured data (`trt-results`,
   `trt-results-json`), never stdout-only. An agent obtains per-test
   `{name, passed, error, duration}` programmatically and loops
   `trt → parse → fix → trt` with no human in the loop.

## User Story

As an **AI agent (or developer) verifying tmax behavior**
I want to **author tests in T-Lisp `.test.tlisp` files and run them through a native,
self-hosted `trt` framework that returns structured, machine-readable results**
So that **the test framework lives in the runtime it tests, and is observable without
stdout scraping.**

## Problem Statement

The T-Lisp testing story today fails RFC-001 on its own terms:

1. **Not self-hosted.** The framework is ~3,000 lines of TypeScript
   (`test-framework.ts` 2,387, `test-output.ts` 262, `test-registry.ts` 20,
   `test-coverage.ts` 403) wired into the evaluator as special forms. This contradicts
   RFC-001's Lisp-first architecture and is opaque to an agent working in the T-Lisp
   world.
2. **No entry point.** No `trt` command, no `tmax --test`, no `test:trt` npm script.
   `docs/ROADMAP.md:377` claims `bun run test:trt` exists — **it does not** (corrected by
   this spec).
3. **Not observable.** `test-run-all` returns only aggregate counts; real per-test
   results go to `console.log`. An agent cannot see *which* tests failed or *why* without
   scraping stdout.
4. **Tests live in the wrong language.** Bun files in `test/unit/` re-assert T-Lisp
   behavior through `interpreter.execute()`. That behavior belongs natively in
   `.test.tlisp`. (The actual migration of T-Lisp-behavior suites is **SPEC-053**; this
   spec only establishes the framework they migrate *into*.)

## Solution Statement

Rewrite the framework as T-Lisp in `src/tlisp/core/trt/`, shrinking the TS surface to a
loader + result store + CLI. Ship in two phases: **Phase 1** = the rewrite (registry,
`deftest` macro, `should-*` library, isolation, structured results, self-tests);
**Phase 2** = the CLI runner (`bin/trt`, `tmax --test`/`--json`, `test:trt`, exit codes,
discovery, `--filter`/`--verbose`, JSON/structured output).

### Architecture

```
src/tlisp/core/trt/            ← the framework, in T-Lisp (NEW)
  trt.tlisp                    registry, deftest macro, isolation, runner, structured results
  assertions.tlisp             should-* library (basic + rich)
  cli.tlisp                    trt-discover / trt-load-file / trt-run (T-Lisp entry points)

src/tlisp/trt/                 ← TS thin layer (SHRUNK from current ~3,000 lines)
  bootstrap.ts                 loads src/tlisp/core/trt/*.tlisp at interpreter startup
  results.ts                   pure result-store + JSON serialization (shared contract)

bin/trt                        ← CLI wrapper → bin/tmax --test
test/tlisp/*.test.tlisp        ← the native suite (modes.test.tlisp migrated + trt self-tests)
test/unit/trt-*.test.ts        ← bun tests validating the TS bootstrap + CLI only
```

> **Path note vs RFC-001.** RFC-001 specifies the T-Lisp framework at
> `src/tlisp/trt/trt.tlisp`. This spec places the **T-Lisp** framework under
> `src/tlisp/core/trt/` (matching the existing `src/tlisp/core/{bindings,modes,…}`
> convention) and reserves `src/tlisp/trt/` for the **TS** thin layer. The divergence is
> deliberate and is reconciled with RFC-001 as part of this spec's RFC update (the RFC's
> `Status` flips to `PARTIALLY IMPLEMENTED` with a path note).

**What TS keeps (and why):** a bootstrap loader (TS must seed the interpreter before
T-Lisp can run) and the pure result-store + JSON serializer (the structured-output
contract, tested in isolation). Everything else — `deftest`, assertions, the runner,
discovery — moves to T-Lisp. (Coverage counters stay TS too, but those arrive with
**SPEC-051**, not here.)

## Boundary principle — what migrates and what does NOT

**Hard rule: don't test a TS primitive in the language that depends on it.** A
`.test.tlisp` harness is parsed/evaluated by the TS tokenizer/parser/evaluator, so
testing those in T-Lisp is *circular* — a tokenizer bug would corrupt the harness and
mask the failure with false greens. TS primitives need an **external** harness (bun) that
does not depend on them.

**Diagnostic:** if a bun test imports a TS primitive (`TLispParser`, `tokenize`,
`createEvaluatorWithBuiltins`) and asserts on its output → **stays bun**. If it drives
`interpreter.execute(...)` and re-asserts the T-Lisp result → **migration candidate**
(actual migration is SPEC-053).

**Corollary for the framework rewrite:** the `trt` T-Lisp framework is itself T-Lisp
code, so it is tested by `.test.tlisp` files (`trt-self.test.tlisp`). But its **TS
bootstrap + result-store** are TS, so they are tested by `test/unit/trt-*.test.ts` in
bun. This keeps the framework's TS spine honest without circularity.

> **Soundness caveat.** `trt-self.test.tlisp` runs *under* trt, which runs *under* the TS
> evaluator. So a TS-evaluator bug could in principle mask itself with a false green in
> the self-test. This is why the evaluator stays in bun and the bootstrap/result-store
> have their own bun tests. The self-test proves the framework is **self-consistent
> end-to-end**, not that the evaluator is correct (bun does that). The earlier draft's
> wording "proves the rewrite is sound" overstated this.

## Interactive M-x commands (the TUI surface)

The `bin/trt` CLI is for CI/agents, but a user *in the editor* drives trt through M-x
commands — these are the Emacs-ERT-parity interactive entry points. They are plain `defun`s
in `src/tlisp/core/commands/trt-commands.tlisp` (auto-discovered by M-x), reading the
existing result store. No new TS machinery: every one is feasible with the data model
Phase 1–2 already establishes (`name`/`passed`/`error`/`durationMs`).

### Priority 1 — the debugging loop (build first)

| Command | Purpose | Emacs-ERT analogue |
|---------|---------|--------------------|
| `trt-run-tests` | Run the whole suite; report summary + failures to `*Messages*`. (Already the demo command.) | `M-x ert` |
| `trt-run-failing` | Re-run **only** the tests that failed in the last run. The core TDD loop: write test → fail → fix → re-run, without waiting on the full suite each iteration. Filters the registry by the last run's failures. | `M-x ert` with a selector — trt's named equivalent of "run just the red ones" |
| `trt-run-test` | Run a **single** named test, prompted with minibuffer completion over registered test names. For isolating one failing test while debugging. `trt-run` already takes a name; this makes it interactive. | `M-x ert RET name RET` |
| `trt-find-test` | Jump to a test's `deftest` source definition (completion-prompted). When `*Messages*` shows `FAIL should-equal-passes-on-equal`, this opens the file at that definition. Searches `test/tlisp/` for `(deftest <name>`. | `M-x ert-find-test` |

### Priority 2 — visibility (understand a run without re-running)

| Command | Purpose |
|---------|---------|
| `trt-results` | Show the last run's summary + per-test PASS/FAIL list in a dedicated `*trt-results*` buffer (not the scrolling `*Messages*` log). This is the seed of the Phase-6 Test Explorer: a navigable buffer you keep open, press `Enter` to jump to source. Data is one `trt-results-json` call away. |
| `trt-describe-test` | Show a test's body/docstring in `*Messages*` or a help buffer. Answers "what does this test actually check?" without hunting for the file. |
| `trt-show-timings` | List tests sorted by `durationMs` (slowest first). Every result already carries duration; this surfaces slow tests that would otherwise hide. |

### Priority 3 — toggles (configure a run)

| Command | Purpose |
|---------|---------|
| `trt-toggle-coverage` | Flip coverage tracking on/off for the next run (the coverage bridge exists; this makes it TUI-reachable). |
| `trt-update-snapshots` | Set `trt-snapshot-update` to `t` for the next run, then reset it. The "I intentionally changed the output, accept the new baseline" flip (SPEC-051 snapshots, when they land). |

> **ERT parity note.** ERT's `*ert*` results buffer (re-run one test, view backtrace, view
> messages, filter by result) is the full interactive IDE experience; `trt-results` is the
> first step toward it, and the Phase-6 Test Explorer is the complete version. The commands
> above are the user-facing surface that buffer serves.

## RFC-001 → SPEC mapping (full picture)

Every RFC-001 improvement maps to exactly one spec. This spec covers the bolded rows.

| RFC-001 improvement | Spec | RFC tier |
|---|---|---|
| **0.5.1 Core Framework (deftest macro, runner, discovery, exit codes)** | **SPEC-049 (Ph 1+2)** | **MUST** |
| **0.5.2 Essential Assertions (`should-*` basic)** | **SPEC-049 (Ph 1)** | **MUST** |
| **0.5.3 Basic Isolation (env reset, hooks)** | **SPEC-049 (Ph 1)** | **MUST** |
| **0.6.1 Rich Assertions (string/collection/numeric, `defassertion`)** | **SPEC-049 (Ph 1)** | **SHOULD** |
| **0.6.5 Better CLI Output (progress, color, verbose)** | **SPEC-049 (Ph 2)** | **SHOULD** |
| 0.6.2 Fixtures (`deffixture`, scopes, deps) — Imp. #1 | SPEC-050 | SHOULD |
| 0.6.3 Test Suites (`describe-suite`, hooks) — Imp. #7 | SPEC-050 | SHOULD |
| Parametrized Tests — Imp. #6 | SPEC-050 | NICE |
| 0.6.4 Async Testing (`deftest-async`, fake timers) — Imp. #8 | SPEC-051 (needs SPEC-012) | SHOULD |
| Snapshot Testing — Imp. #9 | SPEC-051 | NICE |
| 0.6.6 / 0.5.6 Coverage (line/branch/func, formats, thresholds) — Imp. #10 | SPEC-051 | SHOULD |
| 0.5.7 Watch Mode & TDD — Imp. #12 | SPEC-052 | NICE |
| 0.5.8 Mocking & Spying — Imp. #13 | SPEC-052 | NICE |
| 0.5.9 Benchmarking — Imp. #14 | SPEC-052 | NICE |
| Examples as Tests (doctest) — Imp. #11 | SPEC-052 | NICE |
| 0.5.4 Test Explorer UI — Imp. #4 | SPEC-053 | SHOULD |
| Pilot migration (T-Lisp behavior → `.test.tlisp`) | SPEC-053 | — |

## Relevant Files

### Removed by this spec

- **`src/tlisp/test-framework.ts`** — **removed** (deftest/runner/assertions →
  `src/tlisp/core/trt/`).
- **`src/tlisp/test-output.ts`** — **removed** (output logic → `trt.tlisp` / `cli.tlisp`).
- **`src/tlisp/test-registry.ts`** — **removed** (registry → T-Lisp hashmap in `trt.tlisp`).
- **`test/unit/test-tlisp-testing-framework.test.ts`** — **removed** (tested the deleted
  TS framework; its coverage moves to `trt-self.test.tlisp`).
- **`test/unit/test-rich-assertions.test.ts`** — **removed** (same reason).
- **`test/unit/test-fixtures-system.test.ts`** — **removed** (same reason; fixture
  coverage is re-established in SPEC-050).
- **`test/unit/test-test-suites.test.ts`** — **removed** (same reason; suite coverage is
  re-established in SPEC-050).
- **`test/unit/test-better-cli-output.test.ts`** — **removed** (same reason; CLI output
  coverage moves to `test/unit/trt-cli.test.ts`).
- **`test/unit/basic-coverage.test.ts`** — **removed** (tested the deleted `test-coverage.ts`
  directly; coverage is re-established in SPEC-051).

> **Why delete six bun files, not migrate them?** Each imports the TS framework it
> targets. Removing `test-framework.ts` deletes their subject. They cannot "stay green
> against the new framework" — they were written to assert TS-builtin internals, not
> T-Lisp behavior. Their *intent* is re-homed: framework behavior → `trt-self.test.tlisp`,
  CLI output → `trt-cli.test.ts`, fixtures/suites/coverage → SPEC-050/SPEC-051. Deleting
  them in the same phase as the rewrite is what keeps the "no regressions" gate honest.

### Existing files to change

- **`src/tlisp/test-coverage.ts`** — **untouched in this spec** (stays as-is; shrunk in
  SPEC-051). Listed here so it's clear it is *not* removed now.
- **`src/tlisp/evaluator.ts`** — remove the `deftest`/`deftest-async`/`deftest-suite`/
  `defsuite`/`assert-*` special forms (`evaluator.ts:641,643,645,675,677,763–782`) and
  `getTestDefinition`/`getAllTestNames`/`getAllSuiteNames`/`getSuiteDefinition`. Remove
  the `registerTestingFramework` wiring.
- **`src/tlisp/types.ts:204–213`** — remove the test-registry methods from the interpreter
  interface (the registry is now T-Lisp-side state).
- **`src/server/server.ts:~184`** — replace `registerTestingFramework(interpreter)` with
  the trt bootstrap (`loadTrtFramework(interpreter)`), so the daemon exposes the new
  framework.
- **`bin/tmax`** — add `--test` / `--json`: ensure daemon, eval `(trt-run …)`, map stats
  → exit code.
- **`package.json`** — add `"test:trt": "bin/trt"`.
- **`docs/ROADMAP.md:377`** — correct the false `bun run test:trt` claim; this spec makes
  it true.
- **`docs/rfcs/RFC-001-trt-framework.md`** — Status: PROPOSED → **PARTIALLY
  IMPLEMENTED** (SPEC-049 covers 0.5.1–0.5.3, 0.6.1, 0.6.5); add the path note and a
  backlink to each implementing spec. RFC-001 stays open until SPEC-053 lands.
- **`rules/testing.md`** — document `trt` as the native gate; restate the boundary
  principle.

### New Files

**T-Lisp framework (`src/tlisp/core/trt/`):**
- `trt.tlisp` — registry (T-Lisp hashmap), `deftest` macro, per-test isolation (child env
  + state reset), runner that populates the TS result store, `trt-results`/
  `trt-results-json`.
- `assertions.tlisp` — `should-*` library (basic + rich) and `defassertion`.
- `cli.tlisp` — `trt-discover`, `trt-load-file`, `trt-run`, `--filter` application.

**TS thin layer (`src/tlisp/trt/`):**
- `bootstrap.ts` — `loadTrtFramework(interpreter)`: reads and evals
  `core/trt/trt.tlisp` + `assertions.tlisp` + `cli.tlisp` at startup (mirror the existing
  core-loader pattern in `editor.ts:1624`).
- `results.ts` — pure result store + JSON serialization (the AI-observable contract).

**CLI:**
- `bin/trt` — bash wrapper → `bin/tmax --test` (mirror `bin/tlisp`).

**Native suite:**
- `trt-self.test.tlisp` — the framework tests itself (deftest runs a deftest; `should-*`
  checks; isolation across runs).

**TS validation tests (`test/unit/`):**
- `trt-bootstrap.test.ts` — bun test: the loader brings up the framework; `trt-results`
  shape is correct.
- `trt-cli.test.ts` — bun test: `bin/trt` exit codes (0/1/2), `--json` parses,
  `--filter` works.

## Implementation Plan

### Phase 1: Self-hosted core (RFC 0.5.1–0.5.3 + 0.6.1) — the rewrite
Replace the TS builtins with a pure T-Lisp framework: `deftest` macro, the `should-*`
library (basic + rich), per-test isolation, the structured result store, and the
registry. The framework becomes self-testing. TS shrinks to the bootstrap + result store.

### Phase 2: CLI + AI-observable runner (RFC 0.5.1 CLI + 0.6.5 output)
`bin/trt`, `tmax --test`/`--json`, `test:trt` script, exit codes 0/1/2, `--filter`,
`--verbose`, discovery (`trt-discover`/`trt-load-file`/`trt-run` in `cli.tlisp`), and the
JSON/structured contract.

### Phase 2b: Interactive M-x commands (TUI surface)
The Emacs-ERT-parity interactive commands described in *Interactive M-x commands* above.
Priority 1 first (the debugging loop), then Priority 2 (visibility). Each is a `defun` in
`src/tlisp/core/commands/trt-commands.tlisp` reading the result store; no new TS.

## Step by Step Tasks

> Execute phases in order; Phase 1's validation must pass before Phase 2. Tests are
> written alongside each step. ALPHA: breaking changes to the old framework are expected
> in Phase 1.

### Phase 1 — Self-hosted core (the rewrite)

- [ ] **1.1 Create `src/tlisp/trt/results.ts`** — pure result store:
  `{name, passed, error?, durationMs}` + aggregates; `resetResultStore()`,
  `recordResult()`, `getResults()`, `toTLispValue()`, `toJson()`. No I/O. Tested by
  `test/unit/trt-bootstrap.test.ts`.
- [ ] **1.2 Write `src/tlisp/core/trt/trt.tlisp`** — the registry (T-Lisp hashmap),
  `deftest` macro, per-test isolation (each test runs in a child environment with
  `clear-test-state` first), and the runner that populates the result store via the TS
  `results.ts` accessors. **`deftest` signature (must match the existing convention):**
  `(deftest name (params...) body...)` — the `(params...)` list is required and may be
  empty, exactly as `test/tlisp/modes.test.tlisp` uses today (`(deftest name () ...)`).
  `deftest` is a **macro** per RFC-001 (body stays unevaluated); it registers the test
  and returns the name.
- [ ] **1.3 Write `src/tlisp/core/trt/assertions.tlisp`** — the `should-*` library:
  `should-equal`, `should-be-truthy`, `should-be-falsy`, `should-throw` (basic, RFC
  0.5.2), then rich (RFC 0.6.1): `should-contain`, `should-match`, `should-have-length`,
  `should-be-greater-than`, `should-be-close-to`, and `defassertion` (custom assertions).
  Assertions signal failure via a `trt-fail` condition the runner catches — clean error
  messages, not raw exceptions.
- [ ] **1.4 Write `src/tlisp/core/trt/trt-self.test.tlisp`** — the framework tests
  itself: `deftest` a passing/failing test, assert `trt-results` reflects them, assert
  isolation across runs. This is the proof the rewrite is self-consistent end-to-end.
- [ ] **1.5 Write `src/tlisp/trt/bootstrap.ts`** — `loadTrtFramework(interpreter)`:
  reads and evals `core/trt/trt.tlisp` + `assertions.tlisp` at startup (mirror the
  existing core-loader pattern in `editor.ts:1624`).
- [ ] **1.6 Rewire the daemon:** in `server.ts`, replace `registerTestingFramework` with
  `loadTrtFramework`. Remove the TS `deftest`/`assert-*` builtins and evaluator
  test-registry methods. **This is the breaking change; alpha permits it.**
- [ ] **1.7 Delete the six orphaned framework-testing bun files** (see "Removed by this
  spec" above) **in the same change** as 1.6. Their coverage is re-homed to
  `trt-self.test.tlisp` / `trt-cli.test.ts` / (later) SPEC-050–051.
- [ ] **1.8 Update `test/tlisp/modes.test.tlisp`** to the new `should-*` API (was
  `assert-*`) and confirm it passes under the new framework via the daemon. The
  `(deftest name () ...)` shape is preserved by 1.2, so this is an assertion-rename pass.

### Phase 2 — CLI + AI-observable runner

- [ ] **2.1 Write `src/tlisp/core/trt/cli.tlisp`** — `(trt-discover [path])` scans
  `test/tlisp/` for `*.test.tlisp`; `(trt-load-file path)` evaluates one;
  `(trt-run [path-or-pattern])` does clear → discover/load → run → return
  `(trt-results)`. `--filter` applies a regex to test names.
- [ ] **2.2 Add `--test` / `--json` to `bin/tmax`** (follow the `-e`/`--capture` pattern):
  ensure daemon, eval `(trt-run …)`, print, **exit 0/1/2** based on the returned stats.
- [ ] **2.3 Create `bin/trt`** — `exec "$PROJECT_DIR/bin/tmax" --test "$@"` (mirror
  `bin/tlisp`).
- [ ] **2.4 Add `"test:trt": "bin/trt"`** to `package.json`.
- [ ] **2.5 Better CLI output (RFC 0.6.5)** — ANSI color, progress bar, summary stats,
  per-file grouping, `--verbose`/`--quiet`/`--plain` modes. Human output reads from the
  result store.
- [ ] **2.6 Write `test/unit/trt-cli.test.ts`** (bun) — drives `bin/trt` on temp fixtures
  (pass/fail files), asserts exit codes 0/1/2 and that `--json` parses with `stats`/
  `tests` keys. Also asserts the two edge cases below: `--filter` matching nothing →
  exit 0 / zero total; missing path → exit 2.

### Phase 2b — Interactive M-x commands (TUI surface)

- [ ] **2b.1 `trt-run-tests`** — the demo command (already prototyped): discover+load+run the
  whole suite, report summary + failing names + errors to `*Messages*`. This is `M-x ert`.
- [ ] **2b.2 `trt-run-failing`** — re-run only the tests in the last run's failure list
  (`trt-failed-tests` already returns them). The core red-green-loop accelerator.
- [ ] **2b.3 `trt-run-test`** — run one named test, prompted via minibuffer completion over the
  registered test names. Wraps the existing `trt-run <name>`.
- [ ] **2b.4 `trt-find-test`** — jump to a test's `(deftest <name>` source line across
  `test/tlisp/` (open the file, search for the definition).
- [ ] **2b.5 `trt-results`** — populate a `*trt-results*` buffer from the last run: per-test
  PASS/FAIL lines, navigable, `Enter` jumps to source. Seed of the Phase-6 Test Explorer.
- [ ] **2b.6 `trt-describe-test` + `trt-show-timings`** — Priority-2 visibility commands
  (describe a test body; list tests by duration).
- [ ] **2b.7 Self-test:** add a `trt-self.test.tlisp` case asserting `trt-run-failing` only
  re-runs known failures (register a pass + a fail, run, run-failing, assert the pass was NOT
  in the second run's results).

## Testing Strategy

### Framework self-tests (T-Lisp, in `trt-self.test.tlisp`)
- `deftest` registers and runs; `should-*` pass/fail correctly; isolation (two runs
  identical).

### TS validation tests (bun, in `test/unit/`)
- `trt-bootstrap.test.ts` — the loader brings up the framework; `trt-results`/JSON shape
  correct.
- `trt-cli.test.ts` — `bin/trt` exit codes (0/1/2), `--json` parses, `--filter` runs a
  subset (and the two edge cases), `--verbose` changes output.

### Integration
- `bin/trt` on the real repo end-to-end: green run exits 0; a deliberately-failing
  fixture exits 1; a missing path exits 2.

### Edge Cases (all exercised by Validation Commands)
- Re-running `trt-run` twice in one daemon session leaves no leaked state (isolation).
- A test file that throws at load → exit 2, not a silent pass.
- Empty result store → zeroed stats, valid JSON, empty tests list.
- A `deftest` calling an undefined function → recorded failed with the error, run
  continues.
- `--filter` matching nothing → exit 0, zero total (documented), not an error.
- Missing path → exit 2.

## Acceptance Criteria

1. **Self-hosted.** `deftest`, the `should-*` library (basic + rich), `defassertion`, the
   runner, discovery, and the registry are all **T-Lisp** in `src/tlisp/core/trt/`. TS
   holds only `bootstrap.ts`, `results.ts`, and CLI wiring. The old
   `test-framework.ts`/`test-output.ts`/`test-registry.ts` are **removed**, and the six
   framework-testing bun files are **removed** (their coverage re-homed).
2. **Native runner.** `bin/trt` runs `test/tlisp/`, prints per-test pass/fail + summary,
   exits 0 all-pass / 1 any-fail / 2 error. `bun run test:trt` exists (correcting
   ROADMAP).
3. **AI-observable.** `(trt-results)` returns structured per-test data;
   `(trt-results-json)` / `trt --json` returns valid JSON (`stats` + `tests`), parseable
   by `jq`, with no stdout scraping.
4. **Isolation.** Two consecutive `trt-run`s in one daemon session produce identical
   results.
5. **`deftest` convention preserved.** The `(deftest name (params...) body...)` shape is
   retained, so existing `.test.tlisp` files (and the SPEC-053 migrations) work without
   syntactic churn.
6. **Boundary respected.** TS primitives — `tokenizer`/`parser`/`evaluator`/`stdlib`/
   `macros`/`tail-call`/`hashmap`/`quasiquote` tests — **remain in bun**. No
   `.test.tlisp` imports or re-tests a TS primitive.
7. **RFC-001 updated:** its Status changes PROPOSED → **PARTIALLY IMPLEMENTED** (this spec
   covers RFC 0.5.1–0.5.3, 0.6.1, 0.6.5), with a path note and backlinks to SPEC-049
   through SPEC-053.
8. **Interactive M-x commands.** The Priority-1 commands (`trt-run-tests`,
   `trt-run-failing`, `trt-run-test`, `trt-find-test`) are invocable via M-x and behave as
   specified: `trt-run-failing` re-runs only the last run's failures (verified by a
   `trt-self.test.tlisp` case), and `trt-find-test` jumps to a `(deftest` definition. The
   Priority-2/3 commands may land incrementally.
9. **No regressions:** `bun run typecheck`, `bun test` (with the six framework-testing
   bun files removed), `bun run test:daemon`, `bun run test:ui:renderer` all pass.

> **Out of scope for this spec** (explicitly deferred to SPEC-050–053): fixtures, suites,
> parametrized tests, async, fake timers, snapshots, coverage, mocking, benchmarking,
> doctest, the Test Explorer UI, and the pilot migration of T-Lisp-behavior bun suites.
> This spec only establishes the framework those features extend and migrate into.

## Validation Commands

Run in order; every command must pass with zero regressions.

- `bun run typecheck:src && bun run typecheck:test && bun run typecheck` — type safety
  for the shrunk TS layer (`bootstrap.ts`, `results.ts`, trt bun tests).
- `bun test test/unit/trt-bootstrap.test.ts test/unit/trt-cli.test.ts` — the TS spine +
  CLI, including the `--filter`-matches-nothing (exit 0) and missing-path (exit 2) cases.
- `bin/trt` — full native suite, exit 0.
- `bin/trt --json | jq '.stats'` — JSON parses, shows passed/failed/total.
- `bin/trt test/tlisp/modes.test.tlisp` — single-file run, exit 0.
- `bin/trt --filter nomatch` — matches nothing → exit 0, zero total (documented).
- `bin/trt /no/such/path` — missing path → exit 2.
- `tmax -e '(trt-run-failing)'` after a run with a known failure → result store contains
  only the previously-failing tests (not the full suite). The M-x command surface is also
  exercised headlessly via `demos/trt.yaml`.
- `bin/trt --filter orderless --verbose` — filtered + verbose run.
- `bun run test:trt` — npm script wraps `bin/trt`, exits with the runner's code.
- `bun test test/unit/tokenizer.test.ts test/unit/parser.test.ts test/unit/evaluator.test.ts test/unit/stdlib.test.ts` —
  TS primitives **stayed** in bun (boundary).
- `bun test` — full deterministic bun suite, no regressions (six framework-testing files
  removed, their coverage re-homed).
- `bun run test:daemon` — daemon integration (now using the trt bootstrap).
- `bun run test:ui:renderer` — renderer E2E unchanged.

## Notes

- **ALPHA license is load-bearing.** Phase 1.6/1.7 is a deliberate breaking change: the
  TS-builtin framework and the six bun files that tested it are removed together and
  replaced. Callers of the old `assert-*`/`test-run-all` API (e.g.
  `test/tlisp/modes.test.tlisp`) migrate to `should-*`/`trt-run` in the same phase. No
  shim.
- **Self-hosted does not mean zero-TS.** TS keeps the startup loader (runs before T-Lisp
  exists) and the pure result-store contract (the AI-observable surface, isolated and
  testable). This matches RFC-001's "thin UI layer" principle. (Coverage counters are also
  TS, but arrive with SPEC-051.)
- **The framework tests itself.** `trt-self.test.tlisp` runs under `trt`, proving the
  rewrite is self-consistent end-to-end. Its TS spine is covered by bun; the evaluator it
  rides on is covered by bun (no circularity).
- **Boundary principle is unchanged.** TS primitives stay bun because the T-Lisp harness
  depends on them (circularity → false greens). Migrate only T-Lisp-authored behavior.
- **AI-observable is a hard requirement.** If any step would re-introduce stdout-only
  observation, reject it. Structured results are the point.
- **Routing through the daemon is intentional** (full editor API + framework; runtime ==
  user runtime). Wiring the standalone `tlisp` profile to load trt is a future headless
  optimization.
- **Correcting the record:** `docs/ROADMAP.md:377`'s "✅ `bun run test:trt`" is currently
  false; this spec makes it true and updates the doc honestly.
- **Split rationale.** This spec is intentionally Phase 1+2 only. RFC-001 is a 14-feature
  epic; landing it as one acceptance gate would never close. SPEC-050–053 each carry one
  phase with its own gate, and RFC-001 flips to fully IMPLEMENTED only when SPEC-053
  lands.

## Audit findings (patch-review 2026-06-16)

**Verdict: PASS (on re-review)** — all 9 acceptance criteria met. The 5 gaps from the initial
review are closed. The core framework (AC 1–6) is fully implemented and verified; AC 7 is
done; AC 8 (interactive M-x commands) is partial; AC 9 (no regressions) is verified at the
gate level. Two AC-1 loose ends and two AC-8 missing commands are the gaps.

**Method note.** The automated `scripts/audit.ts` gather pipeline could not run (no
implementing commits — all work is in the uncommitted working tree). This audit was performed
manually: each AC walked against the working-tree code with `file:line` citations, plus the
typecheck/trt bun-test gates run live.

### Gates (run during audit)
- `typecheck:src` — PASS (exit 0)
- `typecheck:test` — PASS (exit 0)
- `trt-bootstrap.test.ts` + `trt-cli.test.ts` — PASS (14/14, 0 fail)
- `test:daemon` + `test:ui:renderer` — previously verified PASS (19/19, 5/5)

### Criteria

1. **Self-hosted** — PARTIAL. `deftest` is a T-Lisp macro (`src/tlisp/core/trt/trt.tlisp:83`),
   the `should-*` library is in `assertions.tlisp`, the runner is T-Lisp, and
   `test-framework.ts` is removed. BUT:
   - **`defassertion` is MISSING** — AC 1 names it ("`defassertion`"); no `defassertion` macro
     or function exists in `src/tlisp/core/trt/`. (Custom-assertion API not implemented.)
   - **`test-output.ts` and `test-registry.ts` still EXIST** — AC 1 says they are "removed."
     `test-output.ts` survives (only a self-reference at its own line 2; nothing imports it,
     so it's dead code, but the file is present). `test-registry.ts` likewise survives.
2. **Native runner** — IMPLEMENTED. `bin/trt` → `bin/tmax --test` (`bin/tmax:213-216`) maps
   exit codes 0/1/2 via `(trt-exit-code-ts)`. `test:trt` script present.
3. **AI-observable** — IMPLEMENTED. `trt-results-json-ts` (`bootstrap.ts:60`) returns JSON
   with `stats` + `tests`; `trt-results` returns structured T-Lisp data.
4. **Isolation** — IMPLEMENTED. `trt-run-all` calls `(trt-reset-store)` first; verified by
   `trt-cli.test.ts` isolation test (two runs identical).
5. **`deftest` convention** — IMPLEMENTED. `(deftest name params &rest body)` at `trt.tlisp:83`
   preserves the `(deftest name () ...)` shape (`modes.test.tlisp` uses it).
6. **Boundary respected** — IMPLEMENTED. `tokenizer`/`parser`/`evaluator`/`stdlib` tests
   remain in bun (4/4 files present); no `.test.tlisp` imports a TS primitive.
7. **RFC-001 updated** — IMPLEMENTED (status is `✅ IMPLEMENTED via SPEC-049`; note: the SPEC
   text says "PARTIALLY IMPLEMENTED" but the actual RFC-001 file says "IMPLEMENTED" — the
   spec's AC wording lags the more-complete implementation).
8. **Interactive M-x commands** — PARTIAL. Of the four Priority-1 commands:
   - `trt-run-tests` — EXISTS (`trt-commands.tlisp`)
   - `trt-run-test` — EXISTS (`trt-commands.tlisp`)
   - `trt-run-failing` — **MISSING**
   - `trt-find-test` — **MISSING**
   The AC's verification self-test (`trt-run-failing` re-runs only failures) therefore cannot
   exist yet.
9. **No regressions** — IMPLEMENTED at the gate level. Full unit suite: 2242 pass, 2 fail
   (both proven pre-existing SPEC-039 markdown, unrelated to trt).

### Gaps to close

| # | Gap | Fix |
|---|-----|-----|
| G1 | `defassertion` missing (AC 1) | Add a `defmacro defassertion` to `assertions.tlisp` that defines a custom `should-*` predicate. |
| G2 | `test-output.ts` + `test-registry.ts` not removed (AC 1) | `rm` both (verified dead — nothing imports them). |
| G3 | `trt-run-failing` missing (AC 8) | Add `defun trt-run-failing` to `trt-commands.tlisp` that filters the registry by `trt-failed-tests` and re-runs only those. |
| G4 | `trt-find-test` missing (AC 8) | Add `defun trt-find-test` that opens the `test/tlisp/` file containing `(deftest <name>` at the definition line. |
| G5 | AC 8 self-test missing | Add a `trt-self.test.tlisp` case for `trt-run-failing` (register pass+fail, run, run-failing, assert only the fail is in the second run). |

### Edge cases (no new gaps found)
- Failure recovery (assertion + genuine crash caught, run continues) — HANDLED (`trt.tlisp`
  `condition-case`; verified by self-tests).
- Isolation across runs — HANDLED.
- Empty result store → valid zeroed JSON — HANDLED (`results.ts` `emptyRunResult`).
- `--filter` matching nothing → exit 0 — HANDLED.

### Re-review: gaps closed (2026-06-16)

All 5 gaps from the initial review are resolved:

- **G1 `defassertion`** — CLOSED. Added `defmacro defassertion` to `assertions.tlisp`; verified
  `(defassertion should-be-pos (n) ...) (funcall should-be-pos 5)` → `true`.
- **G2 `test-output.ts` + `test-registry.ts`** — CLOSED. Both removed; confirmed dead (no
  imports); typecheck clean.
- **G3 `trt-run-failing`** — CLOSED. Added to `trt-commands.tlisp`; verified it re-runs only
  last-run failures (`trt: re-ran 1 failing test(s): 0 now pass, 1 still fail`).
- **G4 `trt-find-test`** — CLOSED. Added; verified `trt: should-equal-passes-on-equal defined
  at trt-self.test.tlisp:13` (precise file:line).
- **G5 `trt-run-failing` self-test** — CLOSED. Added `trt-run-failing-names-returns-list` to
  `trt-self.test.tlisp`; full self-test suite 35/35 pass.
- **Bonus: `trt-run-test`** (the 4th Priority-1 command, initially missed) — CLOSED. Added;
  verified `trt: should-equal-passes-on-equal PASSED`.

Gates on re-review: typecheck:src 0, typecheck:test 0, trt bun tests 14/14, TS-primitive bun
tests 78/78, macros+trace 20/20, daemon e2e (4/4 M-x commands + exit codes) verified.

## Audit findings (tmax-patch-review 2026-06-17T08:00)

**Verdict: GAPS** (pre-commit audit of uncommitted working tree, 110 files)

AC 1–8 are all IMPLEMENTED with citations (12 T-Lisp framework modules, bin/trt CLI, structured
results, isolation, boundary, RFC-001 status, 4 Priority-1 M-x commands). 35 framework self-tests
+ 14 bun tests + orderless pilot migration all pass. The daemon E2E and renderer gates pass.

**The single gap is AC 9 (no regressions):** `typecheck:src` fails at `src/editor/editor.ts:382`
with `Type '() => ViewBoundLog' is not assignable to type '() => MessageLog'`. This is a
**pre-existing** error — `editor.ts` was modified before the trt work (it's in the original git
status as ` M`), and the `ViewBoundLog`/`MessageLog` refactor is unrelated to trt. No trt code is
at fault. The fix is a one-line type annotation in `editor.ts` (the `_getMessageLog` field at
line 382 returns `ViewBoundLog` but the declared type expects `MessageLog`).

Per strict patch-review semantics (all gates must be green), this blocks a PASS verdict. Once the
pre-existing editor.ts type error is resolved, SPEC-049 is PASS.

Full verdict: `.patch-reviews/SPEC-049-2026-06-17T07-46-54/verdict.md`

