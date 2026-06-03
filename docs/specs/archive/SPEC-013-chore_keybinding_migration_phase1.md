# Chore: Phase 1 - T-Lisp Core Bindings Migration

## Chore Description

**Status Assessment:** Phase 1 of the T-Lisp core bindings migration has already been implemented but requires validation and verification that all acceptance criteria are met.

**Current State:**

- ✅ `src/tlisp/core-bindings.tlisp` file exists with all 15 key bindings
- ✅ `src/editor/editor.ts` has `loadCoreBindings()` method (lines 152-183)
- ✅ `src/editor/editor.ts` has `ensureCoreBindingsLoaded()` for lazy loading (lines 188-192)
- ✅ `src/editor/editor.ts` has `loadFallbackBindings()` for error resilience (lines 197-218)
- ✅ Integration with `handleKey()` ensures bindings are loaded before processing keys
- ✅ Integration with `start()` method loads bindings at editor startup
- ✅ Tests exist but require proper Deno permissions

**Remaining Work:**

1. Verify all acceptance criteria from `specs/tlisp-core-bindings-migration.md` are met
2. Fix test permissions to allow tests to pass
3. Run comprehensive tests to ensure zero regressions
4. Verify the old `initializeDefaultKeyMappings()` method has been completely removed
5. Document completion status

## Relevant Files

Use these files to resolve the chore:

### Existing Files

- `src/editor/editor.ts` (lines 38-63, 148-218, 286-313, 560-566)
  - **Why relevant:** Contains the editor constructor, loadCoreBindings(), ensureCoreBindingsLoaded(), loadFallbackBindings(), handleKey(), and start() methods that implement Phase 1
  - **What to verify:** Ensure `initializeDefaultKeyMappings()` is completely removed, verify lazy loading works correctly, check error handling

- `src/tlisp/core-bindings.tlisp`
  - **Why relevant:** The T-Lisp file containing all 15 default key bindings extracted from TypeScript
  - **What to verify:** Contains all expected key-bind calls, proper T-Lisp syntax, organized by functional groups

- `src/editor/tlisp-api.ts` (lines 75-117)
  - **Why relevant:** Contains the `key-bind` built-in function that registers key mappings
  - **What to verify:** The key-bind function correctly stores mappings in the TypeScript Map

- `test/unit/core-bindings-simple.test.ts`
  - **Why relevant:** Validates the core-bindings.tlisp file structure and content
  - **What to fix:** Tests are failing due to missing --allow-read permission flag

- `test/unit/editor.test.ts`
  - **Why relevant:** Contains comprehensive editor tests including key binding functionality
  - **What to verify:** All tests pass after Phase 1 implementation

- `test/integration/core-bindings.test.ts`
  - **Why relevant:** Integration tests for core bindings loading
  - **What to verify:** Editor correctly loads and executes core-bindings.tlisp at startup

### New Files (if needed)

- None - all Phase 1 files already exist

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Verify Phase 1 Implementation Status

First, confirm that all Phase 1 components are correctly implemented by checking the key files.

- Verify `src/tlisp/core-bindings.tlisp` exists and contains all 15 expected key bindings
- Verify `initializeDefaultKeyMappings()` method has been completely removed from `src/editor/editor.ts`
- Verify `loadCoreBindings()` method exists and correctly loads the T-Lisp file
- Verify `ensureCoreBindingsLoaded()` method exists for lazy loading
- Verify `loadFallbackBindings()` method exists for error resilience
- Confirm `handleKey()` calls `ensureCoreBindingsLoaded()` before processing keys
- Confirm `start()` calls `ensureCoreBindingsLoaded()` during editor initialization

### 2. Validate core-bindings.tlisp Content

Ensure the T-Lisp bindings file contains all required bindings in the correct format.

