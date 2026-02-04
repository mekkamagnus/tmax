# Fixtures System

## Status

Accepted

## Context

Tests often need common setup data (fixtures). Without fixtures:
- Each test duplicated setup code
- Changes to setup required updating many tests
- Tests became verbose and hard to read
- No shared test data infrastructure

## Decision

Implement a fixtures system for reusable test data and setup:

### Fixture Definition

```lisp
(deffixture sample-buffer
  "Create a sample buffer for testing"
  (let ((buf (buffer-create "test.txt")))
    (buffer-insert buf 0 0 "Hello, World!")
    buf))
```

### Fixture Usage

```lisp
(deftest test-buffer-operations
  (with-fixture sample-buffer (buf)
    (assert-equal (buffer-text buf) "Hello, World!")
    (buffer-insert buf 0 5 "Test")
    (assert-contains (buffer-text buf) "Test")))
```

### Fixture Lifecycle

1. **Definition**: `deffixture` defines fixture with setup/teardown
2. **Usage**: `with-fixture` creates and destroys fixture
3. **Cleanup**: Fixture cleanup runs even if test fails
4. **Scoping**: Fixture variables scoped to test body

### Implementation

Created fixture system in `src/tlisp/test-framework.ts`:

```typescript
interface Fixture {
  name: string;
  setup: BuiltinFunction;
  teardown?: BuiltinFunction;
}

export const withFixture = (
  env: Environment,
  args: Expression[]
): Expression => {
  const [fixtureName, body] = args;
  const fixture = fixtureRegistry.get(fixtureName.value);

  // Run setup
  const fixtureValue = fixture.setup(env, []);

  try {
    // Run test body with fixture value
    const testEnv = createChildEnvironment(env);
    testEnv.define(body.value[0].value, fixtureValue);
    return evaluate(body, testEnv);
  } finally {
    // Run teardown
    if (fixture.teardown) {
      fixture.teardown(env, [fixtureValue]);
    }
  }
};
```

### Built-in Fixtures

```lisp
;; Empty buffer fixture
(deffixture empty-buffer
  (buffer-create "test.txt"))

;; Sample text fixture
(deffixture sample-text
  (let ((buf (buffer-create "sample.txt")))
    (buffer-insert buf 0 0 "Line 1\nLine 2\nLine 3")
    buf))
```

## Consequences

### Benefits

1. **Reduced Duplication**: Setup code defined once
2. **Readability**: Tests focus on behavior, not setup
3. **Maintainability**: Fixture changes propagate to all tests
4. **Resource Management**: Automatic cleanup prevents leaks
5. **Composability**: Fixtures can use other fixtures

### Trade-offs

1. **Complexity**: Additional abstraction layer to learn
2. **Debugging**: Fixture failures can obscure test failures
3. **Performance**: Fixture setup/teardown overhead
4. **State Sharing**: Fixtures can introduce hidden dependencies

### Future Considerations

1. **Nested Fixtures**: Use multiple fixtures in one test
2. **Fixture Parameters**: Configure fixtures with arguments
3. **Lazy Fixtures**: Load fixtures only when needed
4. **Shared Fixtures**: Fixtures defined in external files
5. **Fixture Inheritance**: Extend and modify existing fixtures
6. **Async Fixtures**: Support async setup/teardown

### Testing

Created `test/unit/test-tlisp-testing-framework.test.ts`:
- Fixtures are created and destroyed correctly
- Fixture cleanup runs even on test failure
- Fixtures work with nested tests
- Multiple fixtures can be used in same test
- Fixture values are scoped correctly
