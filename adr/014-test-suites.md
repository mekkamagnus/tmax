# Test Suites

## Status

Accepted

## Context

As the test suite grew, managing individual tests became difficult:
- No way to group related tests
- Running subset of tests required manual selection
- No organizational structure for tests
- Test names became long and unwieldy

## Decision

Implement test suites for grouping related tests:

### Suite Definition

```lisp
(defsuite buffer-tests "Buffer operation tests"
  (deftest test-buffer-create
    (let ((buf (buffer-create "test.txt")))
      (assert-not-equal buf nil)))

  (deftest test-buffer-insert
    (let ((buf (buffer-create "test.txt")))
      (buffer-insert buf 0 0 "Hello")
      (assert-equal (buffer-text buf) "Hello")))

  (deftest test-buffer-delete
    (let ((buf (buffer-create "test.txt")))
      (buffer-insert buf 0 0 "Hello")
      (buffer-delete buf 0 0 0 5)
      (assert-equal (buffer-text buf) ""))))
```

### Suite Execution

```lisp
;; Run all tests in suite
(test-run-suite 'buffer-tests)
;; => ((:pass . 3) (:fail . 0))

;; Run specific test from suite
(test-run 'buffer-tests/test-buffer-create)
;; => :pass
```

### Suite Hierarchy

Suites can contain other suites:
```lisp
(defsuite all-tests
  (include-suite buffer-tests)
  (include-suite editor-tests)
  (include-suite keymap-tests))
```

### Implementation

Created suite system in `src/tlisp/test-framework.ts`:

```typescript
interface TestSuite {
  name: string;
  description: string;
  tests: Map<string, TestCase>;
  suites: Map<string, TestSuite>;
}

export const testRunSuite = (
  env: Environment,
  args: Expression[]
): Expression => {
  const suiteName = args[0];
  const suite = suiteRegistry.get(suiteName.value);

  let passCount = 0;
  let failCount = 0;

  // Run all tests in suite
  for (const [name, test] of suite.tests) {
    const result = testRun(env, [{ type: 'string', value: name }]);
    if (result.value === 'pass') passCount++;
    else failCount++;
  }

  // Recursively run child suites
  for (const [name, childSuite] of suite.suites) {
    const childResults = testRunSuite(env, [{ type: 'string', value: name }]);
    passCount += childResults.value[0].value;
    failCount += childResults.value[1].value;
  }

  return list([
    { type: 'symbol', value: 'pass' },
    { type: 'number', value: passCount },
    { type: 'symbol', value: 'fail' },
    { type: 'number', value: failCount }
  ]);
};
```

## Consequences

### Benefits

1. **Organization**: Tests grouped logically
2. **Selective Execution**: Run specific suites
3. **Hierarchical Structure**: Nest suites for complex projects
4. **Documentation**: Suite descriptions explain purpose
5. **Modularity**: Suites can be split across files

### Trade-offs

1. **Complexity**: Additional abstraction to manage
2. **Naming**: Suite names must be globally unique
3. **Overhead**: Suite management adds runtime cost
4. **Discovery**: Finding tests in hierarchies can be complex

### Future Considerations

1. **Suite Tags**: Tag suites for filtering (e.g., slow, integration)
2. **Suite Hooks**: before/after at suite level
3. **Parallel Execution**: Run suites concurrently
4. **Suite Dependencies**: Specify suite execution order
5. **Dynamic Suites**: Generate suites programmatically
6. **Suite Comprehension**: Comprehensions over test suites

### Testing

Created `test/unit/test-tlisp-testing-framework.test.ts`:
- Suites can be defined with tests
- Suites can include other suites
- Running suite executes all tests
- Suite results aggregate correctly
- Nested suites work as expected
