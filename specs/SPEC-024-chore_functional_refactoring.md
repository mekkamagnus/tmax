# Chore: Functional Programming Refactoring and Code Cleanup - Bun Migration

## Chore Description
Refactor the tmax codebase to use strict functional programming patterns with centralized error handling while **migrating from Deno to Bun runtime**. This involves:

1. **Migrate runtime from Deno to Bun** - Replace all Deno-specific APIs with Node/Bun compatible APIs
2. **Eliminate all `throw` statements** - Replace with Either/TaskEither patterns for explicit error handling
3. **Remove all `any` types** - Replace with proper TypeScript types and discriminated unions
4. **Consolidate duplicate interfaces** - Merge FunctionalTextBuffer and other duplicated definitions
5. **Remove legacy wrapper classes** - Delete unused TextBufferImpl and GapBuffer wrapper classes
6. **Standardize on functional patterns** - Use Task, Either, TaskEither, Reader, Option consistently
7. **Create centralized error handling** - Build unified error types and handlers
8. **Refactor large functions** - Split createEditorAPI() and handleKey() into smaller composable functions
9. **Clean up unused files** - Remove debug artifacts, completed specs, and backup directories
10. **Add constants for magic numbers** - Replace hardcoded values with named constants
11. **Standardize error handling patterns** - Use Either for sync, TaskEither for async consistently
12. **Replace Deno stdlib imports** - Use Node/Bun compatible imports from npm

The goal is to achieve a codebase that is:
- **Bun-based** - Runs on Bun runtime with plain TypeScript (no Deno dependencies)
- **Type-safe** - Zero `any` types, full TypeScript strict mode compliance
- **Functional** - Pure functions, immutable data, composable operations
- **Explicit** - No exceptions, all errors handled via Either/TaskEither
- **Maintainable** - Small functions, clear responsibilities, DRY code

## Relevant Files

### Core Files to Refactor
- `src/editor/tlisp-api.ts` - Replace throw errors with Either pattern, split into modules
- `src/editor/editor.ts` - Remove `any` types, refactor handleKey(), fix mode setter type
- `src/core/buffer.ts` - Remove duplicate FunctionalTextBuffer interface, delete legacy wrappers
- `src/core/types.ts` - Consolidate duplicate interface definitions
- `src/tlisp/repl.ts` - Replace multiple `any` types with proper types
- `src/core/filesystem.ts` - Migrate from Promise to TaskEither pattern
- `src/frontend/types.ts` - Replace `any` in event listener types

### Functional Utility Files (Enhance)
- `src/utils/task-either.ts` - Add tap/chain methods, enhance utility functions
- `src/utils/reader.ts` - Already well-implemented, may need minor enhancements
- `src/utils/validation.ts` - Review for consistency
- `src/utils/` - Evaluate reader.ts, effect.ts, state.ts for actual usage

### New Files to Create
- `src/utils/option.ts` - Option<T> type for nullable values (does not exist)
- `src/error/types.ts` - Centralized error type definitions
- `src/error/handlers.ts` - Centralized error handling utilities
- `src/constants/buffer.ts` - Buffer-related constants (e.g., DEFAULT_BUFFER_SIZE)
- `src/editor/api/buffer-ops.ts` - Buffer operations module
- `src/editor/api/cursor-ops.ts` - Cursor operations module
- `src/editor/api/mode-ops.ts` - Mode operations module
- `src/editor/api/file-ops.ts` - File operations module

### Files to Remove
- `deno.json` - Deno configuration (Bun uses package.json)
- `deno.lock` - Deno lock file (Bun uses bun.lockb)
- `import_map.json` - Deno import maps (use npm/local imports)
- `backups/original-core/*.ts` - Old implementation backups
- `debug-test.txt`, `manual-test.txt`, `mode-capture.txt` - Debug artifacts
- `scripts/debug-*.ts` - Debug scripts (review first)
- Completed specs that can be archived (review SPECS_INDEX.md)
- `src/core/buffer.ts` - Remove TextBufferImpl (lines 558-652) and GapBuffer (lines 661-729)
- Any remaining Deno-specific configuration files

