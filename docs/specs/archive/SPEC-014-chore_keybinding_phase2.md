# Chore: Phase 2 - T-Lisp Keybinding Data Structures

## Chore Description
Implement T-Lisp data structures (hash-maps) to support T-Lisp-centric key binding system. This phase adds the foundational data types needed to store key bindings as T-Lisp variables instead of TypeScript Maps, moving toward the pure T-Lisp architecture outlined in the PRD.

## Relevant Files
Use these files to resolve the chore:

### Modified Files
- `src/tlisp/environment.ts` - Add hash-map value type and environment support for hash-map variables
- `src/tlisp/values.ts` - Add hash-map value type creation and validation functions
- `src/tlisp/evaluator.ts` - Add hash-map construction and access special forms
- `src/tlisp/interpreter.ts` - Add hash-map standard library functions (make-hashmap, hashmap-get, hashmap-set, hashmap-keys, hashmap-values)
- `src/editor/editor.ts` - Initialize T-Lisp keymap variables (*normal-mode-keymap*, *insert-mode-keymap*, etc.) with empty hash-maps
- `test/unit/tlisp.test.ts` - Add tests for hash-map data structures and operations

### New Files
- `src/tlisp/stdlib.ts` - Create new standard library file with hash-map manipulation functions (this file will house all built-in T-Lisp functions)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add Hash-Map Value Type to T-Lisp Values

- **File**: `src/tlisp/values.ts`
- **Actions**:
  - Add `"hashmap"` to TLispValueType union type
  - Create `HashmapValue` interface extending `TLispBaseValue` with:
    - `type: "hashmap"`
    - `value: Map<string, TLispValue>` (using TypeScript Map as backing store)
  - Create `createHashmap(pairs: [string, TLispValue][]): TLispValue` function
  - Create `isHashmap(value: TLispValue): value is HashmapValue` type guard
  - Add JSDoc comments for all new functions
  - Export new types and functions

### Step 2: Create Standard Library File Structure

- **File**: `src/tlisp/stdlib.ts` (NEW FILE)
- **Actions**:
  - Create new file for T-Lisp standard library functions
  - Add file header comment explaining this houses all built-in T-Lisp functions
  - Export a function `registerStdlibFunctions(interpreter: TLispInterpreter): void`
  - This function will call `interpreter.defineBuiltin()` for all stdlib functions
  - Initially empty, will be populated in Step 4
  - Add JSDoc comments explaining the stdlib registration pattern

### Step 3: Implement Hash-Map Construction Special Form

- **File**: `src/tlisp/evaluator.ts`
- **Actions**:
  - Add `"hashmap"` case to eval switch statement
  - Implement `evalHashmap(elements: TLispValue[], env: TLispEnvironment): TLispValue` method
  - Parse alternating key-value pairs from elements list
  - Validate that all keys are strings (convert symbols to strings if needed)
  - Create hash-map value using `createHashmap()` function
  - Handle empty hash-map case: `(hashmap)` creates empty map
  - Handle errors: odd number of arguments, non-string keys
  - Add comprehensive JSDoc comments
  - Add unit tests in `test/unit/tlisp.test.ts` for hashmap construction

### Step 4: Implement Hash-Map Access Functions in Standard Library

- **File**: `src/tlisp/stdlib.ts`
- **Actions**:
  - Implement `(hashmap-get map key)` function to retrieve value by string key
    - Returns value if found, nil if not found
    - Throws error if first argument is not hash-map
    - Throws error if key is not string
  - Implement `(hashmap-set map key value)` function to set key-value pair
    - Returns modified hash-map (creates new Map, immutable operation)
    - Throws error if first argument is not hash-map
    - Throws error if key is not string
  - Implement `(hashmap-keys map)` function to get list of all keys
    - Returns list of string keys
    - Throws error if argument is not hash-map
  - Implement `(hashmap-values map)` function to get list of all values
    - Returns list of values
    - Throws error if argument is not hash-map
  - Implement `(hashmap-has-key? map key)` function to check if key exists
    - Returns boolean (true/false)
    - Throws error if first argument is not hash-map
  - Add comprehensive JSDoc comments for each function
  - Add unit tests in `test/unit/tlisp.test.ts` for all hashmap functions

### Step 5: Register Standard Library in Editor

- **File**: `src/editor/editor.ts`
- **Actions**:
  - Import `registerStdlibFunctions` from `src/tlisp/stdlib.ts`
  - Call `registerStdlibFunctions(this.interpreter)` in constructor after API registration
  - Add comment indicating this registers all T-Lisp standard library functions
  - Ensure this happens before core bindings are loaded
  - Add unit test verifying stdlib functions are available after editor initialization

