---
scope: test/**/*
---

# Testing Rules

Applies to all test files in `test/`.

## Two Test Layers

This project has two distinct test layers:

| Layer | What it tests | Runner | Location |
|-------|--------------|--------|----------|
| **Bun tests** | TypeScript core, editor, interpreter, integration | `bun test` | `test/unit/*.test.ts`, `test/integration/*.test.ts` |
| **T-Lisp tests** | T-Lisp extensions, key bindings, editor API | `(test-run-all)` via interpreter | Defined inline with `deftest` |

### When to use which

- **Bun tests** — TypeScript functions, interpreter internals, terminal I/O, buffer management, error handling in the core
- **T-Lisp tests** — Editor commands (`cursor-move`, `word-next`, etc.), key bindings, user-facing T-Lisp API, init file behavior, extensions written in T-Lisp

## Bun Test Rules

### Commands

```bash
# Run all tests
bun test

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

### Available assertions

```
assert-true value
assert-false value
assert-equal expected actual
assert-not-equal expected actual
assert-contains list item
assert-contains-string haystack needle
assert-matches pattern string
assert-type value type-symbol
assert->= value expected
assert-< value expected
assert-in-delta actual tolerance expected
assert-eventually condition-fn timeout-ms
```

### Test lifecycle

```
(deftest "test-name" () body...)          — define a test
(test-run "test-name")                    — run a single test
(test-run-all)                            — run all defined tests
(test-run-suite "suite-name")             — run tests in a suite
```

### Fixtures

```
(defixture "fixture-name"
  :setup ((...))
  :teardown ((...))
  :scope each|once|all)
```

### Coverage

T-Lisp tests support coverage reporting via `test-coverage.ts`.

## Mock Filesystem

Tests that create an `Editor` must provide binding files in the mock filesystem. The editor loads `src/tlisp/core/bindings/{normal,insert,visual,command}.tlisp` at startup. Without them, it falls back to minimal bindings and tests get inconsistent behavior.

**Always include real binding files** in mock filesystems — either serve the actual files from disk or provide complete stubs.