### Test Files to Update
- All test files: Convert from Deno test syntax to Bun test syntax
- Replace `Deno.test()` with `describe()`/`test()` from `bun:test`
- Replace `assertEquals` from `@std/assert` with `expect()` from `bun:test`
- Update all `import { assertEquals } from "https://deno.land/std/..."` imports
- All test files using implicit `any` types
- Add tests for new functional error handling patterns

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Phase 0: Deno → Bun Runtime Migration

#### 0.1 Replace Deno with Bun in package.json
- Update all scripts to use `bun` instead of `deno`
- Add Bun-specific configuration
- Remove Deno configuration files (deno.json, deno.lock)

#### 0.2 Replace Deno standard library imports
- Replace all `https://deno.land/std/*` imports with npm packages
- Replace `Deno.readTextFile()` with `Bun.file()` or Node `fs/promises`
- Replace `Deno.writeTextFile()` with `Bun.write()` or Node `fs/promises`
- Replace `Deno.stdin`, `Deno.stdout` with Node `process.stdin`, `process.stdout`
- Update terminal I/O to use Node/Bun compatible APIs

#### 0.3 Update file system operations
- Replace `Deno.readTextFile(path)` with `Bun.file(path).text()` or `fs.readFileSync(path, 'utf-8')`
- Replace `Deno.writeTextFile(path, content)` with `Bun.write(path, content)` or `fs.writeFileSync(path, content, 'utf-8')`
- Replace `Deno.mkdir()` with `fs.mkdir()` or `Bun.$fs.mkdir()`
- Replace `Deno.stat()` with `fs.stat()` or `Bun.$fs.stat()`
- Replace `Deno.remove()` with `fs.rm()` or `Bun.$fs.unlink()`

#### 0.4 Update terminal operations
- Replace Deno terminal APIs with Node/Bun compatible alternatives
- Use `node-pty` or similar for terminal control
- Update raw mode handling for Bun
- Replace ANSI escape code handling with cross-platform solution

#### 0.5 Update import maps and module resolution
- Remove `import_map.json` (Deno-specific)
- Update all imports to use relative paths or npm packages
- Configure `tsconfig.json` for Bun/Node module resolution
- Update all `https://` imports to local relative imports or npm packages

### Phase 1: Foundation - Create Functional Primitives

#### 1.1 Create Option<T> type for nullable values
- Create `src/utils/option.ts` with Option<T> type (Some, None)
- Implement map, flatMap, fold, getOrElse methods
- Add utility functions: fromNullable, fromNull, fromUndefined
- Add tests in `test/unit/option.test.ts` using Bun test

#### 1.2 Create centralized error type system
- Create `src/error/types.ts` with discriminated union of all error types:
  - `BufferError` - Buffer operation errors
  - `FileSystemError` - File system errors
  - `TerminalError` - Terminal I/O errors
  - `ValidationError` - Input validation errors
  - `ConfigError` - Configuration errors
- Create `src/error/handlers.ts` with error formatting and logging utilities
- Add error code constants for consistent error messages

#### 1.3 Create constants file for magic numbers
- Create `src/constants/buffer.ts` with:
  - `DEFAULT_BUFFER_SIZE = 64`
  - `BUFFER_GROWTH_FACTOR = 2`
  - `MAX_BUFFER_SIZE`
- Create `src/constants/terminal.ts` with terminal-related constants
- Create `src/constants/editor.ts` with editor configuration defaults

#### 1.4 Enhance TaskEither utility methods
- Add `tap()` method for side effects in the success chain
- Add `tapError()` method for side effects in the error chain
- Add `chainIf()` for conditional chaining
- Add `fromPromise()` constructor for Promise → TaskEither conversion
- Add `swap()` to convert Either<L, R> to Either<R, L>

### Phase 2: Consolidate Duplicate Interfaces

