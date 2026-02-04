# Essential Assertions

## Status

Accepted

## Context

The testing framework (US-0.5.1) provided test execution but lacked assertion functions to verify expected behavior. Tests had no way to check results or report failures, making them essentially useless for automated verification.

## Decision

Implement five essential assertion functions for T-Lisp testing:

### Assertion Functions

1. **`assert-true`** - Verify value is truthy
   ```lisp
   (assert-true (not (null? x)))  ; x must not be null
   ```

2. **`assert-false`** - Verify value is falsy
   ```lisp
   (assert-false (null? x))  ; x must be null
   ```

3. **`assert-equal`** - Verify two values are equal
   ```lisp
   (assert-equal (+ 2 3) 5)  ; 2 + 3 must equal 5
   ```

4. **`assert-not-equal`** - Verify two values are not equal
   ```lisp
   (assert-not-equal x y)  ; x must not equal y
   ```

5. **`assert-error`** - Verify expression raises an error
   ```lisp
   (assert-error (car nil))  ; car of nil must error
   ```

### Implementation

Created assertion functions in `src/tlisp/stdlib.ts`:

```typescript
export const assertEqual: BuiltinFunction = (
  _env: Environment,
  args: Expression[]
): Expression => {
  const [actual, expected] = args;
  if (!isEqual(actual, expected)) {
    throw new AssertionError(
      `Expected ${print(expected)} but got ${print(actual)}`
    );
  }
  return { type: 'boolean', value: true };
};
```

### Error Reporting

Assertions throw `AssertionError` with descriptive messages:
- `assert-equal`: Shows expected vs actual values
- `assert-error`: Shows that error was expected but didn't occur
- All assertions include expression that failed

### Test Integration

Assertions integrate with `deftest` framework:
```lisp
(deftest test-arithmetic
  (assert-equal (+ 2 2) 4)
  (assert-equal (* 3 3) 9)
  (assert-not-equal 1 2))
```

## Consequences

### Benefits

1. **Automated Verification**: Tests can automatically check behavior
2. **Clear Failure Messages**: Descriptive errors aid debugging
3. **Comprehensive Checks**: Five assertions cover most testing needs
4. **Consistent API**: All assertions follow same naming pattern
5. **Composable**: Can use multiple assertions in one test

### Trade-offs

1. **Limited Comparisons**: No support for numeric tolerances, string contains, etc.
2. **No Custom Messages**: Can't add context to assertions
3. **Boolean Logic**: No `assert-greater`, `assert-less`, etc.
4. **Error Checking**: `assert-error` catches all errors, can't specify error type

### Future Considerations

1. **Custom Messages**: Add optional message parameter to assertions
2. **Numeric Assertions**: `assert-greater`, `assert-less`, `assert-approx-equal`
3. **String Assertions**: `assert-contains`, `assert-matches`
4. **Type Assertions**: `assert-number`, `assert-string`, `assert-list`
5. **Error Type Checking**: `assert-error-type` to verify specific error types
6. **Collection Assertions**: `assert-empty`, `assert-length`, `assert-contains`

### Testing

Created `test/unit/test-tlisp-testing-framework.test.ts`:
- All five assertions work correctly
- `assert-true` passes for truthy values
- `assert-false` passes for falsy values
- `assert-equal` compares values correctly
- `assert-not-equal` detects inequality
- `assert-error` catches errors
- All assertions throw `AssertionError` on failure
