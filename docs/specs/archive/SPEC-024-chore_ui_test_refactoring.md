# Chore: UI Test Harness Refactoring

## Chore Description
Refactor the UI test harness (`test/ui/`) to eliminate code duplication and improve maintainability. The analysis identified 200-300 lines of duplicate code across 15+ files, with significant duplication in:

1. **Window target pattern** - `_get_window_target()` logic duplicated across 4+ files
2. **Mode verification pattern** - Same mode checking logic repeated in every editing function (~45 lines)
3. **Window cleanup logic** - Duplicate window killing code in multiple session functions (~30 lines)
4. **Session validation** - Repeated tmux installation and session checks (~25 lines)
5. **Test framework boilerplate** - Every test file repeats same initialization/cleanup pattern (~60 lines)
6. **Test file utilities** - Manual file creation and cleanup repeated (~40 lines)

The refactoring will centralize common utilities, reduce code duplication by ~200-300 lines, improve maintainability, and create a consistent foundation for future test development.

## Relevant Files

### Files to be Modified

#### Core Module Files
- `test/ui/core/input.sh` - Contains `_get_window_target()` helper that needs to be extracted (lines 10-19)
- `test/ui/core/query.sh` - Uses window target pattern that can use centralized helper
- `test/ui/core/session.sh` - Contains duplicate window cleanup logic (lines 136-144, 170-178) and session validation (lines 11-31, 34-64)
- `test/ui/core/editor.sh` - Contains window cleanup duplication

#### Operations Module Files
- `test/ui/ops/editing.sh` - Contains repeated mode verification pattern in 3+ functions (~45 lines total)
- `test/ui/ops/files.sh` - Uses window target pattern with fallback logic (4 occurrences)
- `test/ui/ops/navigation.sh` - Uses window target pattern that can use centralized helper

#### Library Module Files
- `test/ui/lib/api.sh` - Main API file that will source new common utilities
- `test/ui/lib/config.sh` - Contains color definitions that are duplicated elsewhere (lines 59-64)
- `test/ui/lib/debug.sh` - Logging utilities that common functions will use

#### Test Files
- `test/ui/tests/01-startup.test.sh` - Contains test boilerplate pattern (lines 9-37)
- `test/ui/tests/02-basic-editing.test.sh` - Contains test boilerplate pattern
- `test/ui/tests/03-mode-switching.test.sh` - Contains test boilerplate pattern
- `test/ui/tests/04-full-height-layout.test.sh` - Contains test boilerplate pattern
- `test/ui/tests/05-command-mode-cursor-focus.test.sh` - Contains test boilerplate pattern

#### Utility Scripts
- `test/ui/run-tests.sh` - Contains duplicate color definitions
- `test/ui/interactive-test.sh` - Contains duplicate color definitions

### New Files to be Created

- `test/ui/lib/common.sh` - NEW: Centralized utility functions for common patterns
  - `get_window_target()` - Unified window target resolution
  - `verify_mode_change()` - Generic mode verification with timeout
  - `validate_tmux_installation()` - Check if tmux is installed
  - `validate_tmux_session()` - Check if in tmux session
  - `kill_matching_windows()` - Generic window cleanup by pattern

- `test/ui/lib/test-framework.sh` - NEW: Test framework with standardized test execution
  - `run_test()` - Wrapper for test execution with setup/teardown
  - `assert_common_startup()` - Group common startup assertions
  - `setup_test_file()` - Helper for test file creation
  - `cleanup_test_file()` - Helper for test file cleanup

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Phase 1: Create Foundation - Common Utilities Library

#### 1.1 Create test/ui/lib/common.sh with centralized utilities
- Create new file `test/ui/lib/common.sh` with shebang `#!/bin/bash`
- Add header comment describing the module purpose: "Common utility functions for UI test harness"
- Source the config and debug modules at the top:
  ```bash
  source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
  source "$(dirname "${BASH_SOURCE[0]}")/debug.sh"
  ```

#### 1.2 Implement get_window_target() function in common.sh
- Extract and enhance `_get_window_target()` from `test/ui/core/input.sh` (lines 10-19)
- Rename from `_get_window_target` to `get_window_target` (public API)
- Add function with proper error handling:
  ```bash
  get_window_target() {
    local window="${1:-$TMAX_ACTIVE_WINDOW}"

    if [[ -z "$window" ]]; then
      log_error "No active window set. Use session_set_active_window() first."
      return 1
    fi

    echo "${TMAX_SESSION}:${window}"
  }
  ```