#### 2.1 Merge FunctionalTextBuffer interface definitions
- Keep definition in `src/core/types.ts` (lines 52-76)
- Remove duplicate from `src/core/buffer.ts` (lines 22-46)
- Update all imports to use single definition from `src/core/types.ts`

#### 2.2 Review and consolidate other type definitions
- Check for other duplicate interfaces across the codebase
- Consolidate into canonical locations
- Update all imports

### Phase 3: Replace throw Errors with Either Pattern

#### 3.1 Refactor src/editor/tlisp-api.ts error handling
- Replace all `throw new Error()` with `Either.left(errorValue)`
- Update function signatures to return `Either<ErrorType, TLispValue>`
- Example transformation:
  ```typescript
  // Before
  api.set("buffer-create", (args: TLispValue[]): TLispValue => {
    if (args.length !== 1) {
      throw new Error("buffer-create requires exactly 1 argument: name");
    }
    // ...
  });

  // After
  api.set("buffer-create", (args: TLispValue[]): TLispValue => {
    const validation = validateArgsCount(args, 1);
    if (Either.isLeft(validation)) {
      return validation; // Return Either instead of throwing
    }
    // ...
  });
  ```

#### 3.2 Create validation utilities for common patterns
- Create `src/utils/validation.ts` with:
  - `validateArgsCount(args: TLispValue[], expected: number): Either<ValidationError, void>`
  - `validateArgType(arg: TLispValue, type: string): Either<ValidationError, TLispValue>`
  - `validateBufferExists(state: TlispEditorState): Either<ValidationError, FunctionalTextBuffer>`
  - `validateFilePath(path: string): Either<ValidationError, string>`
- Use these validators consistently across all API functions

#### 3.3 Refactor src/tlisp/evaluator.ts error handling
- Replace `throw new Error()` in evaluation with Either returns
- Update evaluator signature to return `Either<EvalError, TLispValue>`
- Adjust all call sites to handle Either results

#### 3.4 Refactor src/tlisp/parser.ts error handling
- Replace `throw new Error()` in parsing with Either returns
- Update parser signature to return `Either<ParseError, TLispAST>`
- Adjust all call sites

#### 3.5 Refactor src/tlisp/tokenizer.ts error handling
- Replace `throw new Error()` in tokenization with Either returns
- Update tokenizer signature to return `Either<TokenizeError, Token[]>`
- Adjust all call sites

### Phase 4: Replace `any` Types with Proper Types

#### 4.1 Fix src/editor/editor.ts type issues
- Replace `set mode(v: any)` at line 100 with proper union type:
  ```typescript
  set mode(v: EditorMode) { editor.state.mode = v; }
  ```
- Define `type EditorMode = 'normal' | 'insert' | 'visual' | 'command' | 'mx';`
- Replace `executeCommand(command: string): any` with proper return type
- Fix all other `any` types in this file

#### 4.2 Fix src/tlisp/repl.ts type issues
- Replace all `any` types with proper types
- Define proper interfaces for REPL state and commands
- Add JSDoc comments for clarity

#### 4.3 Fix src/frontend/types.ts type issues
- Replace `any` in event listener type definitions
- Define proper event types as discriminated unions
- Example:
  ```typescript
  // Before
  onEvent: (event: any) => void;

  // After
  onEvent: (event: KeyEvent | MouseEvent | ResizeEvent) => void;
  ```

#### 4.4 Fix src/core/filesystem.ts type issues
- Replace any `any` types with proper error types
- Update Promise-based methods to TaskEither pattern (Phase 5)

#### 4.5 Create comprehensive type definition file
- Create `src/types/index.ts` exporting all common types
- Define types for:
  - `EditorMode` - Discriminated union of all modes
  - `KeySequence` - Type for key combinations
  - `CommandResult` - Result type for command execution
  - `BufferState` - Buffer state representation
  - `ViewportState` - Viewport state representation

### Phase 5: Migrate from Promise to TaskEither Pattern

