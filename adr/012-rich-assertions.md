# Rich Assertions

## Status

**proposed**

## Context

The essential assertions (US-0.5.2) covered basic cases but lacked:
- Custom error messages for debugging
- Numeric comparisons with tolerances
- Collection membership testing
- Type checking assertions
- String pattern matching

## Decision

Extend assertion library with rich assertion functions:

### New Assertions

1. **`assert-approx-equal`** - Numeric comparison with tolerance
   ```lisp
   (assert-approx-equal 3.14159 3.14 0.01)  ; 2 decimal places
   ```

2. **`assert-contains`** - Collection membership
   ```lisp
   (assert-contains '(1 2 3) 2)  ; 2 is in list
   (assert-contains "hello" "ell")  ; substring
   ```

3. **`assert-type`** - Type checking
   ```lisp
   (assert-type 42 'number)  ; must be number
   (assert-type '(1 2) 'list)  ; must be list
   ```

4. **`assert-match`** - String pattern matching
   ```lisp
   (assert-match "hello123" "^[a-z]+[0-9]+$")  ; regex match
   ```

5. **`assert-greater`** / **`assert-less`** - Numeric comparisons
   ```lisp
   (assert-greater x 10)  ; x > 10
   (assert-less y 5)      ; y < 5
   ```

### Enhanced Messages

All assertions support optional custom message:
```lisp
(assert-equal x y "x and y should be equal")
(assert-contains items item "Item not found in collection")
```

### Implementation

Created rich assertions in `src/tlisp/stdlib.ts`:

```typescript
export const assertApproxEqual: BuiltinFunction = (
  _env: Environment,
  args: Expression[]
): Expression => {
  const [actual, expected, tolerance, message] = args;
  const diff = Math.abs(
    (actual as NumberExpression).value -
    (expected as NumberExpression).value
  );

  if (diff > (tolerance as NumberExpression).value) {
    throw new AssertionError(
      message ? message.value :
      `Values differ by ${diff}, expected tolerance ${tolerance.value}`
    );
  }

  return { type: 'boolean', value: true };
};
```

## Consequences

### Benefits

1. **Better Error Messages**: Custom messages aid debugging
2. **Numeric Testing**: Can test floating-point comparisons
3. **Collection Testing**: Verify membership without manual iteration
4. **Type Safety**: Ensure values have correct types
5. **Pattern Matching**: Test string formats with regex

### Trade-offs

1. **API Bloat**: More assertion functions to learn
2. **Performance**: Regex matching is expensive
3. **Complexity**: Some assertions have subtle semantics
4. **Message Handling**: Optional parameter adds complexity

### Future Considerations

1. **Assert Length**: Check collection size
2. **Assert Empty**: Check for empty collections
3. **Assert Nil**: Explicit nil checking
4. **Assert Throws**: Verify specific error types
5. **Assert Within**: Check if value in range
6. **Assert Instance**: Check object type hierarchy

### Testing

Created `test/unit/debug-tlisp-testing.test.ts`:
- All rich assertions work correctly
- Custom messages appear in failure output
- Tolerance works for approximate equality
- Contains works for lists and strings
- Type checking catches type mismatches
- Regex matching validates patterns
