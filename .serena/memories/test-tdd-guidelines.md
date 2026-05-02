# TDD Guidelines for Init File Refactoring

## Test-Driven Development Workflow

1. **Write test first** - Create test file before implementation
2. **Run test** - Verify it fails (red)
3. **Implement code** - Make the test pass (green)
4. **Refactor** - Clean up implementation
5. **Repeat** - Continue with next feature

## Test Organization

### Unit Tests
- Location: `test/unit/`
- Naming: `<feature>.test.ts`
- Focus: Single function/method behavior
- Isolation: No external dependencies

### Integration Tests
- Location: `test/integration/`
- Naming: `<workflow>.test.ts`
- Focus: Multiple components working together
- Real dependencies: File system, terminal

## Test Structure

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';

describe('Feature Name', () => {
  beforeEach(() => {
    // Setup: Create test fixtures
  });

  test('should do something specific', () => {
    // Arrange: Set up test data
    // Act: Execute function
    // Assert: Verify results
    expect(result).toBe(expected);
  });
});
```

## Testing Principles

1. **Test behavior, not implementation**
2. **One assertion per test (when practical)**
3. **Descriptive test names**
4. **Independent tests** (no shared state)
5. **Mock external dependencies** (file system, terminal)
6. **Test edge cases** (errors, null values, empty strings)
