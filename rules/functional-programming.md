---
scope: src/**/*.ts
---

# Functional Programming Rules

Applies to all TypeScript source files in `src/`.

## Core Foundation

- **Task-Based Operations**: Wrap all operations in task objects that can be composed and chained
- **Favor Task Over Promises**: Use `Task` instead of `Promise` for lazy evaluation and better error handling
- **TaskEither for Error Handling**: Use `TaskEither` utility for combining lazy evaluation with explicit error types
- **TryCatch Error Handling**: Use `tryCatch` methods for safe error handling without throwing exceptions
- **Immutable State**: Prefer immutable data structures and pure functions
- **Function Composition**: Chain operations using compose/pipe patterns
- **Composition Over Inheritance**: Favor object composition over class inheritance for flexibility and testability
- **Result Types**: Return `Result<T, E>` objects instead of throwing exceptions
- **Option Types**: Use `Option<T>` for nullable values instead of null/undefined checks

## Type Reference

- `Option<T>` — nullable values (`Some(value) | None`)
- `Either<L, R>` — error handling (`Left(error) | Right(success)`)
- `TaskEither<E, T>` — async operations with error handling
- `Result<T, E>` — success/failure without exceptions

## Task Over Promise

```typescript
// AVOID: Promise-based (eager evaluation, uncaught errors)
const loadFilePromise = async (path: string): Promise<string> => {
  try {
    return await Bun.file(path).text(); // Executes immediately
  } catch (error) {
    throw new Error(`Failed to load file: ${error.message}`); // Can be uncaught
  }
};

// PREFER: Task-based (lazy evaluation, safe error handling)
const loadFileTask = (path: string) => Task.of(() =>
  Bun.file(path).text() // Only executes when run
).tryCatch(error =>
  `Failed to load file: ${error.message}` // Always caught
);
```

## Task Pattern Examples

```typescript
// File operations using task pattern with tryCatch
const processFileTask = (path: string) =>
  loadFileTask(path)
    .map(content => content.split('\n'))
    .map(lines => lines.filter(line => line.trim().length > 0))
    .tryCatch(error =>
      `Failed to process file: ${error}`
    );

// Terminal operations with safe error handling
const terminalWriteTask = (text: string) => Task.of(() =>
  terminal.write(text)
).tryCatch(error =>
  `Terminal write failed: ${error.message}`
);

// Task composition for complex operations
const saveBufferTask = (buffer: Buffer) =>
  validateBufferTask(buffer)
    .andThen(() => backupFileTask(buffer.path))
    .andThen(() => writeFileTask(buffer.path, buffer.content))
    .tryCatch(error => `Save failed: ${error}`);
```

## TaskEither Pattern Examples

```typescript
import { TaskEither, TaskEitherUtils } from "../src/utils/task-either.ts";

// File operations with explicit error types
const loadConfigTask = (path: string): TaskEither<string, Config> =>
  TaskEitherUtils.readFile(path)
    .flatMap(content => TaskEitherUtils.parseJSON<Config>(content))
    .mapLeft(error => `Config load failed: ${error}`);

// Composing operations with error handling
const saveWithBackupTask = (path: string, content: string) =>
  TaskEitherUtils.readFile(path)
    .flatMap(current => TaskEitherUtils.writeFile(`${path}.backup`, current))
    .flatMap(() => TaskEitherUtils.writeFile(path, content))
    .map(() => ({ saved: true, backupCreated: true }))
    .mapLeft(error => `Save operation failed: ${error}`);

// Parallel operations with TaskEither
const loadProjectTask = (projectPath: string) => {
  const configFile = TaskEitherUtils.readFile(`${projectPath}/config.json`);
  const mainFile = TaskEitherUtils.readFile(`${projectPath}/main.ts`);

  return TaskEither.parallel([configFile, mainFile])
    .map(([config, main]) => ({ config: JSON.parse(config), main }));
};

// Retry operations with exponential backoff
const saveWithRetryTask = (path: string, content: string) =>
  TaskEitherUtils.retry(
    () => TaskEitherUtils.writeFile(path, content),
    3, // max attempts
    1000 // delay ms
  );
```

## Result Pattern Examples

```typescript
// Function that returns Result instead of throwing
const parseConfig = (content: string): Result<Config, string> => {
  try {
    const parsed = JSON.parse(content);
    return Result.ok(parsed);
  } catch (error) {
    return Result.error(`Invalid JSON: ${error.message}`);
  }
};

// Chaining operations with Result
const loadAndParseConfig = (path: string): Result<Config, string> =>
  loadFileTask(path)
    .toResult()
    .andThen(parseConfig)
    .mapError(error => `Config loading failed: ${error}`);
```

