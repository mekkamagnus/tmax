# Chore: Fix All TypeScript Errors

## Chore Description
Fix all 88 TypeScript errors across the codebase. The errors fall into several categories:
1. Type mismatches in TaskEither fold operations
2. Missing methods on interfaces (getEnvironment, getCompleteContent, openFile)
3. Implicit any types in test files
4. Type parameter constraints in functional utility modules
5. Duplicate type exports in modules
6. Missing override modifiers in mock classes
7. Invalid type comparisons and assertions

## Relevant Files

### Core Type Definition Files
- `src/core/types.ts` - Contains duplicate exports and interface definitions that need to be cleaned up
- `src/tlisp/types.ts` - TLisp type definitions, missing getEnvironment method
- `src/core/buffer.ts` - TextBuffer implementation missing getCompleteContent method
- `src/tlisp/interpreter.ts` - TLispInterpreterImpl missing getEnvironment method
- `src/utils/task-either.ts` - TaskEither fold type signature issues
- `src/utils/lens.ts` - Type parameter constraint issues
- `src/utils/state.ts` - Type parameter constraint issues
- `src/utils/validation.ts` - Validation type constraint issues
- `src/utils/pipeline.ts` - Pipeline builder type issues

### Test Files with Implicit Any Types
- `test/unit/editor.test.ts` - Multiple implicit any[] variables (keyBindErrors, executedCommands, writeOperations)
- `test/unit/functional-patterns.test.ts` - Type constraint issues with filter and lift3 operations
- `test/unit/hashmap.test.ts` - Unknown type assertions needed

### Example Files
- `examples/task-either-usage.ts` - fold operation type mismatch (errors vs checks property)

### Mock Files
- `test/mocks/terminal.ts` - Missing override modifiers for TerminalIOImpl methods

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Phase 1: Fix Core Type Definitions and Interface Mismatches

#### 1.1 Fix duplicate type exports in src/core/types.ts
- Remove duplicate exports of: FunctionalTerminalIO, TerminalError, FunctionalFileSystem, BufferError, FunctionalTextBuffer, TLispParser
- Ensure each type is exported only once from the module

#### 1.2 Add getEnvironment method to TLispInterpreter interface and implementation
- Add `getEnvironment(): TLispEnvironment` to TLispInterpreter interface in src/tlisp/types.ts
- Implement getEnvironment() method in TLispInterpreterImpl class in src/tlisp/interpreter.ts

#### 1.3 Add getCompleteContent method to TextBuffer interface
- Add `getCompleteContent(): string` method to TextBuffer interface in src/core/types.ts
- Implement getCompleteContent() in any TextBuffer implementations

#### 1.4 Add openFile method to EditorOperations interface
- Add `openFile(path: string): Promise<void>` to EditorOperations interface where it's missing
- Implement in any concrete implementations

### Phase 2: Fix Functional Utility Type Constraints

#### 2.1 Fix lens.ts type parameter constraints
- Add proper type constraints to type parameters in src/utils/lens.ts
- Fix constraints at lines 139, 158 to satisfy TypeScript's type system

#### 2.2 Fix state.ts type parameter constraints
- Add proper extends constraints to type parameters in src/utils/state.ts
- Fix tryCatch method type signature at line 147
- Fix retry method error type compatibility at line 478

#### 2.3 Fix validation.ts type parameter constraints
- Add proper extends constraints to Optional type parameters
- Ensure all generic type parameters have appropriate constraints

#### 2.4 Fix pipeline.ts error type handling
- Fix step method to properly handle error type widening
- Ensure error types are compatible across pipeline steps

### Phase 3: Fix Test File Type Issues

#### 3.1 Fix editor.test.ts implicit any types
- Add explicit type annotations for keyBindErrors variable
- Add explicit type annotations for executedCommands variable
- Add explicit type annotations for writeOperations variable
- Use proper array types (e.g., string[] for error arrays)

#### 3.2 Fix functional-patterns.test.ts type issues
- Fix filter operation type assertion at line 59
- Fix pipeline step error type compatibility at line 72
- Fix lift3 validation argument types at line 129
- Fix lens set operation type mismatch at line 599

#### 3.3 Fix hashmap.test.ts unknown type issues
- Add proper type guards or type assertions for listValue at line 117
- Fix iteration over unknown type at line 119
- Add proper type checking for listValue operations

### Phase 4: Fix Example and Mock Files

#### 4.1 Fix task-either-usage.ts fold operation
- Change the success case return type from `{ valid: true, checks: results }` to match expected interface
- Either add `errors` property or update the expected return type interface

#### 4.2 Add override modifiers to MockTerminal
- Add `override` modifier to methods that override TerminalIOImpl base class methods:
  - clearToEndOfLine
  - enterAlternateScreen
  - exitAlternateScreen
  - Any other methods overriding base class

### Phase 5: Fix Remaining Type Assertion and Comparison Issues

#### 5.1 Fix unintentional type comparisons
- Fix comparison between "normal" and "command" mode literals that have no overlap
- Update comparison logic to properly check mode types

#### 5.2 Fix function reference vs call issues
- Fix condition that checks function reference instead of calling it (line with "This condition will always return true since this function is always defined")

#### 5.3 Fix Deno.stdioFileSync.sync property access
- Fix or remove access to non-existent 'sync' property on Deno.stdioFileSync

### Phase 6: Fix Rest Parameter and Spread Type Issues

#### 6.1 Fix implicit any rest parameter
- Add explicit type annotation for rest parameter 'args' that implicitly has 'any[]' type
- Use proper type like `...args: unknown[]` or specific type

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `deno check **/*.ts` - Run TypeScript type checking on all files, should complete with 0 errors
- `deno task test` - Run all tests to ensure no regressions
- `deno task lint` - Run linter to ensure code quality

## Notes
- The project uses Deno 2.3.7 with strict TypeScript checking
- All type fixes must maintain backward compatibility with existing interfaces
- Focus on minimal changes - only fix the specific type errors, don't refactor unrelated code
- Test files should use proper type annotations rather than disabling type checking
- When in doubt, favor explicit types over implicit any

IMPORTANT: When you have completed this chore and validated it with zero regressions, output exactly:
`<promise>DONE</promise>`
