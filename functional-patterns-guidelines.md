# Functional Programming Guidelines for tmax

## Overview

This document provides a comprehensive guide to the functional programming patterns, rules, and best practices used in the tmax project. Adhering to these guidelines ensures a maintainable, testable, and robust codebase.

## Core Principles

1.  **Declarative Over Imperative**: Define *what* you want to achieve, not *how* to do it. Use data structures and functions to represent logic.
2.  **Immutability**: Never mutate state directly. All data structures should be treated as immutable. Operations on data should return new instances.
3.  **Function Composition**: Build complex operations by composing smaller, reusable functions.
4.  **Explicit Error Handling**: No `try...catch` blocks or `throw`ing exceptions for expected errors. Use types like `Either` and `TaskEither` to represent and handle failures explicitly.
5.  **Controlled Side Effects**: Isolate side effects (like file I/O, network requests, or logging) from pure business logic using patterns like `Reader` and `Effect`.

---

## Key Functional Patterns

### 1. Pipeline/Kleisli Composition

**Purpose**: To transform deeply nested `TaskEither` chains into clean, readable, and linear sequences of operations.

**Key Benefits**:
-   Improves readability by avoiding "callback hell" or deep nesting of `.flatMap()` calls.
-   Provides a clear, step-by-step execution flow.
-   Simplifies adding, removing, or reordering operations.

**Example**:

```typescript
import { pipe } from "./utils/pipeline.ts";

const saveFilePipeline = (filename?: string): TaskEither<SaveError, void> =>
  pipe
    .from(validateCurrentBuffer())
    .step(buffer => determineTargetFilename(buffer, filename))
    .step(filename => validateFilePath(filename))
    .tap(path => logDebug(`Saving to: ${path}`))
    .step(path => createDirectoryIfNeeded(path).map(() => path))
    .step(path => writeFileContent(path))
    .effect(path => updateStatusMessage(`Saved ${path}`))
    .recover(error => handleSaveError(error))
    .build();
```

**When to Use**: For any sequence of asynchronous operations that can fail, especially when you would otherwise have multiple nested `.flatMap()` calls.

### 2. Validation Applicative

**Purpose**: To collect all validation errors from a set of checks, rather than failing on the first error.

**Key Benefits**:
-   Provides a much better user experience by showing all errors at once.
-   Makes validation logic composable and reusable.

**Example**:

```typescript
import { Validation, ValidationUtils, lift3 } from "./utils/validation.ts";

const validateSaveRequest = (
  buffer: TextBuffer | null,
  filename: string | undefined,
  path: string
): Validation<SaveError, SaveRequest> => {
  const bufferValidation = ValidationUtils.required(buffer, "NO_BUFFER");
  const filenameValidation = ValidationUtils.required(filename, "NO_FILENAME")
    .flatMap(name => ValidationUtils.nonEmpty(name, "FILENAME_EMPTY"));
  const pathValidation = ValidationUtils.securePath(path);

  // lift3 combines the results, accumulating ALL validation errors
  return lift3((buffer: TextBuffer) => (filename: string) => (path: string): SaveRequest =>
    ({ buffer, filename, path })
  )(bufferValidation)(filenameValidation)(pathValidation);
};

// Usage
const result = validateSaveRequest(buffer, filename, path);
if (result.isFailure()) {
  console.log("All errors:", result.getErrors());
}
```

**When to Use**: For validating user input, configuration, or any scenario where you need to report all failures, not just the first one.

### 3. Lens/Optics System

**Purpose**: To perform focused, immutable updates on complex, nested data structures without manual object spreading.

**Key Benefits**:
-   Eliminates verbose and error-prone `...` spreading for nested objects.
-   Provides a reusable and composable way to access and modify properties.
-   Enhances type safety for deep updates.

**Example**:

```typescript
import { Lens, optics } from "./utils/lens.ts";

interface EditorState {
  readonly metadata: {
    readonly lastSaved: Date;
    readonly editCount: number;
  };
  // ... other properties
}

// Define lenses for clean property access
const metadataLens = Lens.of<EditorState, 'metadata'>('metadata');
const editCountLens = metadataLens.compose(Lens.of<Metadata, 'editCount'>('editCount'));

// Use the lens to modify the nested property
const incrementEditCount = (state: EditorState): EditorState =>
  editCountLens.modify(count => count + 1)(state);
```

**When to Use**: When managing a complex state object, especially one with multiple levels of nesting.

### 4. State Monad

**Purpose**: To manage state transitions in a purely functional and immutable way.

**Key Benefits**:
-   Guarantees that state is never mutated accidentally.
-   Makes state transitions predictable and testable.
-   Allows for composing complex stateful operations from smaller ones.

**Example**:

```typescript
import { State, StateTaskEither, stateUtils } from "./utils/state.ts";

// A pure state operation
const incrementEditCount = (): State<EditorState, void> =>
  stateUtils.modifyProperty('editCount', count => count + 1);

// An async operation that also updates state
const saveWithStateUpdate = (filename: string): StateTaskEither<EditorState, SaveError, void> =>
  StateTaskEither.get<EditorState, SaveError>()
    .flatMap(state => {
      // ... perform save logic ...
      return StateTaskEither.lift(writeFileContent(filename, state.currentBuffer.getContent()))
        .flatMap(() => StateTaskEither.liftState(incrementEditCount()));
    });

// Running the operation returns the new state without mutation
const [result, newState] = saveWithStateUpdate("test.txt").run(currentState);
```

**When to Use**: For critical state management where immutability and predictability are paramount.

### 5. Reader Monad (Dependency Injection)

**Purpose**: To decouple code from its dependencies, making it more modular, reusable, and easier to test.