### Step 6: Initialize T-Lisp Keymap Variables

- **File**: `src/editor/editor.ts`
- **Actions**:
  - Add new private method `initializeKeymapVariables(): void`
  - Create empty hash-maps for each mode using T-Lisp execute:
    - `(defvar *normal-mode-keymap* (hashmap))`
    - `(defvar *insert-mode-keymap* (hashmap))`
    - `(defvar *visual-mode-keymap* (hashmap))`
    - `(defvar *command-mode-keymap* (hashmap))`
    - `(defvar *mx-mode-keymap* (hashmap))`
    - `(defvar *global-keymap* (hashmap))`
  - Call this method in constructor after stdlib registration
  - Add JSDoc comments explaining keymap variable hierarchy (global -> mode-specific)
  - Add unit test verifying all keymap variables exist and are hashmaps

### Step 7: Update Existing Tests

- **File**: `test/unit/tlisp.test.ts`
- **Actions**:
  - Add test suite "Hash-Map Data Structure" with tests:
    - Test empty hashmap creation: `(hashmap)` returns empty hash-map
    - Test hashmap with pairs: `(hashmap "a" 1 "b" 2)` creates map with two entries
    - Test hashmap with symbol keys: convert symbols to strings automatically
    - Test hashmap error handling: odd number of arguments throws error
  - Add test suite "Hash-Map Standard Library Functions" with tests:
    - Test `hashmap-get` retrieves values by key
    - Test `hashmap-get` returns nil for missing keys
    - Test `hashmap-set` adds new key-value pairs
    - Test `hashmap-set` overwrites existing keys
    - Test `hashmap-keys` returns list of all keys
    - Test `hashmap-values` returns list of all values
    - Test `hashmap-has-key?` returns boolean for key existence
    - Test error handling for non-hashmap arguments
  - Add test suite "Editor Keymap Variables" with tests:
    - Test all keymap variables (*normal-mode-keymap*, etc.) exist after initialization
    - Test keymap variables are of type hash-map
    - Test keymap variables start empty

### Step 8: Integration Testing

- **File**: `test/integration/core-bindings-simple.test.ts`
- **Actions**:
  - Add test verifying keymap variables can be accessed via T-Lisp
  - Add test verifying stdlib functions work in editor context
  - Add test verifying keymap variables persist across T-Lisp evaluations
  - Ensure no regressions in existing core bindings tests

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

```bash
# Run all T-Lisp unit tests to verify hash-map implementation
deno test test/unit/tlisp.test.ts

# Run editor unit tests to verify keymap variable initialization
deno test test/unit/editor.test.ts

# Run core bindings integration tests
deno test test/integration/core-bindings-simple.test.ts

# Run all tests to ensure zero regressions
deno task test

# Manual verification: Start T-Lisp REPL and test hash-map functions
deno task repl
# Then manually test:
# (hashmap "a" 1 "b" 2)
# (hashmap-get (hashmap "x" 10) "x")
# (hashmap-set (hashmap) "key" "value")
# (hashmap-keys (hashmap "a" 1 "b" 2))
```

## Notes

**Important Implementation Notes:**

1. **Immutable Hash-Maps**: Hash-map operations should be immutable (create new Map objects) rather than mutating existing maps, following functional programming principles from CLAUDE.md

2. **Symbol to String Conversion**: When constructing hash-maps, automatically convert symbol keys to strings for easier keymap usage

3. **Keymap Hierarchy**: This phase creates the keymap variables but doesn't refactor the key handling yet. That's Phase 3. The variables will sit empty until Phase 3 populates and uses them.

4. **Standard Library Organization**: Creating `src/tlisp/stdlib.ts` as a separate file (even though it's new) establishes a pattern for organizing all built-in T-Lisp functions in one place rather than scattered across evaluator.ts and editor.ts

5. **Phase Completion**: This phase completes the data structure foundation. Phase 3 will refactor handleKey() to use these T-Lisp keymap variables instead of the TypeScript Map.

6. **Backward Compatibility**: Ensure existing (key-bind) function still works with TypeScript Map during this phase. Don't break current functionality yet.

7. **Test Coverage**: Comprehensive test coverage is critical since these are foundational data structures that will be used throughout the keybinding system.

**Success Criteria:**

- All hash-map construction and manipulation functions work correctly
- Keymap variables are properly initialized as empty hash-maps
- No regressions in existing editor functionality
- All tests pass with zero errors
- Manual REPL testing confirms hash-map operations work as expected

**Next Steps After This Chore:**

Phase 3 will refactor `handleKey()` to query T-Lisp keymap variables instead of TypeScript Map, completing the migration to T-Lisp-centric key bindings.
