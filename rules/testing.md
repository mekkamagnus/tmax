---
scope: test/**/*
---

# Testing Rules

Applies to all test files in `test/`.

## Authoritative Testing Matrix

Required validation has three explicit boundaries:

| Gate | What it proves | Command |
|------|----------------|---------|
| **Type safety** | Source, tests, and full project satisfy the TypeScript contracts | `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck` |
| **Bun behavior tests** | Deterministic unit and in-process integration behavior | `bun test`, `bun run test:unit` |
| **tmax-use e2e** | Real keys drive real editor behavior through playbooks | `bun run test:tmax-use` |

T-Lisp `deftest` coverage remains useful for extension behavior and may run
through the interpreter or Bun tests. It does not replace any required gate.

### Capture-Based Visual Testing

The daemon's `capture` RPC provides a fifth testing approach: server-side rendering without a terminal. Tests in `test/unit/daemon-capture-parity.test.ts` and `test/unit/render-visual.test.ts` exercise this.

- **ANSI capture** (`--capture`): Returns rendered lines with 24-bit color codes. Assert specific color sequences to verify syntax highlighting, or strip ANSI to assert text content.
- **HTML capture** (`--capture-html`): Returns a standalone HTML document with One Dark theme. Assert DOM structure, RGB colors, or save for visual review.
- **Standalone renderer** (`captureFrame()` in `src/render/capture-frame.ts`): Pure function that takes `EditorState` and returns `string[]`. Use in Bun tests without a running daemon.

When to use capture vs other gates:
- **Capture tests**: assert that specific colors reach rendered output, or that status line/layout is correct
- **tmax-use e2e**: assert actual terminal behavior (cursor, scroll, mode transitions, user-visible state)

### Boundary Rules

- tmax-use e2e tests must send real keys and inspect captured renderer / editor state.
- Query failures, unavailable assertions, skips, and expected failures must never be counted as passes.
- Await asynchronous editor startup and use fail-fast typed helpers instead of conditional assertions.
- Required gates must not weaken compiler settings, suppress errors, or ignore exit codes.

## Bun Test Rules

### Commands

```bash
# Run all deterministic TypeScript tests
bun test

# Run the required type-safety gates
bun run typecheck:src
bun run typecheck:test
bun run typecheck

# Run tmax-use e2e
bun run test:tmax-use

# Run specific test files
bun test test/unit/tokenizer.test.ts
bun test test/unit/parser.test.ts
bun test test/unit/evaluator.test.ts
bun test test/unit/editor.test.ts
```

### Syntax (Bun)

```typescript
import { describe, test, expect } from "bun:test";

// Use Bun test syntax:
// expect(x).toBe(y)         — not assertEquals(x, y)
// expect(fn).toThrow()      — not assertThrows(fn)
```

### Strategy

- **Test-Driven Development**: Create and run tests before code implementation
- Test all error paths, not just happy paths
- Use the project's functional types (Option, Either, Result) in tests
- Mock at boundaries only — prefer real implementations for core logic
- Tests must be isolated and repeatable
- Use clear, descriptive names for test files and test cases

## trt (T-Lisp Runtime Testing) Rules

**trt** is the native, self-hosted test framework (SPEC-049). The framework is authored **in
T-Lisp** (`src/tlisp/core/trt/*.tlisp`): `deftest` is a macro, assertions are the `should-*`
library, and the runner uses `condition-case` to catch failures and continue. TS holds only the
bootstrap loader (`src/tlisp/trt/bootstrap.ts`), the pure result store (`results.ts`), and
low-level coverage primitives.

### Boundary principle (what migrates, what does NOT)

**Hard rule: don't test a TS primitive in the language that depends on it.** A `.test.tlisp`
harness is parsed/evaluated by the TS tokenizer/parser/evaluator, so testing those in T-Lisp is
*circular* — a bug would corrupt the harness and mask the failure with false greens. TS primitives
(tokenizer, parser, evaluator, stdlib, macros, TCO, hashmap, quasiquote) **stay in bun**. Migrate
only **T-Lisp-authored behavior** (commands, modes, completion, hooks, editor-API-driven logic).

**Diagnostic:** if a bun test imports a TS primitive directly → stays bun. If it only drives
`interpreter.execute(...)` and re-asserts the T-Lisp result → migration candidate.

### Running trt tests

```bash
# Run the whole native suite (test/tlisp/*.test.tlisp), exit 0 pass / 1 fail / 2 no-tests
bun run test:trt
bin/trt
tmax --test

# JSON results (parseable by jq) — the AI-observable contract
bin/trt --json | jq '.stats'

# Single file
bin/trt test/tlisp/orderless.test.tlisp

# Via daemon eval (structured data, no stdout scraping)
tmax -e '(progn (trt-load-directory "test/tlisp/") (trt-run-all) (trt-results-json))'
```

