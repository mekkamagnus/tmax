---
scope: test/**/*
---

# Testing Rules

Applies to all test files in `test/`.

## Strategy

- **Test-Driven Development**: Create and run tests before code implementation
- Use `bun test` for running tests
- All unit and integration tests go directly in `test/`
- Aim for high test coverage, especially for core logic
- Tests must be isolated and repeatable
- Use clear, descriptive names for test files and test cases

## Commands

```bash
# Run all tests
bun test

# Run specific test files
bun test test/unit/tokenizer.test.ts
bun test test/unit/parser.test.ts
bun test test/unit/evaluator.test.ts
bun test test/unit/editor.test.ts
```

## Test Syntax (Bun)

```typescript
import { describe, test, expect } from "bun:test";

// Use Bun test syntax:
// expect(x).toBe(y)         — not assertEquals(x, y)
// expect(fn).toThrow()      — not assertThrows(fn)
```

## Patterns

- Test all error paths, not just happy paths
- Use the project's functional types (Option, Either, Result) in tests
- Mock at boundaries only — prefer real implementations for core logic
- Current coverage: 131+ tests across comprehensive test suites
