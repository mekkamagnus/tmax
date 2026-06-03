# Chore: Investigate and Fix Pre-existing Test Failures

## Chore Description

During recent development work, 200 test failures were identified across the test suite. These failures are pre-existing (not caused by recent init file refactoring) and need to be systematically categorized, investigated, and fixed.

**Test Suite Status:**
- Total tests: 1,327 across 123 files
- Passing: 1,127 (84.9%)
- Failing: 200 (15.1%)

**Goal:** Achieve 100% test pass rate by systematically fixing all failing tests.

## Relevant Files

### Test Files with Failures (investigation needed)

**Primary Failure Categories:**
1. **Missing assert() function** - Many tests use `assert()` instead of `expect()` from bun:test
2. **Core bindings loading failures** - Tests fail because `src/tlisp/core/bindings/command.tlisp` doesn't exist
3. **Visual mode selection** - US-1.7.1 tests failing (8 tests)
4. **Word under cursor search** - US-1.5.2 tests failing (6 tests)
5. **Debug fixture tests** - Test framework issues
6. **Error handling tests** - Logger/Error system issues
7. **Server daemon tests** - Timeout issues
8. **Rich assertions tests** - Missing `assert-type` implementation
9. **Test isolation issues** - Test pollution between tests
10. **Minibuffer input tests** - Tab completion issues
11. **Text objects tests** - Text object implementation issues
12. **Frontend component tests** - React/Ink component issues

### Source Files to Investigate

**Test Framework Files:**
- `test/unit/test-fixture-debug.test.ts` - Debug fixture execution
- `test/unit/test-isolation.test.ts` - Test isolation
- `test/unit/test-tlisp-testing-framework.test.ts` - Testing framework
- `test/unit/test-async-testing.test.ts` - Async test framework
- `test/unit/test-assertions-debug.test.ts` - Assertions
- `test/unit/test-assert-type-debug.test.ts` - Assert-type implementation

**Feature Implementation Files:**
- `src/tlisp/core/bindings/` - Core binding files (check if they exist)
- `src/editor/visual-mode-selection.ts` - Visual mode implementation
- `src/editor/word-under-cursor.ts` - Word search implementation
- `src/editor/minibuffer-input.ts` - Minibuffer implementation
- `src/editor/text-objects.ts` - Text object implementation
- `src/error/` - Error handling system
- `src/utils/logger.ts` - Logger implementation
- `src/server/` - Server daemon implementation

**Test Files:**
- `test/unit/visual-mode-selection.test.ts` - 8 failures
- `test/unit/word-under-cursor-search.test.ts` - 6 failures
- `test/unit/error-handling.test.ts` - 6 failures
- `test/unit/minibuffer-input.test.ts` - 1+ failures
- `test/unit/server-daemon.test.ts` - 2 failures
- `test/unit/test-rich-assertions.test.ts` - 5+ failures
- `test/unit/text-objects.test.ts` - Multiple failures
- `test/frontend-disabled/` - React component test issues

## Step by Step Tasks

### Phase 1: Investigate and Categorize Failures (1 day)

**Task 1.1: Run comprehensive test analysis**
- Run full test suite with detailed output
- Capture all failure messages
- Categorize failures by root cause
- Create failure inventory spreadsheet/document

```bash
# Capture all failures
bun test 2>&1 > test-failures-full.log
grep -E "fail\)" test-failures-full.log | wc -l

# Categorize by test file
bun test 2>&1 | grep "test/.*\.test\.ts:" | sort | uniq > failing-files.txt

# For each failing file, count failures
for file in $(cat failing-files.txt); do
  echo "=== $file ==="
  bun test "$file" 2>&1 | grep "fail)" | wc -l
done
```

**Task 1.2: Identify root cause patterns**
- **Pattern A: Missing assert() function**
  - Tests use `assert()` instead of `expect()`
  - Solution: Replace all `assert()` with `expect()`
  - Files affected: Multiple test files

- **Pattern B: Core bindings loading**
  - Error: "Failed to load from src/tlisp/core/bindings/command.tlisp"
  - Solution: Check if core bindings files exist, create or update them
  - Files affected: Multiple integration tests

- **Pattern C: Test fixture issues**
  - Debug fixture test failures
  - Solution: Fix test framework implementation
  - Files affected: test-fixture-debug.test.ts

