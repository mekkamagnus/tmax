#!/bin/bash
# Test Framework Utilities for Standardized Test Execution
# Provides standardized test execution with setup/teardown and common assertions

# Source dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
source "$SCRIPT_DIR/api.sh"

# ==============================================================================
# Test Execution Framework
# ==============================================================================

# Run a test with standardized setup and teardown
# Parameters:
#   $1 - Test name (for display)
#   $2 - Test function name to execute
# Usage:
#   run_test "My Test Feature" test_my_feature_logic
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

# ==============================================================================
# Common Assertion Groups
# ==============================================================================

# Assert common startup conditions
# Validates:
#   - Editor is running
#   - In NORMAL mode
#   - No errors present
#   - UI fills terminal height
assert_common_startup() {
  assert_running "Editor should be running"
  assert_mode "NORMAL" "Should start in NORMAL mode"
  assert_no_errors "No errors should be present"
  assert_screen_fill "UI should fill entire terminal height"
}

# ==============================================================================
# Test File Utilities
# ==============================================================================

# Setup a test file with optional content
# Parameters:
#   $1 - Filename (relative to TMAX_PROJECT_ROOT or absolute path)
#   $2 - Content to write (optional, defaults to empty)
#   $3 - Location directory (optional, defaults to TMAX_PROJECT_ROOT)
setup_test_file() {
  local filename="$1"
  local content="${2:-}"
  local location="${3:-$TMAX_PROJECT_ROOT}"

  local filepath="$location/$filename"

  # Create file with content
  echo "$content" > "$filepath"

  log_debug "Test file created: $filepath"
}

# Cleanup a test file
# Parameters:
#   $1 - Filename (relative to TMAX_PROJECT_ROOT or absolute path)
#   $2 - Location directory (optional, defaults to TMAX_PROJECT_ROOT)
cleanup_test_file() {
  local filename="$1"
  local location="${2:-$TMAX_PROJECT_ROOT}"

  local filepath="$location/$filename"

  # Remove file
  rm -f "$filepath"

  log_debug "Test file removed: $filepath"
}
