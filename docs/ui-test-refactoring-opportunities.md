# UI Test Harness Refactoring Opportunities

Analysis of code duplication and refactoring opportunities in `test/ui/` directory.

## Executive Summary

**Total Potential Impact:**
- **Code Reduction**: ~200-300 lines of duplicate code
- **Files Affected**: 15+ files across core/, ops/, assert/, lib/, and tests/
- **Priority Areas**: Window targeting, mode verification, cleanup logic, test framework

---

## High Priority Refactoring Opportunities

### 1. Window Target Pattern Duplication

**Severity**: High
**Impact**: Eliminates duplication across 4+ files
**Lines Saved**: ~40 lines

**Current State:**

The `_get_window_target()` helper is defined in `test/ui/core/input.sh` but is duplicated or re-implemented across multiple files:

```bash
# test/ui/core/input.sh:10-19
_get_window_target() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"
  if [[ -z "$window" ]]; then
    log_error "No active window set"
    return 1
  fi
  echo "${TMAX_SESSION}:${window}"
}

# test/ui/ops/files.sh:180-181 (and similar lines)
local target
target=$(_get_window_target "$window") 2>/dev/null || echo "${TMAX_SESSION}:${window}"
```

**Proposed Solution:**

Create centralized `test/ui/lib/common.sh`:

```bash
# test/ui/lib/common.sh
get_window_target() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  if [[ -z "$window" ]]; then
    log_error "No active window set. Use session_set_active_window() first."
    return 1
  fi

  echo "${TMAX_SESSION}:${window}"
}
```

Update all files to use centralized version:

```bash
# Source in all modules
source "$CORE_DIR/../lib/common.sh"

# Use everywhere
local target
target=$(get_window_target "$window")
```

**Files to Update:**
- `test/ui/core/input.sh` (rename private function)
- `test/ui/core/query.sh`
- `test/ui/ops/files.sh` (4 occurrences)
- `test/ui/ops/editing.sh`
- `test/ui/ops/navigation.sh`

---

### 2. Mode Verification Pattern Duplication

**Severity**: High
**Impact**: Reduces `test/ui/ops/editing.sh` by ~45 lines
**Lines Saved**: ~45 lines

**Current State:**

Each mode change function repeats the same verification logic:

```bash
# test/ui/ops/editing.sh:21-31 (insert mode)
# Lines 42-51 (normal mode)
# Lines 65-75 (command mode)
local mode
mode=$(query_get_mode "$window")
if [[ "$mode" == "INSERT" ]]; then
  log_debug "Successfully entered INSERT mode"
  return 0
else
  log_warn "Mode is: $mode (expected INSERT)"
  return 1
fi
```

**Proposed Solution:**

Add to `test/ui/lib/common.sh`:

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

**Refactored Usage:**

```bash
# Before (15 lines)
editing_enter_insert_mode() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_debug "Entering INSERT mode"
  input_send_key 'i' "$window"

  local mode
  mode=$(query_get_mode "$window")
  if [[ "$mode" == "INSERT" ]]; then
    log_debug "Successfully entered INSERT mode"
    return 0
  else
    log_warn "Mode is: $mode (expected INSERT)"
    return 1
  fi
}

# After (4 lines)
editing_enter_insert_mode() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_debug "Entering INSERT mode"
  input_send_key 'i' "$window"
  verify_mode_change "INSERT" "$window"
}
```

**Functions to Refactor:**
- `editing_enter_insert_mode()` - lines 14-31
- `editing_enter_normal_mode()` - lines 34-51
- `editing_enter_command_mode()` - lines 54-75
- Any other mode-changing functions

---

### 3. Window Cleanup Logic Duplication

**Severity**: High
**Impact**: Eliminates duplicate session management code
**Lines Saved**: ~30 lines

**Current State:**

Window cleanup logic is duplicated in multiple session functions:

```bash
# test/ui/core/session.sh:136-144 (session_create_test_window)
# Lines 170-178 (session_create_test_window_with_cmd)
local window_ids=$(tmux list-windows -t "$TMAX_SESSION" -F "#{window_name} #{window_id}" 2>/dev/null | grep "^$TMAX_TEST_WINDOW " | awk '{print $2}')
if [[ -n "$window_ids" ]]; then
  log_info "Killing existing test-editor windows: $window_ids"
  for wid in $window_ids; do
    tmux kill-window -t "$TMAX_SESSION:$wid" 2>/dev/null
  done
  sleep "$TMAX_OPERATION_DELAY"
fi
```