#### 5.1 Refactor src/core/filesystem.ts to use TaskEither with Bun APIs
- Change all methods from `Promise<T>` to `TaskEither<FileSystemError, T>`
- Update interface: `FunctionalFileSystem` (already defined in types.ts)
- Replace Deno APIs with Bun/Node compatible APIs
- Implement TaskEither versions of all operations
- Example:
  ```typescript
  // Before (Deno)
  async readFile(path: string): Promise<string> {
    try {
      return await Deno.readTextFile(path);
    } catch (error) {
      throw new Error(`Failed to read ${path}: ${error.message}`);
    }
  }

  // After (Bun)
  import { readTextFile } from "node:fs/promises";

  readFile(path: string): TaskEither<FileSystemError, string> {
    return TaskEither.tryCatch(
      () => readTextFile(path, 'utf-8'),
      (error) => ({ type: 'read-error', path, message: String(error) })
    );
  }

  // OR using Bun-specific API:
  readFile(path: string): TaskEither<FileSystemError, string> {
    return TaskEither.tryCatch(
      () => Bun.file(path).text(),
      (error) => ({ type: 'read-error', path, message: String(error) })
    );
  }
  ```

#### 5.2 Update all filesystem call sites
- Replace Promise-based calls with TaskEither
- Use flatMap/andThen for chaining operations
- Handle errors with mapLeft/fold instead of try/catch

#### 5.3 Refactor src/core/terminal.ts to use TaskEither
- Change all async methods from `Promise<void>` to `TaskEither<TerminalError, void>`
- Update to `FunctionalTerminalIO` interface (already defined)
- Keep sync methods using Either

#### 5.4 Update all terminal call sites
- Replace Promise-based calls with TaskEither
- Handle errors explicitly

### Phase 6: Split Large Functions into Modules

#### 6.1 Split createEditorAPI() into functional modules
- Create `src/editor/api/buffer-ops.ts`:
  - `buffer-create`, `buffer-switch`, `buffer-current`, `buffer-list`
  - `buffer-text`, `buffer-line`, `buffer-line-count`
- Create `src/editor/api/cursor-ops.ts`:
  - `cursor-position`, `cursor-move`, `cursor-line`, `cursor-column`
- Create `src/editor/api/mode-ops.ts`:
  - `editor-mode`, `editor-set-mode`, `editor-status`, `editor-set-status`
- Create `src/editor/api/file-ops.ts`:
  - `file-read`, `file-write`, `editor-quit`
- Create `src/editor/api/bindings-ops.ts`:
  - `key-bind`, `execute-command`
- Update `src/editor/tlisp-api.ts` to import and compose these modules

#### 6.2 Split handleKey() into mode-specific handlers
- Create `src/editor/handlers/normal-handler.ts`
- Create `src/editor/handlers/insert-handler.ts`
- Create `src/editor/handlers/visual-handler.ts`
- Create `src/editor/handlers/command-handler.ts`
- Create `src/editor/handlers/mx-handler.ts`
- Update `handleKey()` to dispatch to appropriate handler using pattern matching

#### 6.3 Extract loadCoreBindings() logic
- Extract path resolution into separate function
- Extract binding loading into separate function
- Extract fallback logic into separate function
- Compose these functions in loadCoreBindings()

### Phase 7: Remove Legacy Code and Unused Files

#### 7.1 Remove legacy wrapper classes from src/core/buffer.ts
- Delete `TextBufferImpl` class (lines 558-652)
- Delete `GapBuffer` class (lines 661-729)
- Verify no code references these classes
- Run tests to confirm

#### 7.2 Remove backup directory
- Delete `backups/original-core/` directory
- Verify no code references these files

#### 7.3 Remove debug artifacts
- Delete `debug-test.txt`, `manual-test.txt`, `mode-capture.txt`
- Review and delete unused `scripts/debug-*.ts` files

#### 7.4 Archive completed specs
- Review `specs/SPECS_INDEX.md` to identify completed specs
- Move completed specs to `specs/archive/` directory
- Update SPECS_INDEX.md