- **Pattern D: Feature implementation incomplete**
  - Visual mode selection tests (US-1.7.1)
  - Word under cursor search (US-1.5.2)
  - Minibuffer tab completion (US-1.10.2)
  - Solution: Complete feature implementation or mark as expected failures

**Task 1.3: Prioritize fixes by impact**
- **High Priority**: Test framework fixes (affects all tests)
- **Medium Priority**: Core bindings (affects many tests)
- **Low Priority**: Feature-specific tests (isolated impact)

### Phase 2: Fix Test Framework Issues (2-3 days)

**Task 2.1: Replace assert() with expect()**
- Search for all `assert(` usage in test files
- Replace with appropriate `expect()` statements
- Run tests to verify fixes

```bash
# Find all assert() usage
grep -r "assert(" test/ --include="*.ts" | grep -v node_modules

# Replace common patterns:
# assert(condition, "message") → expect(condition).toBe(true)
# assert.equal(a, b) → expect(a).toBe(b)
# assert.throws(fn) → expect(fn).toThrow()
```

**Task 2.2: Fix debug fixture test**
- Investigate `test/unit/test-fixture-debug.test.ts`
- Fix fixture implementation
- Ensure proper test isolation
- Verify debug logging works correctly

**Task 2.3: Fix test isolation issues**
- Review `test/unit/test-isolation.test.ts`
- Ensure tests clean up state properly
- Fix setup/teardown functions
- Verify no test pollution

**Task 2.4: Fix async testing framework**
- Review `test/unit/test-async-testing.test.ts`
- Fix async test execution
- Ensure proper cleanup
- Verify timeout handling

**Task 2.5: Fix T-Lisp testing framework**
- Review `test/unit/test-tlisp-testing-framework.test.ts`
- Fix test-run-all implementation
- Ensure proper test execution
- Verify reporting functionality

### Phase 3: Fix Core Bindings Loading (1-2 days)

**Task 3.1: Check core bindings directory structure**
- Investigate `src/tlisp/core/bindings/`
- List existing binding files
- Identify missing bindings (command.tlisp, etc.)

```bash
ls -la src/tlisp/core/bindings/ 2>&1 || echo "Directory does not exist"
find src -name "*.tlisp" -path "*/bindings/*" | head -20
```

**Task 3.2: Create or update core binding files**
- If directory doesn't exist, create it
- Create missing binding files based on Editor implementation
- Ensure all required bindings are defined
- Test binding loading functionality

**Task 3.3: Update binding references**
- Ensure tests reference correct binding files
- Update imports/exports if needed
- Test core bindings integration
- Verify no broken references

### Phase 4: Fix Feature Implementation Tests (5-7 days)

**Task 4.1: Fix Visual Mode Selection tests (US-1.7.1)**
- Investigate `src/editor/visual-mode-selection.ts`
- Review `test/unit/visual-mode-selection.test.ts`
- Fix 8 failing tests:
  - Multi-line character selection
  - Line-wise selection expansion
  - Block-wise selection
  - Text manipulation (delete, lowercase, uppercase)
  - Word navigation in visual mode
- Mark tests as WIP if implementation incomplete

**Task 4.2: Fix Word Under Cursor Search tests (US-1.5.2)**
- Investigate `src/editor/word-under-cursor.ts`
- Review `test/unit/word-under-cursor-search.test.ts`
- Fix 6 failing tests:
  - Next occurrence continuation
  - Middle of line handling
  - Previous occurrence
  - Direction reversal after #
  - Underscore handling
- Implement complete word search functionality

**Task 4.3: Fix Minibuffer Tab Completion (US-1.10.2)**
- Investigate `src/editor/minibuffer-input.ts`
- Review `test/unit/minibuffer-input.test.ts`
- Fix tab completion issues
- Implement completion option display
- Handle ambiguous completions

**Task 4.4: Fix Text Objects tests**
- Investigate `src/editor/text-objects.ts`
- Review `test/unit/text-objects.test.ts`
- Fix text object selection
- Implement missing text objects
- Verify text object operations

**Task 4.5: Fix Server Daemon tests**
- Investigate `test/unit/server-daemon.test.ts`
- Investigate timeout issues (5054ms, 2605ms timeouts)
- Fix server startup or adjust test timeouts
- Ensure proper cleanup