**Proposed Solution:**

Add to `test/ui/core/session.sh`:

```bash
# Kill windows matching a pattern
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

**Refactored Usage:**

```bash
# Before (14 lines duplicated)
local window_ids=$(tmux list-windows -t "$TMAX_SESSION" -F "#{window_name} #{window_id}" 2>/dev/null | grep "^$TMAX_TEST_WINDOW " | awk '{print $2}')
if [[ -n "$window_ids" ]]; then
  log_info "Killing existing test-editor windows: $window_ids"
  for wid in $window_ids; do
    tmux kill-window -t "$TMAX_SESSION:$wid" 2>/dev/null
  done
  sleep "$TMAX_OPERATION_DELAY"
fi

# After (2 lines)
kill_matching_windows "$TMAX_TEST_WINDOW"
```

---

## Medium Priority Refactoring Opportunities

### 4. Session Validation Duplication

**Severity**: Medium
**Impact**: Centralizes error checking
**Lines Saved**: ~25 lines

**Current State:**

Session validation is duplicated in multiple functions:

```bash
# test/ui/core/session.sh (multiple functions)
if ! command -v tmux &> /dev/null; then
  log_error "tmux is not installed"
  return 1
fi

if [[ -z "$TMUX" ]]; then
  log_error "Not in a tmux session"
  return 1
fi
```

**Proposed Solution:**

```bash
# test/ui/lib/common.sh
validate_tmux_installation() {
  if ! command -v tmux &> /dev/null; then
    log_error "tmux is not installed"
    return 1
  fi
  return 0
}

validate_tmux_session() {
  if [[ -z "$TMUX" ]]; then
    log_error "Not in a tmux session"
    return 1
  fi
  return 0
}
```

---

### 5. Test Framework Standardization

**Severity**: Medium
**Impact**: Standardizes all test files, reduces boilerplate
**Lines Saved**: ~60 lines across test files

**Current State:**

Every test file repeats the same pattern:

```bash
# test/ui/tests/01-startup.test.sh
test_startup() {
  echo "=== Test: Application Startup ==="

  tmax_init

  # Test logic...

  tmax_summary
  tmax_cleanup
}

# test/ui/tests/02-basic-editing.test.sh
test_basic_editing() {
  echo "=== Test: Basic Editing ==="

  tmax_init

  # Test logic...

  tmax_summary
  tmax_cleanup
}
```

**Proposed Solution:**

Create `test/ui/lib/test-framework.sh`:

```bash
# test/ui/lib/test-framework.sh
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

# Assert common startup conditions
assert_common_startup() {
  assert_running "Editor should be running"
  assert_mode "NORMAL" "Should start in NORMAL mode"
  assert_no_errors "No errors should be present"
  assert_screen_fill "UI should fill entire terminal height"
}
```

**Refactored Usage:**

```bash
# test/ui/tests/01-startup.test.sh
source ../lib/test-framework.sh

test_startup_logic() {
  tmax_start "startup-test.txt"
  tmax_wait_for_ready 10

  assert_common_startup
}

run_test "Application Startup" test_startup_logic
```

---

### 6. Test File Creation Utilities

**Severity**: Medium
**Impact**: Eliminates file creation boilerplate
**Lines Saved**: ~40 lines across test files

**Current State:**

Each test manually creates and cleans up files:

```bash
# test/ui/tests/01-startup.test.sh:17
echo "" > /home/mekael/Documents/tmax/startup-test.txt

# ... test logic ...

rm -f /home/mekael/Documents/tmax/startup-test.txt
```

**Proposed Solution:**

```bash
# test/ui/lib/test-framework.sh
setup_test_file() {
  local filename="$1"
  local content="${2:-}"
  local location="${3:-$TMAX_PROJECT_ROOT}"

  local full_path="$location/$filename"

  echo "$content" > "$full_path"
  log_debug "Created test file: $full_path"
}

