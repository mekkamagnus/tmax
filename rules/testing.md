---
scope: test/**/*
---

# Testing Rules

Applies to all test files in `test/`.

## Authoritative Testing Matrix

Required validation has four explicit boundaries:

| Gate | What it proves | Command |
|------|----------------|---------|
| **Type safety** | Source, tests, and full project satisfy the TypeScript contracts | `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck` |
| **Bun behavior tests** | Deterministic unit and in-process integration behavior | `bun test` |
| **Daemon integration** | JSON-RPC, T-Lisp commands, and editor state without renderer claims | `bun run test:daemon` |
| **Renderer E2E** | Real terminal keys produce the expected visible TUI output | `bun run test:ui:renderer` |

`bun run test:ui` runs both Python suite categories. `bun run test:ui:helpers`
checks the harness itself. The Bash harness is deprecated and is never an
authoritative validation command.

T-Lisp `deftest` coverage remains useful for extension behavior and may run
through the interpreter or Bun tests. It does not replace any required gate.

### Capture-Based Visual Testing

The daemon's `capture` RPC provides a fifth testing approach: server-side rendering without a terminal. Tests in `test/unit/daemon-capture-parity.test.ts` and `test/unit/render-visual.test.ts` exercise this.

- **ANSI capture** (`--capture`): Returns rendered lines with 24-bit color codes. Assert specific color sequences to verify syntax highlighting, or strip ANSI to assert text content.
- **HTML capture** (`--capture-html`): Returns a standalone HTML document with One Dark theme. Assert DOM structure, RGB colors, or save for visual review.
- **Standalone renderer** (`captureFrame()` in `src/render/capture-frame.ts`): Pure function that takes `EditorState` and returns `string[]`. Use in Bun tests without a running daemon.

When to use capture vs other gates:
- **Capture tests**: assert that specific colors reach rendered output, or that status line/layout is correct
- **Daemon integration**: assert editor state, T-Lisp evaluation, buffer content — without visual claims
- **Renderer E2E** (`daemon-tmux`): assert actual terminal behavior (cursor, scroll, resize)

### Boundary Rules

- Daemon tests may use direct T-Lisp evaluation, but must not claim renderer verification.
- Renderer tests must send real keys and inspect captured renderer output.
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

# Run Python integration and renderer suites
bun run test:daemon
bun run test:ui:renderer
bun run test:ui

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

## T-Lisp Test Rules

The T-Lisp testing framework is implemented in `src/tlisp/test-framework.ts` and registered automatically when the interpreter starts. Tests can be run from the REPL, from Bun tests, or via the daemon.

### Running T-Lisp Tests

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