### Writing trt tests

```lisp
;; test/tlisp/my-feature.test.tlisp
(deftest my-feature-works ()
  (should-equal 42 (my-function 41)))

(deftest my-feature-fails-gracefully ()
  (should-throw (lambda () (my-function -1))))
```

Assertions use the `should-*` family (RFC-001 / Emacs convention): `should-equal`,
`should-be-truthy`, `should-be-falsy`, `should-throw`, `should-contain-string`, `should-match`,
`should-have-length`, `should-be-greater-than`, `should-be-close-to`, `should-be-a`. A failing
assertion signals via `(error ...)`; the runner's `condition-case` catches it and records the test
as failed, then continues to the next test.

### trt feature set

Fixtures (`deftest` + `use-fixtures`), suites (`trt-register-suite` / `trt-run-suite`),
parametrized tests (`trt-parametrize`), async (`deftest-async` + `done`), snapshots
(`should-match-snapshot`), coverage (`trt-coverage-on` / `trt-coverage-report-string`),
mocking (`mock-fn` + `should-have-been-called*`), benchmarking (`trt-bench`). See
`test/tlisp/trt-self.test.tlisp` for examples of each.



```bash
# Via daemon (evaluate test file, then run)
tmax -e '(test-run-all)'

# Via REPL
bun run repl
> (deftest "my-test" () (assert-true t))
> (test-run-all)

# Via Bun test (see test/unit/test-tlisp-testing-framework.test.ts)
bun test test/unit/test-tlisp-testing-framework.test.ts
```

### Assertions

```
(assert-true value)                          — pass if truthy
(assert-false value)                         — pass if falsy
(assert-equal expected actual)               — pass if values equal
(assert-not-equal expected actual)           — pass if values differ
(assert-contains list item)                  — pass if item in list
(assert-contains-string haystack needle)     — pass if substring found
(assert-matches pattern string)              — pass if regex matches
(assert-type value type-symbol)              — pass if value is type (number, string, boolean, list, symbol, nil, hashmap, function, macro)
(assert->= value expected)                   — pass if value >= expected
(assert-< value expected)                    — pass if value < expected
(assert-in-delta actual tolerance expected)  — pass if |actual - expected| <= tolerance
(assert-eventually condition-fn timeout-ms)  — pass if condition becomes true
```

### Test Lifecycle

```
(deftest "test-name" () body...)       — define a test
(test-run "test-name")                 — run a single test
(test-run-all)                         — run all defined tests
(test-run-suite "suite-name")          — run tests in a suite
(list-suites)                          — list all registered suites
```

### Setup and Teardown

```
(setup () body...)                     — run before each test
(teardown () body...)                  — run after each test
```

### Fixtures

```
(deffixture "fixture-name"
  :setup ((...))
  :teardown ((...))
  :scope each|once|all)

(use-fixtures fixture1 fixture2 ...)   — apply fixtures to current test
```

Fixture scopes:
- `each` — setup/teardown for every test
- `once` — setup runs once, teardown after all tests
- `all` — same as `once`

### Suites

Tests can be grouped into suites via `defsuite` (special form in evaluator). Run with `test-run-suite`.

### Coverage

```
(coverage-enable true|false)           — enable/disable coverage tracking
(coverage-percentage)                  — get coverage percentage
(coverage-report)                      — get detailed coverage report
(coverage-print)                       — print coverage report to console
(coverage-reset)                       — clear coverage data
(coverage-enabled)                     — check if coverage is enabled
(coverage-tested)                      — list covered functions
(coverage-untested)                    — list uncovered functions
(coverage-meets-threshold)             — check if coverage >= threshold
(coverage-threshold N)                 — set minimum coverage (0-100)
(coverage-format "text"|"json")        — set report format
```

### Output Configuration

```
(set-output-mode "normal"|"verbose"|"quiet"|"plain")  — control output verbosity
(set-verbosity "normal"|"verbose"|"quiet")             — alias for set-output-mode
(set-color-mode "auto"|"always"|"never")               — control color output
(set-progress-indicator true|false)                     — show/hide progress bar
```

### Async Testing

```
(set-async-timeout ms)                 — set default async timeout (default 2000ms)
(async-all)                            — run all async tests
(done)                                 — signal async test completion
```

## Mock Filesystem

Tests that create an `Editor` must provide binding files in the mock filesystem. The editor loads `src/tlisp/core/bindings/{normal,insert,visual,command}.tlisp` at startup. Without them, it falls back to minimal bindings and tests get inconsistent behavior.

**Always include real binding files** in mock filesystems — either serve the actual files from disk or provide complete stubs.