- Add documentation comment explaining purpose and parameters

#### 1.3 Implement verify_mode_change() function in common.sh
- Create generic mode verification function that accepts expected mode as parameter
- Add timeout parameter for waiting (default 5 seconds)
- Implement polling loop with 0.5 second intervals
- Return 0 if mode matches, 1 if timeout or mismatch
- Add debug/warning logging for success/failure cases:
  ```bash
  verify_mode_change() {
    local expected_mode="$1"
    local window="${2:-$TMAX_ACTIVE_WINDOW}"
    local timeout="${3:-5}"

    local elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
      local actual_mode
      actual_mode=$(query_get_mode "$window")

      if [[ "$actual_mode" == "$expected_mode" ]]; then
        log_debug "Successfully entered $expected_mode mode"
        return 0
      fi

      sleep 0.5
      ((elapsed++))
    done

    actual_mode=$(query_get_mode "$window")
    log_warn "Mode is: $actual_mode (expected $expected_mode)"
    return 1
  }
  ```

#### 1.4 Implement session validation functions in common.sh
- Create `validate_tmux_installation()` function:
  - Check if `tmux` command exists using `command -v tmux`
  - Log error and return 1 if not installed
  - Return 0 if installed

- Create `validate_tmux_session()` function:
  - Check if `$TMUX` environment variable is set
  - Log error and return 1 if not in tmux session
  - Return 0 if in session

#### 1.5 Implement kill_matching_windows() function in common.sh
- Extract window cleanup logic from `test/ui/core/session.sh` (lines 136-144)
- Make it generic by accepting window pattern and session as parameters
- Implement loop to kill all matching windows:
  ```bash
  kill_matching_windows() {
    local window_pattern="$1"
    local session="${2:-$TMAX_SESSION}"

    local window_ids=$(tmux list-windows -t "$session" -F "#{window_name} #{window_id}" 2>/dev/null | grep "^${window_pattern} " | awk '{print $2}')

    if [[ -n "$window_ids" ]]; then
      log_info "Killing windows matching pattern '$window_pattern': $window_ids"
      for wid in $window_ids; do
        tmux kill-window -t "$session:$wid" 2>/dev/null
      done
      sleep "$TMAX_OPERATION_DELAY"
    fi
  }
  ```

#### 1.6 Source common.sh in all module files
- Update `test/ui/core/input.sh` to source `../lib/common.sh` after config.sh
- Update `test/ui/core/query.sh` to source `../lib/common.sh` after config.sh
- Update `test/ui/core/session.sh` to source `../lib/common.sh` after config.sh
- Update `test/ui/core/editor.sh` to source `../lib/common.sh` after config.sh
- Update `test/ui/ops/editing.sh` to source `../../lib/common.sh` after debug.sh
- Update `test/ui/ops/files.sh` to source `../../lib/common.sh` after debug.sh
- Update `test/ui/ops/navigation.sh` to source `../../lib/common.sh` after debug.sh

### Phase 2: Refactor Core Module Files

#### 2.1 Update test/ui/core/input.sh to use common utilities
- Remove private `_get_window_target()` function (lines 10-19)
- Update all internal calls to use `get_window_target()` from common.sh
- Ensure `input_send_command()` and `input_send_key()` use centralized function
- Test that all input operations still work correctly

#### 2.2 Update test/ui/core/session.sh to use common utilities
- Replace window cleanup logic in `session_create_test_window()` (lines 136-144) with `kill_matching_windows "$TMAX_TEST_WINDOW"`
- Replace window cleanup logic in `session_create_test_window_with_cmd()` (lines 170-178) with `kill_matching_windows "$TMAX_TEST_WINDOW"`
- Replace session validation in `session_validate()` with calls to `validate_tmux_installation()` and `validate_tmux_session()`
- Ensure all session management functions still work correctly

#### 2.3 Update test/ui/core/query.sh to use common utilities
- Replace any direct window target construction with `get_window_target()` calls
- Ensure all query functions work with centralized helper

#### 2.4 Update test/ui/core/editor.sh to use common utilities
- Replace window cleanup logic in `editor_start()` with `kill_matching_windows "$TMAX_TEST_WINDOW"`
- Ensure editor lifecycle management works correctly

### Phase 3: Refactor Operations Module Files

#### 3.1 Refactor test/ui/ops/editing.sh mode verification
- Update `editing_enter_insert_mode()` (lines 21-31):
  - Remove 11-line mode verification block
  - Replace with single call to `verify_mode_change "INSERT" "$window"`
  - Keep log_debug message and input_send_key call

