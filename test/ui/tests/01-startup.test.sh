#!/bin/bash
# Test: Application Startup
# Verify that the editor starts correctly and shows welcome message

# Source test framework from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/test-framework.sh"

test_startup_logic() {
  echo "Running in visible window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
  echo ""

  # Create a test file in project root
  setup_test_file "startup-test.txt" ""

  tmax_start "startup-test.txt"

  # Wait for editor to be ready
  tmax_wait_for_ready 10

  # Assertions
  assert_common_startup

  # Cleanup
  tmax_quit
  sleep 1
  cleanup_test_file "startup-test.txt"
}

# Run test
run_test "Application Startup" test_startup_logic
