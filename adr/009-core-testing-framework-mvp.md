# Core Testing Framework MVP

## Status

Accepted

## Context

T-Lisp lacked a built-in testing framework, making it difficult to:
- Test T-Lisp code and standard library functions
- Verify correctness of T-Lisp macros
- Ensure regressions don't occur during development
- Provide examples for plugin developers

Tests were run manually through the REPL, with no automation or reporting.

## Decision

Implement a minimal viable testing framework with three core functions:

### Core Functions

1. **`deftest`** - Define a test case
   ```lisp
   (deftest test-addition
     (assert-equal (+ 2 3) 5))
   ```

2. **`test-run`** - Run a single test by name
   ```lisp
   (test-run 'test-addition)  ; => :pass or :fail
   ```

3. **`test-run-all`** - Run all defined tests
   ```lisp
   (test-run-all)  ; => ((:pass . 10) (:fail . 2))
   ```

### Implementation

Created `src/tlisp/test-framework.ts` with:

- **Test Registry**: Global `Map<string, TestCase>` for storing tests
- **Result Types**: `:pass`, `:fail` symbols for test results
- **Summary Statistics**: Counts of passed/failed tests
- **Output Formatting**: Human-readable test results

### Execution Model

```lisp
;; Define tests
(deftest test-math-add
  (assert-equal (+ 1 2) 3))

(deftest test-math-subtract
  (assert-equal (- 5 2) 3))

;; Run all tests
(test-run-all)
;; => ((:pass . 2) (:fail . 0))
```

### Error Handling

- Test failures are caught and reported
- Test execution continues after failures
- Stack traces preserved for debugging

## Consequences

### Benefits

1. **Automated Testing**: Can run test suites automatically
2. **Regression Prevention**: Catch breaking changes early
3. **Documentation**: Tests serve as usage examples
4. **Plugin Development**: Plugin authors can test their code
5. **CI/CD Ready**: Can integrate with automated build pipelines

### Trade-offs

1. **No Test Discovery**: Tests must be explicitly registered with `deftest`
2. **No Test Isolation**: All tests run in same environment
3. **Limited Reporting**: Only pass/fail, no detailed diagnostics
4. **No Mocking**: No built-in support for mocks or stubs
5. **Synchronous Only**: No async test support in MVP

### Future Considerations

1. **Test Suites**: Group related tests into suites
2. **Before/After Hooks**: Setup/teardown for tests
3. **Test Isolation**: Each test gets fresh environment
4. **Async Testing**: Support for async/cancel testing
5. **Coverage Reporting**: Track which code is tested
6. **Parametrized Tests**: Run same test with different inputs

### Testing

Created `test/unit/test-tlisp-testing-framework.test.ts`:
- Verify `deftest` registers test cases
- Verify `test-run` executes tests and returns results
- Verify `test-run-all` runs all tests and reports statistics
- Verify test failures don't crash the framework
- Verify assertion failures are reported correctly