- Update `editing_enter_normal_mode()` (lines 42-51):
  - Remove 10-line mode verification block
  - Replace with single call to `verify_mode_change "NORMAL" "$window"`
  - Keep log_debug message and input_send_key call

- Update `editing_enter_command_mode()` (lines 65-75):
  - Remove 11-line mode verification block
  - Replace with single call to `verify_mode_change "COMMAND" "$window"`
  - Keep log_debug message and input_send_key call

- Verify all mode changes still work correctly after refactoring

#### 3.2 Update test/ui/ops/files.sh to use common utilities
- Replace fallback window target construction at line 181 with `get_window_target()`
- Replace fallback window target construction at line 196 with `get_window_target()`
- Replace fallback window target construction at line 208 with `get_window_target()`
- Replace fallback window target construction at line 225 with `get_window_target()`
- Remove redundant `2>/dev/null || echo "${TMAX_SESSION}:${window}"` fallback logic
- Ensure all file operations work correctly

#### 3.3 Update test/ui/ops/navigation.sh to use common utilities
- Replace any direct window target construction with `get_window_target()` calls
- Ensure all navigation operations work correctly

### Phase 4: Create Test Framework

#### 4.1 Create test/ui/lib/test-framework.sh with test utilities
- Create new file `test/ui/lib/test-framework.sh` with shebang `#!/bin/bash`
- Add header comment describing the module purpose: "Test framework utilities for standardized test execution"
- Source common.sh and api.sh modules:
  ```bash
  source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
  source "$(dirname "${BASH_SOURCE[0]}")/api.sh"
  ```

#### 4.2 Implement run_test() function in test-framework.sh
- Create wrapper function that accepts test name and test function as parameters
- Implement test execution flow:
  ```bash
  run_test() {
    local test_name="$1"
    local test_function="$2"

    echo "=== Test: $test_name ==="
    echo ""

    # Initialize test harness
    tmax_init

    # Run the actual test function
    $test_function

    # Show results and cleanup
    tmax_summary
    tmax_cleanup
  }
  ```
- Add documentation comment explaining usage and parameters

#### 4.3 Implement assert_common_startup() function in test-framework.sh
- Create assertion helper that groups common startup checks
- Include assertions for:
  - `assert_running "Editor should be running"`
  - `assert_mode "NORMAL" "Should start in NORMAL mode"`
  - `assert_no_errors "No errors should be present"`
  - `assert_screen_fill "UI should fill entire terminal height"`

#### 4.4 Implement test file utilities in test-framework.sh
- Create `setup_test_file()` function:
  - Accept filename, content (optional, default empty), and location (optional, default TMAX_PROJECT_ROOT)
  - Create file with specified content
  - Log debug message with file path

- Create `cleanup_test_file()` function:
  - Accept filename and location (optional, default TMAX_PROJECT_ROOT)
  - Remove file with `rm -f`
  - Log debug message with file path

### Phase 5: Migrate Test Files to New Framework

#### 5.1 Migrate test/ui/tests/01-startup.test.sh
- Source test-framework.sh instead of just api.sh
- Rename `test_startup()` to `test_startup_logic()`
- Remove boilerplate: `echo "=== Test: Application Startup ==="` line
- Remove `tmax_init` call (handled by framework)
- Remove `tmax_summary` and `tmax_cleanup` calls (handled by framework)
- Replace manual file creation with `setup_test_file "startup-test.txt" ""`
- Add `run_test "Application Startup" test_startup_logic` at end of file
- Verify test still passes with `bash test/ui/tests/01-startup.test.sh`

#### 5.2 Migrate test/ui/tests/02-basic-editing.test.sh
- Source test-framework.sh instead of just api.sh
- Rename `test_basic_editing()` to `test_basic_editing_logic()`
- Remove boilerplate (echo, tmax_init, tmax_summary, tmax_cleanup)
- Replace manual file creation with `setup_test_file`
- Add file cleanup with `cleanup_test_file`
- Add `run_test "Basic Editing" test_basic_editing_logic` at end
- Verify test still passes

#### 5.3 Migrate test/ui/tests/03-mode-switching.test.sh
- Apply same migration pattern as 02-basic-editing.test.sh
- Verify test still passes

#### 5.4 Migrate test/ui/tests/04-full-height-layout.test.sh
- Apply same migration pattern
- Verify test still passes

#### 5.5 Migrate test/ui/tests/05-command-mode-cursor-focus.test.sh
- Apply same migration pattern
- Verify test still passes