## Advanced Patterns

### Pipeline Composition

```typescript
// PREFER: Clean pipeline composition
const saveCurrentBufferPipeline = (filename?: string): TaskEither<SaveError, void> =>
  pipe
    .from(validateCurrentBuffer())
    .step(buffer => determineTargetFilename(buffer, filename))
    .step(filename => validateFilePath(filename))
    .tap(path => logDebug(`Saving to: ${path}`))
    .step(path => createDirectoryIfNeeded(path).map(() => path))
    .step(path => writeFileContent(path))
    .effect(path => updateStatusMessage(`Saved ${path}`))
    .map(() => void 0)
    .build();

// AVOID: Deep nesting
return validateBuffer()
  .flatMap(buffer =>
    determineFilename(buffer)
      .flatMap(filename =>
        validatePath(filename)
          .flatMap(path => saveFile(path))
      )
  );
```

### Reader Monad (Dependency Injection)

```typescript
interface SaveDependencies {
  readonly filesystem: FileSystem;
  readonly currentBuffer: TextBuffer | null;
  readonly logger: Logger;
}

// PREFER: Dependency injection with Reader
const saveCurrentBufferReader = (filename?: string): ReaderTaskEither<SaveDependencies, SaveError, void> =>
  ReaderTaskEither.ask<SaveDependencies, SaveError>()
    .flatMap(deps => validateBufferReader(deps.currentBuffer))
    .flatMap(buffer => determineFilenameReader(buffer, filename))
    .flatMap(resolvedFilename => writeFileReader(resolvedFilename));

// Usage with injected dependencies
const result = await saveCurrentBufferReader("test.txt")
  .run(dependencies)
  .run();

// AVOID: Direct state access
this.state.currentBuffer
this.state.filesystem.writeFile()
```

### State Monad (Immutable State)

```typescript
// PREFER: Immutable state updates
const updateStatusMessage = (message: string): State<EditorState, void> =>
  State.modify(state => ({
    ...state,
    statusMessage: message
  }));

const saveWithStateUpdates = (filename: string): StateTaskEither<EditorState, SaveError, void> =>
  StateTaskEither.get<EditorState, SaveError>()
    .flatMap(state => StateTaskEither.lift(writeFileContent(filename, state.currentBuffer?.getContent())))
    .flatMap(() => StateTaskEither.modify<EditorState, SaveError>(state => ({
      ...state,
      statusMessage: `Saved ${filename}`,
      buffers: new Map(state.buffers).set(filename, state.currentBuffer!)
    })));

// AVOID: Direct state mutation
this.state.statusMessage = `Saved ${resolvedPath}`;
this.state.buffers.set(resolvedPath, buffer);
```

### Validation Applicative (Error Accumulation)

```typescript
// PREFER: Collect all validation errors
const validateSaveRequest = (
  buffer: TextBuffer | null,
  filename: string | undefined,
  path: string
): Validation<SaveError, SaveRequest> => {

  const bufferValidation = buffer
    ? Validation.success(buffer)
    : Validation.failure<SaveError, TextBuffer>("NO_BUFFER");

  const filenameValidation = filename
    ? Validation.success(filename)
    : Validation.failure<SaveError, string>("NO_FILENAME");

  const pathValidation = validatePathSyntax(path);

  // Combines all validations - collects ALL errors
  return lift3((buffer: TextBuffer) => (filename: string) => (path: string): SaveRequest =>
    ({ buffer, filename, path })
  )(bufferValidation)(filenameValidation)(pathValidation);
};

// AVOID: Sequential validation (fails fast)
validateBuffer()
  .flatMap(determineFilename)
  .flatMap(validatePath) // Stops here if buffer validation fails
```

## Error Handling Summary

- **Task-based**: Use `Task.tryCatch()` for operations that may fail
- **Result types**: Return `Result<T, E>` instead of throwing exceptions
- **Option types**: Use `Option<T>` for potentially missing values
- **Centralized logging**: All errors logged via centralized logger
- **Different log levels**: Based on error type and severity
- **Graceful degradation**: User feedback with recovery options
- **Error Accumulation**: Use Validation patterns to collect all errors
- **Effect System**: Controlled side effects with explicit error handling
- **Centralized error types**: Discriminated unions from `src/error/types.ts` (`BufferError`, `FileSystemError`, `TerminalError`, `ValidationError`, `ConfigError`)
- **Validation utilities**: `src/utils/validation.ts` for common checks (`validateArgsCount`, `validateArgType`, etc.)