### Phase 5: Fix Error Handling System (2-3 days)

**Task 5.1: Fix ErrorFactory**
- Review `src/error/` or error handling implementation
- Fix `should create specific error types` test
- Implement proper error type system

**Task 5.2: Fix TmaxError formatting**
- Fix AI-friendly error formatting
- Ensure error messages are properly structured
- Test error display functionality

**Task 5.3: Fix DebugReporter**
- Fix system health tracking
- Implement AI report generation
- Verify reporting functionality

**Task 5.4: Fix Terminal Error Handling**
- Integrate enhanced error handling with terminal
- Test error propagation
- Ensure graceful degradation

**Task 5.5: Fix Error Manager**
- Fix comprehensive report generation
- Test error aggregation
- Verify error manager functionality

### Phase 6: Fix Rich Assertions (1 day)

**Task 6.1: Implement assert-type function**
- Find `test/unit/test-assert-type-debug.test.ts`
- Implement missing `assert-type` function
- Add to test framework or stdlib
- Verify all rich assertion tests pass

**Task 6.2: Fix other rich assertions**
- Review `test/unit/test-rich-assertions.test.ts`
- Fix all rich assertion implementations
- Ensure proper error messages
- Verify assertion coverage

### Phase 7: Fix Frontend Component Tests (2-3 days)

**Task 7.1: Review React/Ink component tests**
- Check `test/frontend-disabled/` directory
- Fix component test issues
- Update test expectations if components changed

**Task 7.2: Fix component integration**
- Ensure proper props passing
- Fix event handling
- Verify component lifecycle

### Phase 8: Fix Yank and Pop Tests (1 day)

**Task 8.1: Investigate Yank Operator tests**
- Check US-2.4.2 spec requirements
- Review failing yank/pop tests
- Fix implementation or test expectations

**Task 8.2: Fix yank-pop functionality**
- Implement proper yank buffer
- Implement yank-pop command
- Test all edge cases

### Phase 9: Validation and Verification (1-2 days)

**Task 9.1: Run full test suite**
- Execute `bun test` without filters
- Verify all 200 failures are fixed
- Generate test coverage report

```bash
# Run all tests
bun test 2>&1 | tee test-results-full.log

# Verify zero failures
bun test 2>&1 | grep "fail)" | wc -l
# Expected: 0

# Verify pass rate
bun test 2>&1 | grep "pass.*\|[0-9]\+ pass"
# Should show: 1327 pass (100%)
```

**Task 9.2: Run specific test suites**
- Test individual failure categories
- Verify no regressions
- Document any expected failures

```bash
# Test framework tests
bun test test/unit/test-fixture-debug.test.ts
bun test test/unit/test-isolation.test.ts
bun test/test/unit/test-async-testing.test.ts

# Test visual mode
bun test test/unit/visual-mode-selection.test.ts

# Test word search
bun test test/unit/word-under-cursor-search.test.ts

# Test error handling
bun test test/unit/error-handling.test.ts

# Test core features
bun test test/unit/text-objects.test.ts
bun test test/unit/minibuffer-input.test.ts
```

**Task 9.3: Update documentation**
- Document all test fixes
- Update SPEC files for completed features
- Mark incomplete features as TODO
- Create test coverage report

**Task 9.4: Create summary report**
- Generate before/after comparison
- List all fixes with explanations
- Identify any remaining known issues
- Recommend future improvements

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

### Pre-Fix Validation
```bash
# Current baseline (200 failures)
bun test 2>&1 | grep "fail)" | wc -l
# Expected: 200

# Get detailed baseline
bun test 2>&1 > test-results-before.log
```

### Post-Fix Validation

**After each phase:**
```bash
# Run specific test category
bun test test/unit/test-fixture-debug.test.ts
bun test test/unit/test-isolation.test.ts
bun test/test/unit/test-async-testing.test.ts
```

**Final validation:**
```bash
# Run all tests
bun test 2>&1 | tee test-results-final.log

# Verify zero failures
bun test 2>&1 | grep "fail)" | wc -l
# Expected: 0

# Verify 100% pass rate
bun test 2>&1 | grep -E "^\s*[0-9]+\s+pass"
# Should show: 1327 pass

# Verify no new errors
bun test 2>&1 | grep -i error | grep -v "LOG ENTRY"
# Should only show INFO/DEBUG logs, no ERROR or test failures
```