**Key Benefits**:
-   Eliminates the need for global singletons or passing dependencies through many layers of functions.
-   Makes unit testing trivial by allowing you to inject mock dependencies.

**Example**:

```typescript
import { ReaderTaskEither } from "./utils/reader.ts";

interface SaveDependencies {
  readonly filesystem: { writeFile: (path: string, content: string) => Promise<void>; };
  readonly logger: { info: (message: string) => void; };
}

// This function is pure and declares its dependencies via the Reader type
const saveFile = (path: string, content: string): ReaderTaskEither<SaveDependencies, string, void> =>
  ReaderTaskEither.ask<SaveDependencies, string>()
    .flatMap(deps =>
      ReaderTaskEither.lift(
        TaskEither.tryCatch(
          () => deps.filesystem.writeFile(path, content),
          error => `Write failed: ${error}`
        )
      )
    )
    .tap(() => ReaderTaskEither.asks(deps => deps.logger.info(`Saved ${path}`)));

// In tests, provide mock dependencies
const mockDeps: SaveDependencies = {
  filesystem: { writeFile: async () => {} },
  logger: { info: () => {} },
};
const result = await saveFile("test.txt", "content").run(mockDeps).run();
```

**When to Use**: For any code that has external dependencies like filesystems, network services, or loggers.

### 6. Effect System

**Purpose**: To provide the ultimate control over side effects, combining dependency injection, error handling, and resource management into a single, powerful abstraction.

**Key Benefits**:
-   Makes side effects explicit and controlled.
-   Provides robust error handling, including retries and timeouts.
-   Ensures resources (like file handles) are managed safely.

**Example**:

```typescript
import { Effect, effectPipe } from "./utils/effect.ts";

interface OperationDeps {
  readonly filesystem: FileSystem;
  readonly logger: Logger;
}

// Define pure descriptions of effects
const writeFileEffect = (path: string, content: string): Effect<OperationDeps, string, void> =>
  Effect.tryCatch(
    deps => deps.filesystem.writeFile(path, content),
    error => `Write failed: ${error}`
  );

const logInfo = (message: string): Effect<OperationDeps, never, void> =>
  Effect.sideEffect(deps => deps.logger.info(message));

// Compose effects into a complete operation
const saveOperation = (filename: string, content: string): Effect<OperationDeps, string, void> =>
  effectPipe
    .from(logInfo(`Starting save: ${filename}`))
    .flatMap(() => writeFileEffect(filename, content))
    .retry(3) // Automatically retry on failure
    .tap(() => logInfo(`Save completed: ${filename}`))
    .build();

// Execute the effect by providing dependencies
const dependencies: OperationDeps = { /* ... */ };
const result = await saveOperation("test.txt", "content")(dependencies).run();
```

**When to Use**: For complex operations with multiple side effects, especially those requiring advanced features like retries, timeouts, or resource management.

---

## Best Practices

### Code Organization
1.  **Separate Pure and Impure Code**: Keep functions that perform side effects separate from your pure business logic. The `Effect` and `Reader` patterns are the primary tools for this.
2.  **Compose Small Functions**: Build complex logic by creating small, focused functions and composing them together. The `pipe` utility is excellent for this.
3.  **Define Clear Dependency Interfaces**: When using the `Reader` or `Effect` patterns, define clear, minimal interfaces for your dependencies.

### Error Handling
1.  **Use `Validation` for User Input**: Provide comprehensive feedback on all errors in user-provided data.
2.  **Use `TaskEither` for Failable Operations**: Represent any asynchronous operation that can fail with a `TaskEither`.
3.  **Design Actionable Error Types**: Create specific, meaningful error types (e.g., `SaveError`, `NetworkError`) instead of using generic strings or `Error` objects.

### Replacing Guard Clauses
Instead of imperative `if` statements, use functional patterns:
-   **Array + find**: A declarative, data-driven approach for pattern matching.
-   **Option/Maybe Chaining**: Use `.orElse()` to create a chain of attempts that short-circuits on the first success.
-   **Reduce**: A purely functional way to process a list of parsers or checkers.

---

## Migration Guide

To adopt these patterns, follow this general path:

1.  **Start with `pipe`**: Identify nested `.flatMap()` chains and convert them to a `pipe`. This is a low-risk change that immediately improves readability.
2.  **Introduce `Validation`**: For user input or configuration, replace sequential checks that fail fast with the `Validation` applicative to accumulate all errors.
3.  **Use `Lens` for State**: When you find complex, nested object spreading (`...`), create `Lens`es to simplify the updates.
4.  **Refactor to `Reader`**: For new features or when refactoring, use the `Reader` monad to inject dependencies instead of accessing them directly.
5.  **Adopt `State` for Critical Logic**: For core state management, migrate to the `State` monad to ensure immutability.
6.  **Use `Effect` for Complex Side Effects**: For operations that require advanced control (retries, timeouts, etc.), use the full `Effect` system.

---

## Testing Strategies

-   **Test Pure Functions**: Your core logic should be in pure functions that are easy to test with simple inputs and outputs.
-   **Mock Dependencies with `Reader`**: When testing code that uses the `Reader` pattern, simply create a mock object that conforms to the dependency interface and pass it to the `.run()` method.
-   **Test `Validation` Logic**: Ensure both success and failure cases are tested. For failure cases, assert that *all* expected errors are present.
-   **Verify `Lens` Laws**: For complex lenses, you can write property-based tests to ensure they follow the lens laws (get-set, set-get).
-   **Test `State` Transitions**: Run the state operation with an initial state and assert that the new state is correct and that the original state was not mutated.
