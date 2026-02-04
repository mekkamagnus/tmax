# Basic Test Isolation

## Status

**proposed**

## Context

The initial testing framework (US-0.5.1) ran all tests in a shared global environment. This caused problems:
- Tests could leak variables to other tests
- Tests depended on execution order
- Side effects from one test affected another
- Tests couldn't define conflicting variable names

## Decision

Implement basic test isolation by creating fresh environments for each test:

### Implementation Strategy

1. **Environment Snapshot**: Capture global environment before running tests
2. **Test Environment**: Each test runs in a child environment
3. **Cleanup**: Restore environment after test completion
4. **Error Handling**: Ensure cleanup runs even if test fails

### Code Changes

Modified `test-run` in `src/tlisp/test-framework.ts`:

```typescript
export const testRun = (
  env: Environment,
  args: Expression[]
): Expression => {
  const testName = args[0];
  const test = testRegistry.get(testName.value);

  // Create isolated environment
  const testEnv = createChildEnvironment(globalEnv);

  try {
    // Run test in isolated environment
    const result = evaluate(test.body, testEnv);
    return { type: 'symbol', value: 'pass' };
  } catch (error) {
    return { type: 'symbol', value: 'fail' };
  }
};
```

### Child Environment

Implemented `createChildEnvironment`:
- Inherits from parent environment
- New variables don't affect parent
- Can read parent variables
- Can shadow parent variables

### Scope Behavior

```lisp
;; Test 1
(deftest test-variables
  (def x 10)
  (assert-equal x 10))

;; Test 2 (x is undefined here)
(deftest test-no-leak
  (assert-error x))  ; x is not defined
```

## Consequences

### Benefits

1. **Test Independence**: Tests don't affect each other
2. **Execution Order**: Can run tests in any order
3. **Variable Naming**: Can reuse variable names across tests
4. **Debugging**: Easier to isolate failing tests
5. **Parallelization**: Potential for parallel test execution

### Trade-offs

1. **Performance**: Creating environments adds overhead
2. **Memory**: Each test holds environment until completion
3. **Side Effects**: Doesn't prevent I/O side effects (file system, etc.)
4. **Global State**: Can't test global state mutations
5. **Shared Resources**: Tests still share some resources (e.g., open files)

### Future Considerations

1. **Before/After Hooks**: Setup/teardown for shared resources
2. **Mock File System**: Virtual filesystem for I/O isolation
3. **Sandboxing**: Complete isolation including I/O
4. **Parallel Execution**: Run tests concurrently
5. **Environment Templates**: Predefined environments for specific test types
6. **Resource Tracking**: Automatic cleanup of resources (files, sockets, etc.)

### Testing

Created `test/unit/test-isolation-simple.test.ts`:
- Variables defined in one test don't leak to others
- Tests can be run in any order
- Tests can use same variable names
- Parent variables are accessible in child environments
- Child variables don't affect parent environment