#### 7.5 Remove node_modules from git tracking
- Verify `.gitignore` includes `node_modules/`
- Remove from git if tracked

### Phase 8: Standardize Error Handling Patterns

#### 8.1 Create error handling style guide
- Document when to use Either (sync operations)
- Document when to use TaskEither (async operations)
- Document when to use Option (nullable values)
- Document error type naming conventions
- Document error message formatting

#### 8.2 Apply consistent error handling across codebase
- Review all functions for error handling consistency
- Ensure sync errors use Either
- Ensure async errors use TaskEither
- Ensure nullables use Option
- Update code style guide documentation

#### 8.3 Create error handling examples
- Create `examples/functional-error-handling.ts`
- Show common patterns:
  - Validation with Either
  - Async operations with TaskEither
  - Nullable handling with Option
  - Error recovery and retry
  - Error logging and telemetry

### Phase 9: Update Tests for Functional Patterns

#### 9.1 Update unit tests to handle Either/TaskEither returns
- Instead of expecting errors to be thrown, expect Either.left
- Use `Either.isLeft()` and `Either.isRight()` for assertions
- Test both success and error paths
- Example:
  ```typescript
  // Before
  expect(() => bufferCreate([])).toThrow("requires exactly 1 argument");

  // After
  const result = bufferCreate([]);
  assertEquals(Either.isLeft(result), true);
  assertEquals(result.left, "requires exactly 1 argument");
  ```

#### 9.2 Add tests for new functional utilities
- Add tests for Option type in `test/unit/option.test.ts`
- Add tests for centralized error handlers
- Add tests for validation utilities
- Add tests for new constants

#### 9.3 Add integration tests for error flows
- Test error propagation across module boundaries
- Test error recovery patterns
- Test user-facing error messages
- Test error logging

### Phase 10: Documentation and Style Guide Updates

#### 10.1 Update CLAUDE.md with new patterns and Bun runtime
- Document that tmax now runs on **Bun runtime** (not Deno)
- Update all references from "Use deno" to "Use bun"
- Update testing commands to use `bun test`
- Document Option<T> usage
- Document centralized error types
- Document when to use Each pattern (Either, TaskEither, Option)
- Update examples to use new patterns with Bun APIs
- Add "Error Handling" section with best practices
- Add "Bun Migration Notes" section with API replacements

#### 10.2 Update functional-patterns-guidelines.md
- Add Section: "Option Pattern for Nullable Values"
- Add Section: "Centralized Error Type System"
- Add Section: "Error Recovery Strategies"
- Update all examples to use consistent patterns

#### 10.3 Create migration guide
- Document how to migrate from throw to Either
- Document how to migrate from Promise to TaskEither
- Document how to migrate from null checks to Option
- Include before/after examples

#### 10.4 Update README.md with Bun runtime information
- Update all runtime references from Deno to Bun
- Update installation instructions to use `bun install` instead of `deno install`
- Update test commands in usage section to use `bun test`
- Update development commands to use `bun run` instead of `deno task`
- Add Bun to prerequisites section
- Update all command examples from `deno task start` to `bun run start`
- Update REPL command from `deno task repl` to `bun run repl`
- Add note about Bun being the primary runtime
- Remove or update any Deno-specific setup instructions

#### 10.5 Remove Deno configuration files
- Delete `deno.json` - No longer needed with Bun
- Delete `deno.lock` - No longer needed with Bun
- Delete `import_map.json` - Deno-specific, use npm/local imports instead
- Delete `deno.jsonc` if present
- Update `.gitignore` to ignore `node_modules/` and `bun.lockb` if not already present

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

### Type Safety Validation
- `bun run tsc --noEmit` - Run TypeScript type checking on all source files (0 errors expected)
- `grep -r ": any" src/ --include="*.ts" | wc -l` - Verify no `any` types remain in source files