cleanup_test_file() {
  local filename="$1"
  local location="${3:-$TMAX_PROJECT_ROOT}"

  local full_path="$location/$filename"

  rm -f "$full_path"
  log_debug "Cleaned up test file: $full_path"
}
```

---

## Low Priority Improvements

### 7. Color Definitions Consolidation

**Severity**: Low
**Impact**: Minor cleanup
**Lines Saved**: ~20 lines

**Current State:**

ANSI color codes are defined in multiple files:

```bash
# test/ui/lib/config.sh:59-64
export TMAX_COLOR_RED='\033[0;31m'
export TMAX_COLOR_GREEN='\033[0;32m'
export TMAX_COLOR_YELLOW='\033[1;33m'
export TMAX_COLOR_BLUE='\033[0;34m'
export TMAX_COLOR_NC='\033[0m'

# Also appears in run-tests.sh, interactive-test.sh
```

**Proposed Solution:**

Remove duplicates from `run-tests.sh` and `interactive-test.sh`. Source from `config.sh` instead.

---

### 8. Assertion Helper Groups

**Severity**: Low
**Impact**: Minor convenience improvement
**Lines Saved**: ~15 lines

**Current State:**

Common assertion groups are repeated:

```bash
# Repeated across multiple test files
assert_running "Editor should be running"
assert_mode "NORMAL" "Should start in NORMAL mode"
assert_no_errors "No errors should be present"
assert_screen_fill "UI should fill entire terminal height"
```

**Proposed Solution:**

Create grouped assertion helpers (see #5 above).

---

## Refactoring Implementation Plan

### Phase 1: Foundation (High Priority)
1. Create `test/ui/lib/common.sh` with utility functions
2. Refactor window target pattern across all files
3. Create and integrate `verify_mode_change()` function
4. Create and integrate `kill_matching_windows()` function

**Estimated Time**: 2-3 hours
**Impact**: ~115 lines eliminated, 10+ files improved

### Phase 2: Test Framework (Medium Priority)
1. Create `test/ui/lib/test-framework.sh`
2. Update existing test files to use new framework
3. Migrate test file utilities
4. Update documentation

**Estimated Time**: 2-3 hours
**Impact**: ~100 lines eliminated, 6 test files modernized

### Phase 3: Polish (Low Priority)
1. Consolidate color definitions
2. Create assertion helper groups
3. Review and update documentation

**Estimated Time**: 1 hour
**Impact**: ~35 lines eliminated, cleaner codebase

---

## Benefits of Refactoring

### Maintainability
- **Single Source of Truth**: Changes to common patterns only need to be made once
- **Reduced Bug Surface**: Fewer places for bugs to hide
- **Easier Updates**: Centralized logic simplifies maintenance

### Consistency
- **Standardized Patterns**: All code follows same conventions
- **Predictable Behavior**: Consistent error handling and logging
- **Uniform API**: All modules use same utility functions

### Extensibility
- **Easier Testing**: Centralized utilities are easier to test
- **Simpler Additions**: New features can reuse common patterns
- **Better Documentation**: Clear, well-documented utility functions

### Code Quality
- **Reduced Duplication**: DRY principle applied throughout
- **Clearer Intent**: Well-named functions improve readability
- **Smaller Files**: Focused, single-purpose modules

---

## Risk Assessment

### Low Risk
- All refactorings are straightforward code extraction
- No behavior changes, only organization
- Can be done incrementally
- Each phase is independent

### Mitigation Strategies
1. **Test Thoroughly**: Run full test suite after each phase
2. **Incremental Changes**: One refactoring at a time
3. **Git Commits**: Separate commits for each refactoring
4. **Backward Compatibility**: Keep old functions as deprecated wrappers during transition

---

## Recommendations

### Immediate Actions (Week 1)
1. ✅ Create `test/ui/lib/common.sh` with high-priority utilities
2. ✅ Refactor window target pattern
3. ✅ Refactor mode verification pattern

### Short-term Actions (Week 2)
1. Implement test framework
2. Migrate existing tests to new framework
3. Update documentation

### Long-term Actions (Week 3+)
1. Consolidate remaining low-priority duplications
2. Add unit tests for utility functions
3. Consider adding test helpers for common scenarios

---

## Conclusion

The UI test harness has significant refactoring opportunities that would:

- **Eliminate 200-300 lines of duplicate code**
- **Improve maintainability across 15+ files**
- **Standardize patterns and conventions**
- **Make future additions easier**

The high-priority refactorings alone would eliminate ~115 lines of code and improve consistency across the entire test suite. All changes are low-risk and can be implemented incrementally without breaking existing functionality.