#### 5.6 Update test/ui/tests/02-basic-editing-simple.test.sh if it exists
- Check if this file follows same pattern
- Apply migration if needed
- Verify test passes

### Phase 6: Clean Up Utility Scripts

#### 6.1 Remove duplicate color definitions from run-tests.sh
- Check if `test/ui/run-tests.sh` has color definitions (lines similar to config.sh:59-64)
- Remove duplicate ANSI color code exports
- Ensure config.sh is sourced to get color definitions
- Verify run-tests.sh still works correctly

#### 6.2 Remove duplicate color definitions from interactive-test.sh
- Check if `test/ui/interactive-test.sh` has duplicate color definitions
- Remove duplicate ANSI color code exports
- Ensure config.sh is sourced
- Verify interactive-test.sh still works correctly

### Phase 7: Update Documentation

#### 7.1 Update test/ui/README.md with new framework
- Add section describing test-framework.sh utilities
- Document `run_test()` function usage
- Document `assert_common_startup()` helper
- Document test file utilities (`setup_test_file`, `cleanup_test_file`)
- Update examples to use new framework
- Add migration guide for existing tests

#### 7.2 Update docs/ui-test-refactoring-opportunities.md
- Mark completed items with ✅
- Add completion date
- Document any deviations from original plan
- Add lessons learned section

### Phase 8: Final Validation

#### 8.1 Run all UI tests to verify zero regressions
- Execute each test file individually:
  ```bash
  bash test/ui/tests/01-startup.test.sh
  bash test/ui/tests/02-basic-editing.test.sh
  bash test/ui/tests/03-mode-switching.test.sh
  bash test/ui/tests/04-full-height-layout.test.sh
  bash test/ui/tests/05-command-mode-cursor-focus.test.sh
  ```
- Verify all tests pass with 100% assertion success rate
- Check for any new warnings or errors

#### 8.2 Verify no regressions in core functionality
- Test that tmux session management works correctly
- Test that window targeting works across all modules
- Test that mode verification works for all mode changes
- Test that file operations still work correctly

#### 8.3 Code quality checks
- Verify no shell script syntax errors: `shellcheck test/ui/**/*.sh` (if shellcheck is available)
- Check that all files have proper source ordering (config before common before api)
- Verify all functions are properly documented with comments
- Check for remaining duplicate code patterns

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bash test/ui/tests/01-startup.test.sh` - Verify startup test passes after refactoring
- `bash test/ui/tests/02-basic-editing.test.sh` - Verify basic editing test passes
- `bash test/ui/tests/03-mode-switching.test.sh` - Verify mode switching test passes
- `bash test/ui/tests/04-full-height-layout.test.sh` - Verify layout test passes
- `bash test/ui/tests/05-command-mode-cursor-focus.test.sh` - Verify command mode test passes
- `wc -l test/ui/lib/common.sh` - Verify common utilities file was created (should be ~80-100 lines)
- `wc -l test/ui/lib/test-framework.sh` - Verify test framework file was created (should be ~60-80 lines)
- `grep -r "get_window_target" test/ui/ | wc -l` - Verify centralized function is being used (should find 10+ occurrences)
- `grep -r "verify_mode_change" test/ui/ | wc -l` - Verify mode verification is being used (should find 3+ occurrences)
- `grep -r "run_test " test/ui/tests/ | wc -l` - Verify test framework is adopted (should find 5+ occurrences)

## Notes
- **Incremental Implementation**: Each phase is independent and can be completed separately. Phase 1 (common utilities) must be completed before Phases 2-3 can use the new functions.
- **Backward Compatibility**: All changes maintain backward compatibility. No changes to test behavior, only internal implementation.
- **Testing Strategy**: Run each test file immediately after migrating it to catch any issues early. Don't wait until all tests are migrated.
- **Code Reduction Goal**: Expected to eliminate 200-300 lines of duplicate code across the test suite.
- **Future Maintainability**: The centralized utilities will make it easier to add new tests and modify existing behavior.
- **Git Commits**: Consider creating separate commits for each phase to make rollbacks easier if needed.
- **Documentation**: Keep README.md in sync with code changes. New utility functions should be well-documented for future contributors.
- **Error Handling**: All new utility functions should follow existing patterns for error handling (return codes, logging, etc.)
- **Naming Conventions**: Public utility functions use snake_case without underscores prefix (e.g., `get_window_target`, not `_get_window_target`)
- **Source Ordering**: Always source dependencies in order: config.sh → common.sh → api.sh or module-specific files