### Test Validation
- `bun test` - Run all 131+ tests (100% pass rate expected)
- `bun test test/unit/option.test.ts` - Run new Option type tests
- `bun test test/unit/functional-patterns.test.ts` - Run functional patterns tests

### Linting and Formatting
- `bun run lint` - Run linter (0 errors expected) if configured, or use `eslint`
- `bun run format:check` - Check code formatting (no changes expected) if configured
- `prettier --check "src/**/*.ts"` - Alternative formatting check

### Error Handling Validation
- `grep -r "throw new Error" src/ --include="*.ts" | wc -l` - Should return 0 (no throw statements in src/)
- `grep -r "try {" src/ --include="*.ts" | wc -l` - Should be minimal (only for TaskEither.tryCatch)
- `grep -r "catch" src/ --include="*.ts" | wc -l` - Should be minimal (only for TaskEither.tryCatch)

### Deno Removal Validation
- `grep -r "from \"https://deno.land" src/ --include="*.ts" | wc -l` - Should return 0 (no Deno imports)
- `grep -r "Deno\." src/ --include="*.ts" | wc -l` - Should return 0 (no Deno API usage)
- `ls deno.json deno.lock 2>/dev/null && echo "DENGO FILES EXIST" || true` - Should show no Deno config files

### Type Validation
- `grep -r ": any" src/ --include="*.ts" | wc -l` - Should return 0 (no `any` types in src/)
- `grep -r "any\[" src/ --include="*.ts" | wc -l` - Should return 0 (no any array types)

### Code Quality Validation
- `find src/ -name "*.ts" -exec wc -l {} + | sort -n | tail -5` - Check for overly large files
- `grep -r "TODO" src/ --include="*.ts"` - Verify all TODOs are addressed or documented

### Functional Pattern Validation
- `grep -r "Either<" src/ --include="*.ts" | wc -l` - Count Either usage (should be substantial)
- `grep -r "TaskEither<" src/ --include="*.ts" | wc -l` - Count TaskEither usage (should be substantial)
- `grep -r "Option<" src/ --include="*.ts" | wc -l` - Count Option usage (should be substantial)

### Runtime Validation
- `bun run src/main.ts` - Should start the application successfully
- `bun run src/main.ts --help` - Should display help text
- `bun run src/main.ts test.txt` - Should open a test file

## Notes

### Runtime Migration (Deno → Bun)
**Critical**: This refactoring includes a complete runtime migration from Deno to Bun:
- **Bun** is the new runtime (not Deno)
- **Plain TypeScript** - No Deno-specific APIs or imports
- **Node-compatible APIs** - Use Node `fs/promises`, `process.stdin/stdout`, etc.
- **Bun-specific APIs** - Use `Bun.file()`, `Bun.write()` where beneficial
- **Package management** - Use `npm` or `bun` for dependencies (no Deno imports)

### Deno API Replacements

**File System:**
```typescript
// Before (Deno)
import { readTextFile, writeTextFile } from "https://deno.land/std@0.208.0/fs/mod.ts";
const content = await Deno.readTextFile(path);
await Deno.writeTextFile(path, content);

// After (Bun/Node)
import { readFileSync, writeFileSync } from "node:fs/promises";
const content = await Bun.file(path).text();
// OR
import { readTextFile, writeTextFile } from "node:fs/promises";
const content = await readTextFile(path, 'utf-8');
await writeTextFile(path, content, 'utf-8');
```

**Terminal I/O:**
```typescript
// Before (Deno)
await Deno.stdin.read(p);
await Deno.stdout.write(data);

// After (Bun/Node)
import process from "node:process";
const chunk = process.stdin.read(buffer);
process.stdout.write(data);
```

**Imports:**
```typescript
// Before (Deno)
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// After (npm package or local)
import { expect } from "bun:test";
// OR
import { assertEquals } from "./utils/assert.ts";
```

### Functional Programming Principles
1. **No Exceptions**: All errors are explicit via Either/TaskEither
2. **No `any` Types**: Full type safety with discriminated unions
3. **Immutable Data**: All operations return new values, never mutate
4. **Pure Functions**: No side effects in core logic (side effects in TaskEither)
5. **Composability**: Small functions that compose via flatMap/andThen

