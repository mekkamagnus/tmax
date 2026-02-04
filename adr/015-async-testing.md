# Async Testing

## Status

**proposed**

## Context

The testing framework only supported synchronous tests, making it impossible to:
- Test async/await operations
- Test file I/O operations
- Test LSP client communication
- Test timeout behavior
- Test race conditions

## Decision

Extend testing framework to support async tests:

### Async Test Definition

```lisp
(deftest-async test-file-io
  (async (buf)
    (let ((file "/tmp/test.txt"))
      ;; Async file write
      (await (buffer-write-file buf file))
      ;; Async file read
      (let ((loaded (await (buffer-read-file file))))
        (assert-equal (buffer-text loaded) (buffer-text buf))))))
```

### Async Assertions

Support async assertions:
```lisp
(deftest-async test-async-operation
  (async ()
    (let ((result (await (some-async-function))))
      (assert-equal result "expected")))))
```

### Timeout Support

Specify timeout for async tests:
```lisp
(deftest-async test-timeout :timeout 5000
  (async ()
    (await (long-running-operation))))
```

### Implementation

Created async testing in `src/tlisp/test-framework.ts`:

```typescript
interface AsyncTestCase extends TestCase {
  timeout: number;
}

export const testRunAsync = async (
  env: Environment,
  args: Expression[]
): Promise<Expression> => {
  const testName = args[0];
  const test = asyncTestRegistry.get(testName.value);

  // Create timeout promise
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Test timeout')), test.timeout)
  );

  try {
    // Race test execution against timeout
    const result = await Promise.race([
      evaluate(test.body, env),
      timeoutPromise
    ]);
    return { type: 'symbol', value: 'pass' };
  } catch (error) {
    return { type: 'symbol', value: 'fail' };
  }
};
```

### T-Lisp Async Primitives

Added to `src/tlisp/stdlib.ts`:
```typescript
// async - Create async context
export const async = (env: Environment, args: Expression[]): Expression => {
  return {
    type: 'async',
    body: args[0],
    env
  };
};

// await - Await async operation
export const await = async (env: Environment, args: Expression[]): Promise<Expression> => {
  const expr = args[0];
  if (expr.type === 'promise') {
    return expr.value;
  }
  return Promise.resolve(expr);
};
```

## Consequences

### Benefits

1. **Async Testing**: Can test async operations
2. **Timeout Protection**: Tests don't hang forever
3. **Real-World Scenarios**: Test I/O, network, etc.
4. **Race Condition Testing**: Test concurrent operations
5. **Plugin Support**: Plugins can test async features

### Trade-offs

1. **Complexity**: Async adds cognitive overhead
2. **Flaky Tests**: Timing-dependent tests can be unreliable
3. **Performance**: Async tests are slower
4. **Debugging**: Async call stacks are harder to follow

### Future Considerations

1. **Fake Timers**: Control time for deterministic tests
2. **Mock Async**: Create fake async operations
3. **Retry Logic**: Retry failed async tests
4. **Parallel Async**: Run async tests concurrently
5. **Resource Tracking**: Ensure async resources are cleaned up

### Testing

Created `test/unit/test-tlisp-testing-framework.test.ts`:
- Async tests execute correctly
- Timeout prevents infinite hangs
- Async assertions work
- Error handling in async tests
