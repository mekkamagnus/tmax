#!/bin/bash
# Test: Application Startup
# Verify that the editor starts correctly and shows welcome message

# Source API from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/api.sh"

test_startup() {
  echo "=== Test: Application Startup ==="
  echo "Running in visible window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
  echo ""

  tmax_init

  # Create a test file in project root
  echo "" > "$TMAX_PROJECT_ROOT/startup-test.txt"

  tmax_start "startup-test.txt"

  # Wait for editor to be ready
  tmax_wait_for_ready 10

  # Assertions
  assert_running "Editor should be running"
  assert_mode "NORMAL" "Should start in NORMAL mode"
  assert_no_errors "No errors should be present"
  assert_screen_fill "UI should fill entire terminal height"

  tmax_summary

  # Cleanup
  tmax_quit
  sleep 1
  rm -f "$TMAX_PROJECT_ROOT/startup-test.txt"
  tmax_cleanup
}

# Run test
test_startup