### Error Handling Strategy
- **Sync operations**: Use `Either<ErrorType, SuccessType>`
- **Async operations**: Use `TaskEither<ErrorType, SuccessType>`
- **Nullable values**: Use `Option<ValueType>` (Some/None)
- **Validation**: Use Either with specific ValidationError types
- **Recovery**: Use `orElse`, `mapLeft`, `fold` for error handling

### Migration Strategy
- **Incremental**: One module at a time, maintaining tests
- **Test-Driven**: Write tests for new patterns before refactoring
- **Backward Compatible**: Keep old interfaces during migration, remove after
- **Documentation**: Update examples and docs as you go

### Type System Design
- **Discriminated Unions**: Use for error types with `type` field
- **Type Guards**: Create for runtime type checking
- **Brand Types**: Use for opaque types (e.g., `BufferId extends string`)
- **Template Literals**: Use for precise string types (e.g., `` `"normal" | "insert" | ... ``)

### Common Patterns

**Validation Pattern:**
```typescript
const validateAndProcess = (input: unknown): Either<ValidationError, Result> =>
  pipe(
    validateType(input),
    Either.flatMap(validateStructure),
    Either.flatMap(validateConstraints),
    Either.flatMap(processValid)
  );
```

**Async Operation Pattern:**
```typescript
const saveFile = (path: string, content: string): TaskEither<FileSystemError, void> =>
  pipe(
    TaskEither.tryCatch(() => Bun.write(path, content)),
    TaskEither.mapLeft(error => ({ type: 'write-error', path, message: String(error) }))
  );

// OR using Node fs/promises:
import { writeFile } from "node:fs/promises";
const saveFileNode = (path: string, content: string): TaskEither<FileSystemError, void> =>
  pipe(
    TaskEither.tryCatch(() => writeFile(path, content, 'utf-8')),
    TaskEither.mapLeft(error => ({ type: 'write-error', path, message: String(error) }))
  );
```

**Nullable Handling Pattern:**
```typescript
const findBuffer = (name: string): Option<FunctionalTextBuffer> =>
  Option.fromNullable(buffers.get(name));
```

### Performance Considerations
- Either/TaskEither add minimal overhead (~1-2ms per million operations)
- Immutable data structures prevent accidental mutations
- Lazy evaluation in Task reduces unnecessary work
- Function composition is optimized by V8 engine

### Testing Strategy
- **Bun test** - Use Bun's built-in test framework (not Deno test)
- Test success paths: `Either.isRight(result) && result.right === expected`
- Test error paths: `Either.isLeft(result) && result.left === expectedError`
- Test composition: Chain multiple operations and verify end-to-end
- Test edge cases: Empty inputs, null values, invalid types

**Bun Test Pattern:**
```typescript
// import { test, describe, expect } from "bun:test";

describe("FunctionalTextBuffer", () => {
  test("should create buffer with content", () => {
    const buffer = FunctionalTextBufferImpl.create("hello");
    expect(buffer.getContent()).toEqual({ _tag: 'Right', right: "hello" });
  });

  test("should return error for invalid position", () => {
    const buffer = FunctionalTextBufferImpl.create("test");
    const result = buffer.insert({ line: -1, column: 0 }, "x");
    expect(Either.isLeft(result)).toBe(true);
  });
});
```

### Performance Considerations with Bun
- **Bun is faster** - Expect 10x faster startup and execution than Deno
- Either/TaskEither add minimal overhead (~1-2ms per million operations)
- Immutable data structures prevent accidental mutations
- Lazy evaluation in Task reduces unnecessary work
- Function composition is optimized by Bun's JavaScriptCore engine
- **Native performance** - Bun uses JavaScriptCore (Safari's engine) instead of V8

IMPORTANT: When you have completed this chore and validated it with zero regressions, output exactly:
`<promise>DONE</promise>