- Count the total number of `(key-bind)` calls in the file (should be 15)
- Verify navigation bindings: h, j, k, l with correct cursor-move commands
- Verify mode switching bindings: i (insert mode), Escape (normal mode), : (command mode)
- Verify command mode bindings: Escape (exit), Enter (execute)
- Verify application control bindings: q (quit)
- Verify M-x system bindings: space (handler), ; (handler), Escape (exit mx), Enter (execute mx)
- Verify all T-Lisp expressions are syntactically correct
- Verify file has proper header comments and organization

### 3. Check TypeScript Implementation Details

Verify the TypeScript side correctly implements the loading mechanism.

- Read `src/editor/editor.ts` lines 152-183 (loadCoreBindings method)
- Verify it tries multiple possible paths for the core-bindings.tlisp file
- Verify it has proper error handling with try-catch blocks
- Verify it calls `this.loadFallbackBindings()` when file loading fails
- Verify it sets `this.coreBindingsLoaded = true` after loading
- Verify it updates status message with success or failure information

### 4. Verify Lazy Loading Implementation

Ensure the lazy loading mechanism works correctly.

- Read `src/editor/editor.ts` lines 188-192 (ensureCoreBindingsLoaded method)
- Verify it checks `this.coreBindingsLoaded` flag before loading
- Verify it calls `loadCoreBindings()` if bindings aren't loaded yet
- Confirm this method is called in `handleKey()` before processing any keys
- Confirm this method is called in `start()` during initialization

### 5. Verify Fallback Bindings

Ensure the fallback bindings provide minimal functionality when core-bindings.tlisp is unavailable.

- Read `src/editor/editor.ts` lines 197-218 (loadFallbackBindings method)
- Verify it contains essential bindings: q, i, Escape, h, j, k, l, :, Enter
- Verify bindings are executed via `this.interpreter.execute()`
- Verify it has error handling even for fallback binding execution
- Verify it sets a critical error status message if fallback fails

### 6. Fix Test Permissions

Fix the Deno permission issue preventing tests from passing.

- Run `deno test --allow-read test/unit/core-bindings-simple.test.ts` to verify tests pass with proper permissions
- If tests still fail, read the test file to understand what's being validated
- Check if the deno.json configuration needs updating for test permissions
- Update test suite configuration if needed to include --allow-read flag by default

### 7. Run Full Test Suite

Execute all tests to verify zero regressions.

- Run `deno task test` to execute the complete test suite
- Verify all 131+ tests pass successfully
- Pay special attention to editor tests and core bindings tests
- Check for any new failures related to the Phase 1 implementation
- Run specific test files: `deno test test/unit/editor.test.ts`
- Run integration tests: `deno test test/integration/core-bindings.test.ts`

### 8. Verify Editor Functionality

Manually test the editor to ensure all key bindings work correctly.

- Start the editor: `deno task start`
- Test navigation: Press h, j, k, l in normal mode and verify cursor movement
- Test mode switching: Press i to enter insert mode, Escape to return to normal mode
- Test command mode: Press : to enter command mode, type q, press Enter to quit
- Test M-x system: Press space then ; to enter M-x mode
- Verify status messages indicate core bindings loaded successfully
- Test fallback behavior: Temporarily rename core-bindings.tlisp and verify editor still starts with fallback bindings

### 9. Document Completion Status

Create clear documentation of Phase 1 completion.

- Update `specs/tlisp-core-bindings-migration.md` with completion status
- Mark all acceptance criteria as complete with ✅
- Add a completion timestamp
- Note any deviations from the original spec
- Document any known issues or limitations
- Update the PRD if needed to reflect Phase 1 completion

### 10. Validate Against Acceptance Criteria

Systematically verify each acceptance criterion from the migration spec.

- ✅ `src/tlisp/core-bindings.tlisp` file created with all 15 default key bindings
- ✅ T-Lisp file contains proper comments and organization
- ✅ `initializeDefaultKeyMappings()` method completely removed from `editor.ts`
- ✅ `loadCoreBindings()` method successfully loads and executes T-Lisp file
- ✅ Error handling works for missing, unreadable, or malformed core bindings files
- ✅ All existing key bindings work identically after migration
- ✅ Comprehensive test coverage for new functionality
- ✅ No regression in editor initialization or key handling behavior