**Specific validation for each failure category:**
```bash
# Test framework tests
bun test test/unit/test-fixture-debug.test.ts
bun test test/unit/test-isolation.test.ts
bun test/test/unit/test-async-testing.test.ts
bun test test/unit/test-tlisp-testing-framework.test.ts

# Feature tests
bun test test/unit/visual-mode-selection.test.ts
bun test test/unit/word-under-cursor-search.test.ts
bun test test/unit/minibuffer-input.test.ts
bun test test/unit/text-objects.test.ts

# Error handling
bun test test/unit/error-handling.test.ts

# Rich assertions
bun test test/unit/test-rich-assertions.test.ts
bun test/test/unit/test-assert-type-debug.test.ts

# Server tests
bun test test/unit/server-daemon.test.ts
bun test test/unit/server-client.test.ts

# UI tests (if applicable)
bash test/ui/tests/01-startup.test.sh
bash test/ui/tests/02-basic-editing.test.sh
bash test/ui/tests/03-mode-switching.test.sh
```

## Notes

### Test Failure Categories

**Priority 1 - Test Framework (affects all tests):**
- Missing `assert()` function → Replace with `expect()`
- Debug fixture issues → Fix test framework
- Test isolation issues → Fix setup/teardown
- Async testing framework → Fix async execution
- T-Lisp testing framework → Fix test-run-all

**Priority 2 - Core Infrastructure:**
- Core bindings loading → Create/update binding files
- Error handling system → Fix logger/error implementation
- Server daemon timeouts → Fix server or adjust tests

**Priority 3 - Feature Implementation:**
- Visual mode selection (8 tests) → Complete US-1.7.1
- Word under cursor search (6 tests) → Complete US-1.5.2
- Minibuffer tab completion → Complete US-1.10.2
- Text objects → Complete US-3.2.2
- Yank/pop operations → Complete US-2.4.2

**Priority 4 - Test Updates:**
- Rich assertions → Implement assert-type
- Frontend components → Fix React/Ink tests

### Known Issues

**Core Bindings Missing:**
- Error: "Failed to load from src/tlisp/core/bindings/command.tlisp"
- Likely cause: Binding files not created or wrong path
- Impact: Affects all tests that load core bindings

**Test Framework Issues:**
- Tests using `assert()` instead of bun:test's `expect()`
- Inconsistent test setup/teardown
- Async test execution problems

**Feature Incomplete:**
- Some US (User Story) specs may not be fully implemented
- Tests written for features not yet complete
- Need to verify with SPEC files

### Risk Mitigation

1. **Test Breakdown**: Large number of failures makes it hard to identify root causes
   - Mitigation: Systematic categorization and prioritization

2. **Interdependencies**: Tests may depend on each other
   - Mitigation: Fix test framework first, then feature tests

3. **Time Estimation**: 15-25 days estimated for all fixes
   - Mitigation: Focus on highest-impact issues first

4. **Regression Risk**: Fixing tests may break working functionality
   - Mitigation: Run tests after each phase, verify no regressions

### Success Criteria

- ✅ All 200 test failures resolved
- ✅ Test pass rate: 100% (1,327/1,327 tests passing)
- ✅ No regressions in previously passing tests
- ✅ Test framework stable and reliable
- ✅ Documentation updated with all fixes

### Timeline Estimate

- **Phase 1**: Investigation - 1 day
- **Phase 2**: Test Framework - 2-3 days
- **Phase 3**: Core Bindings - 1-2 days
- **Phase 4-7**: Feature Tests - 5-7 days
- **Phase 8**: Yank/Pop Tests - 1 day
- **Phase 9**: Validation - 1-2 days

**Total Estimate: 12-18 days** (conservative estimate accounting for potential complexity)

### Dependencies

- **Test framework fixes** must be completed before feature test fixes
- **Core bindings** must be fixed before tests that load them
- **Visual mode implementation** may depend on text objects
- **Error handling system** used by many tests

### Next Steps

1. Start with Phase 1 (investigation) to get complete picture
2. Move to Phase 2 (test framework) as highest priority
3. Systematically work through each phase
4. Validate after each phase
5. Generate final report with all fixes documented
