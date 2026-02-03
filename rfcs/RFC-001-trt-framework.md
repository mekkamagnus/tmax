# RFC-001: TRT (Tmax Regression Testing) Framework

**Status:** 📋 PROPOSED
**Created:** 2025-02-03
**Author:** TRT Design Team
**Phase:** 0.5 - Testing Infrastructure Enhancement

## Table of Contents
- [Abstract](#abstract)
- [Motivation](#motivation)
- [Proposed Solution](#proposed-solution)
- [Detailed Design](#detailed-design)
- [Alternatives Considered](#alternatives-considered)
- [Implementation Plan](#implementation-plan)
- [References](#references)

---

## Abstract

This RFC proposes **TRT (Tmax Regression Testing)**, a self-hosted T-Lisp testing framework inspired by Emacs ERT but enhanced with modern testing framework capabilities from Vitest, Bun Test, Jest, and Python pytest. The framework provides comprehensive testing infrastructure including fixtures, rich assertions, test discovery, isolation, and a dual-mode interface (CLI and buffer-based).

**Key Benefits:**
- ✅ Self-hosted in T-Lisp (follows Lisp-first architecture)
- ✅ Modern testing UX (learned from Vitest, Bun, Jest, pytest)
- ✅ Comprehensive test isolation (avoids ERT's shared state problems)
- ✅ Dual-mode interface (CLI automation + editor integration)
- ✅ Developer-friendly workflow (watch mode, TDD support)

---

## Motivation

### Problems with Emacs ERT

1. **Minimal Fixture System**: No built-in setup/teardown, requires manual boilerplate
2. **Basic Assertions**: Limited assertion helpers, poor error messages
3. **Manual Test Discovery**: Tests must be explicitly registered and loaded
4. **Poor Test Isolation**: Tests share global environment, causing flaky tests
5. **Limited UI**: Plain buffer output, no hierarchical organization
6. **No Parametrized Tests**: Can't run same test with multiple inputs
7. **Missing Modern Features**: No watch mode, snapshot testing, coverage integration

### Why Not Use Existing Test Runners?

- **JavaScript test runners (Jest, Vitest, Bun)**: Can't test T-Lisp code directly
- **Emacs ERT**: Tied to Emacs, not portable to tmax, lacks modern features
- **Custom solution**: Needed for T-Lisp's unique architecture

### Design Philosophy

Following tmax's **Lisp-first architecture**:
- **T-Lisp handles everything**: Tests are T-Lisp code, run through T-Lisp interpreter
- **TypeScript is thin UI layer**: Terminal I/O, file system, integration hooks
- **Single binary**: No separate test runner binary (unlike standalone CLI tools)
- **Editor-integrated**: Tests run from within tmax OR via CLI flag (`tmax --test`)

---

## Proposed Solution

### TRT Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TRT Framework                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐                    │
│  │ CLI Mode     │      │ Buffer Mode  │                    │
│  │ tmax --test  │      │ (run-tests)  │                    │
│  └──────┬───────┘      └──────┬───────┘                    │
│         │                     │                             │
│         └──────────┬──────────┘                             │
│                    ▼                                        │
│         ┌────────────────────┐                             │
│         │ TRT Core Engine    │                             │
│         │ (T-Lisp)           │                             │
│         └────────────────────┘                             │
│                    │                                        │
│         ┌──────────▼──────────┐                            │
│         │ Test Discovery      │                            │
│         │ Isolation           │                            │
│         │ Execution           │                            │
│         │ Reporting           │                            │
│         └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

### Dual-Mode Interface

**Mode 1: CLI Output** (`tmax --test`)
- Console-friendly with ANSI colors
- Real-time progress updates
- Exit codes for CI/CD
- Compact and verbose modes

**Mode 2: Buffer Output** (inside tmax)
- Interactive Test Explorer
- Hierarchical tree view
- Click to jump to source
- Real-time status updates

---

## Detailed Design

### Improvement #1: Built-in Fixtures System

**Inspiration:** pytest fixtures (setup/teardown, scope, dependency injection)

**Concept:** Reusable setup/teardown logic with automatic cleanup and dependency injection.

```lisp
;; Define fixture
(deffixture test-buffer
  "Create a fresh buffer for testing"
  (let ((buf (buffer-create (generate-test-name))))
    (prog1 buf
      (buffer-kill buf))))  ;; Auto-cleanup

;; Use fixture
(deftest test-insert-text
  :fixtures (test-buffer)
  (buffer-insert test-buffer "hello")
  (should-equal "hello" (buffer-text test-buffer)))
```

**Fixture Scopes:**
- `:function` - Reset per test (default)
- `:suite` - Shared across test suite
- `:file` - Shared across tests in file
- `:global` - Shared across all tests

**Key Features:**
- ✅ Automatic cleanup (even if test fails)
- ✅ Fixture dependencies (fixtures can use other fixtures)
- ✅ Setup/teardown hooks
- ✅ Parameterized fixtures

---

### Improvement #2: Rich Assertion Library

**Inspiration:** Jest expectations, chai assertions, pytest assertions

**Concept:** Pre-built assertion helpers with helpful error messages.

```lisp
;; Basic assertions
(should-equal expected actual)
(should-be-truthy value)
(should-be-falsy value)
(should-throw exception-type body)

;; String assertions
(should-contain "substring" "full string")
(should-match "^regex$" "text")

;; Numeric assertions
(should-be-greater-than 5 3)
(should-be-close-to 3.14159 3.14 0.01)

;; Collection assertions
(should-contain 2 '(1 2 3))
(should-have-length '(1 2 3) 3)

;; Custom assertions
(defassertion should-be-valid-buffer
  (lambda (buf)
    (and (buffer-p buf)
         (buffer-live-p buf))))
```

**Error Messages:**
```
✗ test-eval-arithmetic
  Expected: 3
  Got: 5

  at eval (evaluator.tlisp:123)
  at test-eval-arithmetic (evaluator.test.tlisp:42)
```

---

### Improvement #3: Test Discovery & Organization

**Inspiration:** Jest pattern matching, pytest discovery

**Concept:** Automatic test file discovery with naming conventions.

**Directory Structure:**
```
src/tlisp/tests/
├── core/
│   ├── tokenizer.test.tlisp
│   ├── parser.test.tlisp
│   └── evaluator.test.tlisp
├── stdlib/
│   ├── strings.test.tlisp
│   └── lists.test.tlisp
└── editor/
    ├── buffer.test.tlisp
    └── commands.test.tlisp
```

**Naming Convention:** `*.test.tlisp` suffix for auto-discovery

**CLI Commands:**
```bash
tmax --test                       # Run all tests
tmax --test core/                 # Run specific directory
tmax --test --filter "tokenizer"  # Run matching tests
tmax --test --watch               # Watch mode
```

**T-Lisp API:**
```lisp
(run-tests)               ;; Run all tests
(run-tests "core/")       ;; Run directory
(run-tests-file "test.tlisp")  ;; Run specific file
```

---

### Improvement #4: Test Explorer UI

**Inspiration:** VS Code Test Explorer, PyCharm test runner, Jest watch mode

**Concept:** Interactive buffer-based test explorer with real-time updates.

**Buffer Layout:**
```
┌─ *Test Explorer* ────────────────────────────────┐
│ [R]un All [r]un Selected [f]ilter [q]uit        │
│                                                   │
│ ▼ core/ (12/15 passed) .......................... │
│   ✓ tokenizer.test.tlisp (5/5)                    │
│   ✓ parser.test.tlisp (4/4)                       │
│   ✗ evaluator.test.tlisp (3/6)                     │
│     ✗ test-eval-arithmetic                        │
│       Expected: 5, Got: 3                         │
│                                                   │
│ ▼ stdlib/ (8/8 passed) .......................... │
│   ✓ strings.test.tlisp (4/4)                      │
│                                                   │
│ Progress: 25/33 tests (75.8%) | 8 failed          │
└───────────────────────────────────────────────────┘
```

**Keybindings:**
- `R` - Run all tests
- `r` - Run selected test
- `RET` - Jump to test definition
- `TAB` - Expand/collapse suite
- `f` - Filter by status
- `q` - Close explorer

**CLI Output:**
```bash
$ tmax --test

Running TRT Tests...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 ✓ core/tokenizer.test.tlisp ............ 5/5 passed
 ✗ core/evaluator.test.tlisp ............ 3/6 passed
   ✗ test-eval-arithmetic (evaluator.test.tlisp:42)
     Expected: 5, Got: 3

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Progress: [████████████░░░░░░░░] 60% (20/33 tests)
Status: 16 passed, 4 failed, 13 remaining
```

---

### Improvement #5: Better Test Isolation

**Inspiration:** Vitest per-file workers, Python pytest isolation

**Problem:** ERT shares global environment between tests → flaky tests

**Solution:** Four-layer isolation strategy

**Layer 1: Environment Isolation**
```lisp
;; Each test has isolated child environment
(deftest my-test
  (let ((x 1))  ;; Doesn't affect other tests
    (should-equal 1 x)))
```

**Layer 2: Buffer State Isolation**
```lisp
;; Auto-cleanup with with-test-buffer macro
(deftest buffer-test
  (with-test-buffer (buf "content")
    (buffer-insert buf " more")
    (should-equal "content more" (buffer-text buf))))
;; buf automatically killed
```

**Layer 3: Global State Reset**
```lisp
;; Hooks run before/after each test
(setup-hook (lambda ()
              (buffers-clear)
              (key-bindings-reset)))

(teardown-hook (lambda ()
                 (buffers-clear)))
```

**Layer 4: Flaky Test Detection**
```lisp
;; Run test multiple times to detect non-determinism
(deftest test-race-condition
  :runs 10
  (async-operation))

;; Output: ✗ test-race-condition (flaky) - 7/10 passes
```

**Learned from Bun Test mistakes:**
- ❌ Don't share module registry across tests (causes mock leaking)
- ✅ Isolate environments per test (slower but reliable)
- ✅ Provide opt-out for trusted tests (`--no-isolate`)

---

### Improvement #6: Parametrized Tests

**Inspiration:** pytest `@pytest.mark.parametrize`, Vitest `test.each()`

**Problem:** ERT doesn't support running the same test with multiple inputs → code duplication, edge cases hard to test systematically

**Solution:** Table-driven parametrized tests with clean syntax

**Syntax:**
```lisp
;; Table-driven (recommended)
(deftest-parametrized string-length
  :cases '((("hello" . 5)
            ("world" . 5)
            ("" . 0)
            ("testing" . 7)))
  (lambda (input expected)
    (should-equal expected (length input))))

;; Output:
;; ✓ string-length [case 1/4]: "hello" → 5
;; ✓ string-length [case 2/4]: "world" → 5
;; ✓ string-length [case 3/4]: "" → 0
;; ✓ string-length [case 4/4]: "testing" → 7
```

**Advanced Features:**
- **Per-case setup/teardown**: `:setup` and `:teardown` hooks
- **Case descriptions**: Custom names for better debugging
- **Case filtering**: Run specific cases via `--filter` or `:case` parameter
- **Test Explorer integration**: Expandable case groups

**CLI Output:**
```bash
✓ test-string-length [4/4 cases passed]
  ✓ case 1: "hello" → 5
  ✓ case 2: "world" → 5
  ✓ case 3: "" → 0
  ✓ case 4: "testing" → 7
```

**Implementation:** Medium complexity, macro expansion to individual tests

---

### Improvement #7: Test Suites & Grouping

**Inspiration:** Jest `describe()`, pytest classes, Vitest test grouping

**Problem:** ERT has flat test structure, no hierarchical organization

**Solution:** Nested test suites with lifecycle hooks

**Syntax:**
```lisp
(describe-suite "Buffer Operations"
  :before-all (lambda ()
                (init-test-buffer))
  :after-all (lambda ()
               (cleanup-test-buffer))
  :before-each (lambda ()
                 (clear-buffer))
  :after-each (lambda ()
                (save-buffer))

  (describe-suite "Insert"
    (deftest test-insert-basic
      (buffer-insert "hello")
      (should-equal "hello" (buffer-text)))

    (deftest test-insert-newline
      (buffer-insert "hello\nworld")
      (should-equal 2 (buffer-line-count))))

  (describe-suite "Delete"
    (deftest test-delete-character
      (buffer-insert "hello")
      (buffer-delete 1)
      (should-equal "ello" (buffer-text)))))
```

**Key Features:**
- **Nested suites**: Hierarchical organization (unlimited depth)
- **Suite hooks**: `:before-all`, `:after-all`, `:before-each`, `:after-each`
- **Selective execution**: Run specific suites (`tmax --test --suite "Insert"`)
- **Skip/only**: `:skip t` or `:only t` on suites or tests
- **Suite-scoped fixtures**: Share expensive setup across test groups

**Hook Execution Order:**
```
Outer (before-all)
  ├─ Inner (before-all)
  │   ├─ test (before-each → test → after-each)
  │   └─ Inner (after-all)
  └─ Outer (after-all)
```

**CLI Output:**
```bash
✓ Buffer Operations
  ✓ Insert [2/2 passed]
    ✓ test-insert-basic
    ✓ test-insert-newline
  ✓ Delete [1/1 passed]
    ✓ test-delete-character
```

**Implementation:** Medium complexity, macro expansion with hook management

---

### Improvement #8: Async Testing Support

**Inspiration:** Vitest async testing, Jest fake timers

**Problem:** ERT can't test async operations (file I/O, timers), no timeout protection

**Solution:** Async test support with fake timers and timeout detection

**Async Test Syntax:**
```lisp
;; Mark test as async
(deftest-async test-read-file
  (should-await-equal "Hello"
    (file-read-async "hello.txt")))

;; Async with timeout protection
(deftest-async test-slow-operation
  :timeout 5000  ;; 5 second max
  (slow-async-operation))
```

**Fake Timers:**
```lisp
;; Test timer-based code without real delays
(deftest test-debounce-function
  (with-fake-timers
    (let ((called nil))
      (debounce 1000 (lambda () (setq called t)))

      (advance-timers 500)
      (should-be-falsy called)

      (advance-timers 500)
      (should-be-truthy called))))
```

**Key Features:**
- **Async assertions**: `should-await-equal`, `should-await-throw`
- **Timeout detection**: Automatic fail if test exceeds timeout
- **Fake timers**: Fast, deterministic tests (no real delays)
- **Async fixtures**: Setup/teardown async resources
- **Error handling**: Proper detection of rejected promises/tasks

**Avoid Bun's Mistakes:**
- ❌ Don't use sync `expect` (Bun #4909)
- ❌ Don't forget to await tests (Bun #19660)
- ✅ Always await async tests
- ✅ Support `.rejects` style assertions

**Implementation:** High complexity, new Phase 0.5.5 (3-4 days)

---

### Improvement #9: Snapshot Testing

**Inspiration:** Jest snapshot testing, Vitest snapshots

**Problem:** ERT can't detect unintended output changes, manual comparison only

**Solution:** Capture output as snapshots, compare on subsequent runs

**External Snapshots:**
```lisp
;; parser.test.tlisp
(deftest test-simple-addition
  (let ((ast (parse "(+ 1 2)")))
    (should-match-snapshot ast)))

;; parser.test.snap (auto-generated)
;; Snapshot: test-simple-addition
;; Generated: 2025-02-03 14:23:01
(+ 1 2)
=> (+ 1 2)
   :type "binary-op"
   :operator "+"
   :left (:number 1)
   :right (:number 2))
```

**Inline Snapshots:**
```lisp
(deftest test-buffer-state
  (let ((buf (buffer-create "test")))
    (buffer-insert buf "hello world")
    (should-match-inline-snapshot buf
      #s(buffer
         :name "test"
         :content "hello world"
         :cursor 11))))
```

**Interactive Update Workflow:**
```bash
$ tmax --test --update-snapshots

✗ test-simple-addition
  Snapshot mismatch!

  Expected: :type "unary-op"
  Received: :type "binary-op"

  [U]pdate snapshot  [K]eep old  [D]iff  [S]kip  [A]ll  [Q]uit
```

**Key Features:**
- **Two modes**: External `.snap` files and inline snapshots
- **Interactive updates**: Review changes before accepting
- **Diff visualization**: Side-by-side and unified diffs
- **Custom formatters**: Define snapshot format for complex types
- **CI/CD integration**: Non-interactive mode, fail on mismatch
- **Best practices**: Descriptive names, granular snapshots, review changes

**Avoid Vitest Edge Cases:**
- ✅ Robust file format (comments don't break)
- ✅ Sequential updates (no race conditions [#5058](https://github.com/vitest-dev/vitest/issues/5058))
- ✅ Clear naming (avoid ambiguity [#7450](https://github.com/vitest-dev/vitest/issues/7450))

**Implementation:** Medium complexity, added to Phase 0.5.4

---

### Improvement #10: Coverage Reporting

**Inspiration:** Vitest coverage (V8/Istanbul), Bun native coverage

**Problem:** ERT has no coverage reporting, can't measure test completeness

**Solution:** Track T-Lisp evaluation during tests, generate coverage reports

**Coverage Types:**
- **Line Coverage**: Which lines executed
- **Branch Coverage**: Which branches taken (if/cond)
- **Function Coverage**: Which functions called

**Report Formats:**
```bash
# CLI text output
$ tmax --test --coverage

File                           | Lines  | Branch | Func
───────────────────────────────────────────────────────
src/tlisp/tokenizer.tlisp      |  94.2% |  88.5% |  100%
src/editor/buffer.tlisp        |  45.8% |  32.1% |   56%  ⚠️
───────────────────────────────────────────────────────
Total                          |  76.5% |  68.7% |   83%

# HTML report
$ tmax --test --coverage --format=html
Coverage report: coverage/index.html

# JSON/lcov for CI/CD
$ tmax --test --coverage --format=lcov
```

**Thresholds:**
```lisp
;; trt-config.tlisp
(setq trt-coverage-thresholds
      '(:lines 80
        :branches 75
        :functions 85))

;; Enforce threshold
$ tmax --test --coverage --threshold=80
✗ buffer.tlisp: 45.8% (below 80% threshold)
Coverage threshold not met
[Exit code: 1]
```

**Exclude Code:**
```lisp
;; Inline comments
;; trt-coverage-exclude-next
(defun debug-function ...)

;; File-level
;; trt-coverage-exempt: t

;; Patterns
(setq trt-coverage-exclude-patterns
      '("*/test/*.tlisp" "*/debug/*.tlisp"))
```

**Key Features:**
- **Multiple metrics**: Line, branch, function coverage
- **Multiple formats**: Text, HTML, JSON, lcov
- **Threshold enforcement**: Fail if coverage below target
- **Exclusion patterns**: Don't cover test/debug code
- **Trend tracking**: Coverage improvements over time
- **CI/CD integration**: lcov format for Codecov/Coveralls

**Implementation:** High complexity, new Phase 0.5.6 (4-5 days)

---

### Improvement #11: Examples as Tests (Moldable Emacs)

**Inspiration:** Python doctest, Moldable Emacs, doctest.el

**Problem:** Documentation examples may not work, drift from implementation

**Solution:** Examples serve triple purpose - Documentation, Tests, Demos

**Docstring Examples:**
```lisp
(defun string-split (str separator)
  "Split STRING into list using SEPARATOR.

Examples:
  (string-split \"hello world\" \" \")
  => (\"hello\" \"world\")

  (string-split \"a,b,c\" \",\")
  => (\"a\" \"b\" \"c\")"
  ;; Implementation...
  )
```

**External Documentation:**
```markdown
<!-- docs/buffer-operations.md -->

## Creating Buffers

\```tlisp
(buffer-create "my-buffer")
=> #s(buffer :name "my-buffer" :content "" :cursor 0)
\```
```

**Test Documentation Examples:**
```bash
$ tmax --test --docstring-examples

✓ strings.tlisp: string-split [3/3 examples passed]
✓ lists.tlisp: list-append [3/3 examples passed]
✗ buffer.tlisp: buffer-insert [1/2 examples passed]
  Example 2 failed:
    Expected: "(buffer-with-newline)"
    Got: "(error-invalid-argument)"

Results: 8/9 examples passed (88.9%)
```

**Interactive Example Explorer:**
```lisp
M-x ttest-browse-examples

┌─ *Example Explorer* ─────────────────────────────┐
│ [R]un [N]ext [P]rev [F]ilter [q]uit             │
│                                                    ││ ▶ string-split [3 examples]                     │
│   Example 1: (string-split "hello world" " ")    │
│   Example 2: (string-split "a,b,c" ",")          │
│   Example 3: (string-split "no-separator" ";")   │
└────────────────────────────────────────────────────┘
```

**Key Features:**
- **Triple purpose**: Docs, tests, and demos from same examples
- **Docstring examples**: Test examples in function documentation
- **External docs**: Extract examples from markdown/org files
- **Example metadata**: Tags, guards, setup/teardown
- **Example coverage**: Track which functions have examples
- **Auto-generate docs**: Create API documentation from examples

**Implementation:** Medium complexity, added to Phase 0.5.4

---

### Improvement #12: Watch Mode & TDD Workflow

**Inspiration:** Vitest watch mode, Jest watch plugins

**Problem:** ERT has no watch mode, must manually re-run tests, slow feedback loop

**Solution:** Monitor file changes, auto-run affected tests, enable TDD workflow

**Basic Watch Mode:**
```bash
$ tmax --test --watch

TRT Watch Mode
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Watching for file changes...
Press [q] to quit, [h] for help

✓ All tests passed (25/25)
Waiting for changes...

# File change detected
File changed: src/tlisp/evaluator.tlisp
Running affected tests...
✓ evaluator.test.tlisp [8/8] ✓ parser.test.tlisp [4/4]
Waiting for changes...
```

**Interactive Watch Menu:**
```bash
Watch Usage
› Press
  a   Run all tests
  f   Run only failed tests
  p   Pattern mode (filter by regex)
  t   Test name pattern mode
  q   Quit watch mode
  ENTER   Run tests related to changed files
  ?     Show help
```

**TDD Workflow Mode:**
```bash
$ tmax --test --tdd

TDD Workflow: Red → Green → Refactor
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] Write test → [2] Run test → [3] Implement → [4] Refactor

# Phase 1: Write failing test (RED)
(deftest test-string-trim
  (should-equal "hello" (string-trim "  hello  ")))

# Phase 2: Run test (still RED)
✗ test-string-trim
  Error: undefined-function string-trim

# Phase 3: Implement (GREEN)
(defun string-trim (str) ...)

# Phase 4: Verify
✓ test-string-trim
Status: GREEN
```

**Key Features:**
- **Smart test selection**: Only run affected tests (dependency graph)
- **TDD workflow**: Red-Green-Refactor cycle with phase tracking
- **Interactive control**: Run all/failed/patterns from watch mode
- **Debouncing**: Wait 100ms after last change (avoid excessive re-runs)
- **Fast feedback**: Affected tests first, then full suite
- **Watch plugins**: Custom commands (coverage, verbose, etc.)
- **Status line integration**: Show TDD phase and test count

**Implementation:** Medium-high complexity, new Phase 0.5.7 (3-4 days)

---

### Improvement #13: Mocking & Spying

**Inspiration:** Vitest vi.spyOn, Jest spyOn, Jest mock functions

**Problem:** ERT has no mocking, can't verify function calls or test side effects

**Solution:** Spying (preferred) and mocking with verification APIs

**Spying on Functions:**
```lisp
(deftest test-buffer-save
  (spy-on 'buffer-write-file)

  (buffer-save buf)

  ;; Verify calls
  (should-have-been-called 'buffer-write-file)
  (should-have-been-called-with 'buffer-write-file '("test" "content"))
  (should-have-been-called-times 'buffer-write-file 1))
```

**Mock Functions:**
```lisp
;; Create mock with implementation
(deftest test-with-mock
  (let ((mock-fn (mock-fn "file-read"
                  :return-values '("content1" "content2"))))
    (should-equal "content1" (funcall mock-fn "file1.txt"))
    (should-equal "content2" (funcall mock-fn "file2.txt"))))
```

**Module Mocking:**
```lisp
;; Mock module (runtime evaluation, no hoisting issues)
(deftest test-with-module-mock
  (mock-module 'filesystem
    :mocks '((file-read . (lambda (path) "mock-content"))))

  (load-config "config.tlisp")
  (should-equal "mock-content" (file-read "any-path")))
```

**Verification Matchers:**
```lisp
(should-have-been-called 'function-name)
(should-have-been-called-times 'function-name 3)
(should-have-been-called-with 'function-name '("arg1" "arg2"))
(should-have-been-called-before 'func-a 'func-b)
(should-have-been-called-with-matching 'process-data
  (lambda (args) (> (length args) 1)))
```

**Key Features:**
- **Prefer spying**: Observe real behavior (less brittle)
- **Mock when necessary**: External deps, side effects
- **Auto-cleanup**: Spies reset between tests
- **Module mocking**: Runtime evaluation (avoid Vitest's hoisting issues)
- **Call tracking**: Arguments, return values, call order
- **Verification APIs**: called-with, called-times, called-before/after
- **Advanced matchers**: Pattern matching, partial args, predicates

**Avoid Vitest's Mistakes:**
- ✅ Use runtime evaluation (no hoisting like vi.mock)
- ✅ spyOn preferred over mock (less surprising)
- ✅ Clear separation: spy observes, mock replaces

**Implementation:** High complexity, new Phase 0.5.8 (4-5 days)

---

### Improvement #14: Benchmarking Integration

**Inspiration:** Vitest bench (Tinybench), Jest performance testing

**Problem:** ERT has no benchmarking, can't detect performance regressions

**Solution:** Performance benchmarks alongside tests with regression detection

**Basic Benchmark:**
```lisp
(deftest-bench bench-string-length
  (bench (lambda ()
            (string-length (make-string 1000000 ?x))))

;; Output:
;; bench-string-length:
;;   1,234,567 ops/sec ± 2.3% (95% confidence)
```

**Performance Regression Detection:**
```bash
$ tmax --test --benchmark

✓ bench-string-length
  Current: 1,234,567 ops/sec ± 2.3%
  Baseline: 1,250,000 ops/sec
  Status: ✓ Within threshold (1.2% slower)

✗ bench-string-trim
  Current: 23,456 ops/sec ± 3.1%
  Baseline: 45,678 ops/sec
  Status: ✗ REGRESSION (48.6% slower, exceeds 10% threshold)
```

**Comparison Benchmarks:**
```lisp
(deftest-bench bench-string-operations-comparison
  (bench "old-implementation"
    (lambda ()
      (old-string-trim (make-string 10000 ?x) ?x)))

  (bench "new-implementation"
    (lambda ()
      (new-string-trim (make-string 10000 ?x) ?x))))

;; Output:
;;   old-implementation: 45,678 ops/sec ± 3.2%
;;   new-implementation: 123,456 ops/sec ± 2.1%
;;   Speedup: 2.70x faster
```

**Key Features:**
- **Native bench function**: Lightweight without Vite/JSDOM overhead
- **Baseline tracking**: Save and compare performance over time
- **Regression detection**: Automatic fail if slower than threshold
- **Comparison benchmarks**: Compare multiple implementations
- **Memory profiling**: Track memory usage during benchmarks
- **Trend tracking**: Performance history over commits
- **Benchmark suites**: Organize with describe-bench
- **Multiple formats**: Text, JSON, summary reports

**Implementation:** Medium complexity, new Phase 0.5.9 (3-4 days)

---

## Feature Prioritization

The TRT framework is organized into three priority levels to enable iterative development:

### 🚨 MUST HAVE (MVP - Phase 0.5)

**Timeline:** 8 days
**Goal:** Functional test framework for basic testing needs

#### Phase 0.5.1: Core Framework MVP [CRITICAL]
**Duration:** 4 days

- [ ] `deftest` macro - Define tests
- [ ] `should-equal` assertion - Basic equality check
- [ ] Test runner CLI - `tmax --test` entry point
- [ ] Test discovery - Find `*.test.tlisp` files automatically
- [ ] Basic CLI output - Pass/fail results with test names
- [ ] Exit codes - CI/CD integration (0=success, 1=failure)

#### Phase 0.5.2: Essential Assertions [CRITICAL]
**Duration:** 2 days

- [ ] Core assertions (4 total)
  - [ ] `should-equal` - Compare values
  - [ ] `should-be-truthy` - Truthy check
  - [ ] `should-be-falsy` - Falsy check
  - [ ] `should-throw` - Error thrown check
- [ ] Error message formatting - Clear failure messages

#### Phase 0.5.3: Basic Isolation [CRITICAL]
**Duration:** 2 days

- [ ] Environment reset between tests
- [ ] Global state cleanup (clear buffers, reset variables)
- [ ] Simple before/after hooks - Setup and teardown

**MVP Deliverables:**
- ✅ Can define and run tests
- ✅ Test discovery works automatically
- ✅ Basic assertions pass/fail
- ✅ Tests isolated (no state leakage)
- ✅ CI/CD integration ready

---

### ⭐ SHOULD HAVE (Phase 0.6 - Critical for Production)

**Timeline:** +10 days (18 days total)
**Goal:** Professional-grade testing framework

#### Phase 0.6.1: Rich Assertions [IMPORTANT]
**Duration:** 3 days

- [ ] String assertions (5+ assertions)
  - [ ] `should-contain` - Substring check
  - [ ] `should-match` - Regex match
  - [ ] `should-be-empty-string` - Empty check
- [ ] Collection assertions (4+ assertions)
  - [ ] `should-have-length` - Length check
  - [ ] `should-contain` - Element in collection
  - [ ] `should-be-empty` - Empty collection
- [ ] Numeric assertions (4+ assertions)
  - [ ] `should-be-greater-than`
  - [ ] `should-be-less-than`
  - [ ] `should-be-close-to` - Approximate equality
- [ ] Custom assertion API - `defassertion`

#### Phase 0.6.2: Fixtures System [IMPORTANT]
**Duration:** 3 days

- [ ] `deffixture` macro - Define reusable fixtures
- [ ] `with-fixture` macro - Use fixture in test
- [ ] Fixture scopes - `:function`, `:suite`
- [ ] Auto-cleanup - Even if test fails
- [ ] Fixture dependencies - Fixtures using other fixtures

#### Phase 0.6.3: Test Suites [IMPORTANT]
**Duration:** 2 days

- [ ] `describe-suite` macro - Group related tests
- [ ] Nested test organization - Hierarchical structure
- [ ] Suite-level hooks - `:before-all`, `:after-all`
- [ ] Per-suite filtering - Run specific suites

#### Phase 0.6.4: Async Testing [IMPORTANT]
**Duration:** 4 days

- [ ] `deftest-async` macro - Async test support
- [ ] Async assertions (2 assertions)
  - [ ] `should-await-equal` - Await and compare
  - [ ] `should-await-throw` - Await error check
- [ ] Timeout protection - Fail if too slow
- [ ] Async error handling - Proper rejection detection

#### Phase 0.6.5: Better CLI Output [IMPORTANT]
**Duration:** 2 days

- [ ] Progress indicators - Show test progress
- [ ] ANSI colored output - Visual clarity
- [ ] Test summary statistics - Count and percentage
- [ ] Per-file results - Organized output
- [ ] Verbose mode toggle - Detailed output option

#### Phase 0.6.6: Basic Coverage [IMPORTANT]
**Duration:** 4 days

- [ ] Line coverage tracking - Which lines executed
- [ ] Coverage summary - Overall percentage
- [ ] Per-file coverage - File-by-file breakdown
- [ ] Text format output - Human-readable
- [ ] Coverage thresholds - Fail if below target

**Phase 0.6 Deliverables:**
- ✅ Rich assertion library (20+ assertions)
- ✅ Reusable test fixtures
- ✅ Test suite organization
- ✅ Async operation testing
- ✅ Professional CLI output
- ✅ Code coverage measurement

---

### 💡 NICE TO HAVE (Phase 0.7+ - Advanced Features)

**Timeline:** +15-20 days (33-38 days total)
**Goal:** Enterprise-grade testing framework

Can be implemented incrementally as needed:

#### Advanced Test Isolation
- Four-layer isolation strategy (environment, buffer, global, module)
- Buffer auto-cleanup with `with-test-buffer` macro
- Flaky test detection with retry logic
- Strict mode (fail if state leaks detected)

#### Parametrized Tests
- `deftest-parametrized` macro
- Table-driven test syntax
- Per-case setup/teardown hooks

#### Snapshot Testing
- `should-match-snapshot` assertion
- External `.snap` files
- Interactive update workflow
- Diff visualization (side-by-side, unified)

#### Test Explorer UI
- Buffer-based Test Explorer
- Hierarchical tree view
- Interactive keybindings
- Jump to test definition

#### Examples as Tests
- Test docstring examples automatically
- Example coverage tracking
- Triple purpose (docs/tests/demos)

#### Watch Mode & TDD
- File watcher implementation
- Smart test selection (affected tests)
- TDD workflow (Red-Green-Refactor)
- Interactive watch menu

#### Advanced Coverage
- Branch coverage tracking
- Function coverage tracking
- HTML report generation
- Lcov format for CI/CD
- Threshold enforcement and trending

#### Mocking & Spying
- `spy-on` function
- `mock-fn` creation
- Call verification APIs
- Module mocking with runtime evaluation

#### Benchmarking
- `deftest-bench` macro
- Performance measurement (ops/sec, variance)
- Baseline tracking and comparison
- Regression detection

**Phase 0.7+ Deliverables:**
- ✅ Enterprise features (all nice-to-have items)
- ✅ Advanced isolation and reliability
- ✅ Developer experience enhancements
- ✅ Performance optimization tools

---

## All Improvements Documented ✅

The TRT framework is now fully specified with 14 comprehensive improvements covering all aspects of modern testing frameworks.

**Implementation Complete:**
- ✅ 8 phases (0.5.1 through 0.5.9)
- ✅ 25-37 total days of development work
- ✅ All comparison metrics showing advantages over ERT, Vitest, and Bun Test
- ✅ Self-hosted architecture (T-Lisp based)
- ✅ Dual-mode interface (CLI + buffer-based)
- ✅ Comprehensive feature set for 2025 and beyond

---

## Alternatives Considered

### Alternative 1: Standalone TRT CLI
**Rejected** - Doesn't align with Lisp-first philosophy
- Pros: Dedicated tool, can be installed separately
- Cons: Duplicates T-Lisp interpreter, can't run from within tmax

### Alternative 2: External Test Runner (Jest/Vitest wrapper)
**Rejected** - Can't test T-Lisp code directly
- Pros: Leverages existing tools
- Cons: JavaScript test runner can't execute T-Lisp code

### Alternative 3: Minimal ERT Clone
**Rejected** - Doesn't improve on ERT's weaknesses
- Pros: Simple to implement
- Cons: Missing modern features, poor developer experience

### Alternative 4: Dual-Mode (Chosen Approach)
**Selected** - Best of both worlds
- ✅ Single binary through tmax
- ✅ Integrated editor experience
- ✅ CLI automation support
- ✅ Follows Lisp-first architecture

---

## Implementation Plan

### Feature Prioritization

The TRT framework is organized into three priority levels to enable iterative development:

**🚨 MUST HAVE (MVP - Phase 0.5)**
- Essential features for any functional test framework
- Timeline: 8 days
- Delivers: Working test framework with basic functionality

**⭐ SHOULD HAVE (Phase 0.6)**
- Important features for real-world development workflows
- Timeline: +10 days (18 days total)
- Delivers: Professional-grade testing infrastructure

**💡 NICE TO HAVE (Phase 0.7+)**
- Advanced features and polish
- Timeline: +15-20 days (33-38 days total)
- Delivers: Enterprise-grade testing framework

See [Detailed Prioritization](#detailed-prioritization) below for complete breakdown.

---

### Phase 0.5.1: Core Framework [CRITICAL]
**Duration:** 3-4 days
**Priority:** HIGH

- [ ] TRT core functions (`src/tlisp/trt/trt.tlisp`)
  - [ ] `deftest` macro
  - [ ] `should-equal` assertion
  - [ ] Test execution engine
- [ ] TypeScript CLI wrapper (`src/main.tsx --test`)
- [ ] Test runner with exit codes (`process.exit`)
- [ ] Basic test discovery (`*.test.tlisp`)

### Phase 0.5.2: Fixtures & Assertions [MEDIUM]
**Duration:** 2-3 days

- [ ] Fixture system (`deffixture`, `with-fixture`)
- [ ] Rich assertion library (20+ assertions)
- [ ] Error message formatting
- [ ] Custom assertion API (`defassertion`)
- [ ] Parametrized tests (`deftest-parametrized`)
- [ ] Per-case setup/teardown hooks

### Phase 0.5.3: Test Isolation [HIGH]
**Duration:** 2-3 days

- [ ] Environment isolation (per-test child environments)
- [ ] Buffer auto-cleanup (`with-test-buffer` macro)
- [ ] Lifecycle hooks (before/after, setup/teardown)
- [ ] Global state reset
- [ ] Flaky test detection (retry logic)

### Phase 0.5.4: Test Explorer UI [MEDIUM]
**Duration:** 4-5 days

- [ ] CLI output renderer (ANSI colors, progress bar)
- [ ] Buffer-based Test Explorer (tree view)
- [ ] Test suites and hierarchical organization
- [ ] Suite hooks and lifecycle management
- [ ] Real-time status updates
- [ ] Keybindings (navigation, actions)
- [ ] Test detail buffer (view failures)
- [ ] Suite filtering and selective execution
- [ ] Snapshot testing integration
  - [ ] External .snap file format
  - [ ] should-match-snapshot assertion
  - [ ] Inline snapshot support
  - [ ] Interactive update workflow (U/K/D/S/A/Q)
  - [ ] Diff visualization (side-by-side, unified)
  - [ ] Custom snapshot formatters
  - [ ] CI/CD non-interactive mode

### Phase 0.5.5: Async Testing Support [HIGH]
**Duration:** 3-4 days

- [ ] Async test detection (Task/Promise return types)
- [ ] deftest-async macro
- [ ] Async assertions (should-await-*)
- [ ] Timeout protection (per-test and global)
- [ ] Fake timers (with-fake-timers macro)
- [ ] Timer execution (advance-timers function)
- [ ] Async fixtures and hooks
- [ ] await-all for parallel operations
- [ ] Async error handling and reporting

### Phase 0.5.6: Coverage Reporting [HIGH]
**Duration:** 4-5 days

- [ ] Coverage data collection during test execution
- [ ] Line coverage tracking
- [ ] Branch coverage tracking (if/cond/switch)
- [ ] Function coverage tracking
- [ ] Multiple report formats (text, HTML, JSON, lcov)
- [ ] Coverage thresholds and enforcement
- [ ] Exclude patterns (files, lines, branches)
- [ ] Uncovered lines report
- [ ] Coverage by test suite
- [ ] HTML report generation with interactive UI
- [ ] Coverage trend tracking
- [ ] CI/CD integration (lcov format, exit codes)

### Phase 0.5.7: Watch Mode & TDD Workflow [MEDIUM-HIGH]
**Duration:** 3-4 days

- [ ] File watcher implementation (monitor changes)
- [ ] Smart test selection (dependency graph)
- [ ] Watch mode CLI (--watch flag)
- [ ] Interactive menu system (a/f/p/t/q/enter/h)
- [ ] TDD workflow mode (--tdd flag)
- [ ] Red-Green-Refactor cycle tracking
- [ ] Pattern matching (--pattern, --exclude)
- [ ] Debouncing (avoid excessive re-runs)
- [ ] Watch plugins system (custom commands)
- [ ] Status line integration
- [ ] Compact and verbose output modes
- [ ] Performance optimization (affected tests first)

### Phase 0.5.8: Mocking & Spying [HIGH]
**Duration:** 4-5 days

- [ ] Spy function creation (spy-on, spy-reset)
- [ ] Mock function creation (mock-fn with implementation)
- [ ] Call tracking (arguments, return values, call order)
- [ ] Verification matchers (called-with, called-times, etc.)
- [ ] Module mocking (mock-module, avoid hoisting issues)
- [ ] Mock return values (single value, sequence, errors)
- [ ] Object method spying (spy-on object methods)
- [ ] Automatic cleanup after tests
- [ ] Manual reset APIs (spy-reset, spy-reset-all)
- [ ] Integration with fixtures (mock fixtures)
- [ ] Advanced matchers (called-with-matching, called-containing)

### Phase 0.5.9: Benchmarking Integration [MEDIUM]
**Duration:** 3-4 days

- [ ] Benchmark test macro (deftest-bench)
- [ ] Benchmark execution engine
- [ ] Performance measurement (ops/sec, variance)
- [ ] Baseline storage and comparison (.trt-baselines/)
- [ ] Regression detection (threshold enforcement)
- [ ] Benchmark suites (describe-bench)
- [ ] Comparison benchmarks (A vs B)
- [ ] Report formats (text, JSON, summary)
- [ ] Memory profiling integration
- [ ] Performance trend tracking
- [ ] Benchmark filtering (pattern, tags, exclude)

### Total Timeline: 28-37 days

---

## References

### Inspiration Sources
- [Emacs ERT](https://www.gnu.org/software/emacs/manual/html_mono/ert.html) - Base framework
- [Vitest Features](https://vitest.dev/guide/features) - Per-file worker isolation, flaky detection, benchmark support (Dec 2025)
- [Vitest Coverage Guide](https://vitest.dev/guide/coverage.html) - Coverage reporting, multiple formats
- [Vitest Snapshot Guide](https://vitest.dev/guide/snapshot) - Snapshot testing (updated Nov 2025)
- [Vitest Coverage Config](https://vitest.dev/config/coverage) - Coverage thresholds, exclusions
- [Vitest Mocking Guide](https://vitest.dev/guide/mocking) - Mocking and spying (updated Aug 2025)
- [Vitest Mocking Functions](https://cn.vitest.dev/guide/mocking/functions) - Spy vs mock (Dec 2025)
- [Vitest Mock API](https://cn.vitest.dev/api/mock) - Mock API reference (Jan 2026)
- [Vitest Benchmarking Discussion](https://github.com/vitest-dev/vitest/discussions/7850) - API challenges and improvements
- [Vitest Comparisons](https://vitest.dev/guide/comparisons) - Performance vs Jest
- [Incredible Vitest Defaults](https://www.epicweb.dev/incredible-vitest-defaults) - Worker isolation benefits
- [Vitest Test Context](https://vitest.dev/guide/test-context) - Async fixtures (updated Dec 2025)
- [Vitest 异步测试实战](https://juejin.cn/post/7514278695063666697) - Async testing best practices
- [TDD with React & Vitest](https://medium.com/@yakovify/test-driven-development-tdd-with-react-complete-guide-with-examples-9de2be2dba77) - Watch mode by default
- [Test Like a Pro 2025](https://javascript.plainenglish.io/test-like-a-pro-in-2025-how-i-transformed-my-javascript-projects-with-vitest-playwright-and-more-9616cfb72e9b) - Near-instant watching
- [vi.mock is a footgun](https://laconicwit.com/vi-mock-is-a-footgun-why-vi-spyon-should-be-your-default/) - Why spyOn preferred (July 2025)
- [Mock vs SpyOn in Vitest](https://dev.to/axsh/mock-vs-spyon-in-vitest-with-typescript-a-guide-for-unit-and-integration-tests-2ge6) - Best practices (Jan 2025)
- [Jest Watch Plugins](https://jestjs.io/docs/watch-plugins) - Custom watch workflows (June 2025)
- [Jest CLI](https://jestjs.io/docs/cli) - Watch mode options (June 2025)
- [Jest 30 Release](https://jestjs.io/blog/2025/06/04/jest-30) - Performance improvements
- [Jest mocking explained](https://medium.com/@dugarvishesh/jest-mocking-explained-when-to-use-mock-mocked-and-spyon-in-your-tests-8af6371e23e0) - jest.fn vs spyOn (June 2025)
- [Bun Coverage Guide](https://bun.com/docs/guides/test/coverage) - Native coverage implementation
- [Moldable Emacs: Examples for docs, demos, tests](https://ag91.github.io/blog/2021/12/23/moldable-emacs-examples-for-docs-demos-and-ert-tests/) - Triple purpose examples
- [Moldable Emacs: Molds need examples](https://ag91.github.io/blog/2021/10/02/moldable-emacs-molds-need-examples-too/) - Examples linked to functions
- [doctest.el: Testing Elisp in docstrings](https://ag91.github.io/blog/2023/03/20/doctestel-or-testing-your-pure-elisp-functions-in-your-docstring/) - Elisp docstring testing
- [Python doctest tutorial](https://dev.to/snyk/how-to-write-tests-in-python-using-doctest-30lh) - Doctest concepts
- [Test examples before release](https://playbooks.omsf.io/developer/documentation/test-code-examples-before-release/) - Best practices
- [Literate programming tutorial](https://www.howardism.org/Technical/Emacs/literate-programming-tutorial.html) - Org-mode literate programming
- [Jest Snapshot Testing](https://jestjs.io/docs/snapshot-testing) - Snapshot concepts
- [pytest Fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html) - Fixture design, parametrized tests
- [pytest Parametrize](https://docs.pytest.org/en/stable/how-to/parametrize.html) - Parametrized test syntax
- [Jest Expectations](https://jestjs.io/docs/expect) - Assertion library ideas

### Issues and Limitations (What to Avoid)
- [Bun Issue #6024: Make bun test isolated](https://github.com/oven-sh/bun/issues/6024) - Isolation problems
- [Bun Issue #12823: Mocks scoped to test file](https://github.com/oven-sh/bun/issues/12823) - Mock leaking
- [Bun Issue #25712: mock.module conflicts](https://github.com/oven-sh/bun/issues/25712) - Module registry sharing
- [Bun Issue #4909: expect.rejects not supported](https://github.com/oven-sh/bun/issues/4909) - Async assertions broken
- [Bun Issue #19660: Async tests not awaited](https://github.com/oven-sh/bun/issues/19660) - Tests run in parallel incorrectly
- [Bun Issue #6716: Support istanbul coverage](https://github.com/oven-sh/bun/issues/6716) - Coverage limitations
- [Bun Issue #3158: Test coverage reporters](https://github.com/oven-sh/bun/issues/3158) - Reporter support gaps
- [Bun Issue #16148: Istanbul ignore comments](https://github.com/oven-sh/bun/issues/16148) - Comment parsing
- [Angular-builders Performance Regression](https://github.com/just-jeb/angular-builders/issues/1899) - 7.5x slower tests example to avoid
- [Vitest Issue #3119: Hanging async detection](https://github.com/vitest-dev/vitest/issues/3119) - Timeout detection inspiration
- [Vitest Issue #7850: Benchmarking challenges](https://github.com/vitest-dev/vitest/discussions/7850) - Vite SSR overhead to avoid

### Related Documentation
- [tmax PRD](../specs/prd.md) - Epic 4: T-Lisp Testing Infrastructure
- [tmax ROADMAP](../docs/ROADMAP.md) - Phase 0.5: Testing Infrastructure Enhancement
- [CLAUDE.md](../CLAUDE.md) - Development guidelines and testing strategy

---

## Appendix: Comparison Matrix

| Feature | ERT | Vitest | Bun Test | TRT (Proposed) |
|---------|-----|--------|----------|----------------|
| Fixture System | ❌ Manual | ✅ Built-in | ⚠️ Basic | ✅ Advanced |
| Rich Assertions | ⚠️ Basic | ✅ Extensive | ✅ Good | ✅ Comprehensive |
| Test Discovery | ❌ Manual | ✅ Auto | ✅ Auto | ✅ Auto |
| Test Isolation | ❌ Poor | ✅ Per-file | ❌ Leaks | ✅ 4-layer |
| Test Explorer | ⚠️ Basic | ✅ UI | ⚠️ Terminal | ✅ Dual-mode |
| Test Suites | ❌ Flat | ✅ Nested | ✅ Yes | ✅ Nested |
| Parametrized Tests | ❌ No | ✅ Yes | ❌ No | ✅ Yes |
| Async Testing | ❌ No | ✅ Yes | ⚠️ Problems | ✅ Full Support |
| Fake Timers | ❌ No | ✅ Yes | ✅ Yes | ✅ Yes |
| Snapshot Testing | ❌ No | ✅ Yes | ✅ Yes | ✅ Interactive |
| Examples as Tests | ❌ No | ❌ No | ❌ No | ✅ Triple Purpose |
| Watch Mode | ❌ No | ✅ Yes (default) | ✅ Yes | ✅ Smart + TDD |
| Mocking & Spying | ❌ No | ✅ vi.spyOn | ⚠️ Limited | ✅ Spy-First |
| Benchmarking | ❌ No | ✅ Tinybench | ❌ No | ✅ Regression Detection |
| Flaky Detection | ❌ No | ✅ Yes | ❌ No | ✅ Yes |
| Coverage | ❌ No | ✅ Yes | ✅ Native | ✅ Multi-format |
| Self-hosted | ✅ Yes | ❌ No | ❌ No | ✅ Yes |

---

**Next Steps:**
1. Review and approve RFC
2. Implement Phase 0.5.1 (Core Framework)
3. Iterate through remaining phases
4. Update PRD with implementation details