### 11. Final Verification

Perform a final comprehensive check to ensure everything is working correctly.

- Review git diff to see all changes made during Phase 1
- Ensure no unexpected modifications were made to other files
- Verify the code follows all project guidelines from CLAUDE.md
- Confirm functional programming patterns are used where appropriate
- Check that all JSDoc comments are present and accurate
- Run the full test suite one final time: `deno task test`
- Test the editor manually one more time with the most common workflows

### 12. Create Summary Report

Generate a comprehensive summary of Phase 1 completion.

- List all files that were modified
- List all files that were created
- Summarize the key changes made
- Document any issues encountered and how they were resolved
- Provide test results showing all tests pass
- Confirm the editor works correctly with the new implementation
- Note any recommendations for Phase 2 (T-Lisp data structures)

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

### Core Tests

- `deno task test` - Run all tests (131+ tests) to validate zero regressions
- `deno test test/unit/editor.test.ts` - Run editor-specific tests
- `deno test test/unit/core-bindings-simple.test.ts --allow-read` - Run core bindings file structure tests
- `deno test test/integration/core-bindings.test.ts --allow-read --allow-write` - Run integration tests

### Code Quality

- `deno task fmt:check` - Verify code formatting is correct
- `deno task check` - Run TypeScript type checking
- `deno task lint` - Run linter to check code quality

### Editor Functionality

- `deno task start` - Start the editor and test manually (requires interactive testing)
  - Test h, j, k, l navigation
  - Test i to enter insert mode, Escape to return to normal mode
  - Test : to enter command mode
  - Test q to quit
  - Test space then ; for M-x mode

### Verification Commands

- `grep -n "initializeDefaultKeyMappings" src/editor/editor.ts` - Should return no results (method removed)
- `grep -c "key-bind" src/tlisp/core-bindings.tlisp` - Should return 15 (all bindings present)
- `cat src/tlisp/core-bindings.tlisp | head -20` - Verify file has proper header and structure

## Notes

**Phase 1 Status:** APPEARS COMPLETE - Requires validation through testing

**What Phase 1 Accomplishes:**

- Extracts hardcoded key bindings from TypeScript into a T-Lisp configuration file
- Replaces `initializeDefaultKeyMappings()` with `loadCoreBindings()`
- Achieves true separation between TypeScript engine and T-Lisp configuration
- Provides error resilience with fallback bindings
- Lays foundation for advanced key binding features in future phases

**Key Implementation Details:**

- Lazy loading: Bindings are loaded on first key press, not in constructor
- Error resilience: If core-bindings.tlisp is missing, editor falls back to minimal bindings
- File path resolution: Tries multiple paths to find core-bindings.tlisp
- Backward compatibility: All existing key bindings work identically

**Testing Considerations:**

- Some tests require --allow-read permission to read the core-bindings.tlisp file
- Integration tests may require --allow-write permission for file system operations
- Manual testing is recommended to verify the editor feels identical to users

**Next Phase (Phase 2 - T-Lisp Data Structures):**

- Implement hash-map or association-list types in T-Lisp stdlib
- Create mode-specific keymap variables in T-Lisp environment
- Move from TypeScript Map to T-Lisp data structures for key storage
- This will complete the transition to pure T-Lisp key binding management

**Common Pitfalls:**

- Don't forget to run tests with proper Deno permissions
- Remember to test editor manually - automated tests can't catch all UX issues
- Ensure the core-bindings.tlisp file is committed to version control
- Check that file path resolution works from different working directories

**Acceptance Criteria Verification:**
Each criterion must be explicitly verified and documented as complete before this chore can be marked as done.

IMPORTANT: When you have completed this chore and validated it with zero regressions, output exactly:
`<promise>DONE</promise>`
