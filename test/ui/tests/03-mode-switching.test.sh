#!/bin/bash
# Test: Mode Switching
# Verify all editor modes work correctly

# Source API from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/api.sh"

test_mode_switching() {
  echo "=== Test: Mode Switching ==="

  tmax_init

  # Create a test file in project root
  echo "" > /home/mekael/Documents/tmax/mode-test.txt

  tmax_start "mode-test.txt"
  tmax_wait_for_ready 10

  # Start in NORMAL mode
  assert_mode "NORMAL" "Should start in NORMAL mode"

  # Test INSERT mode
  tmax_insert
  assert_mode "INSERT" "Should be in INSERT mode"
  tmax_normal
  assert_mode "NORMAL" "Should return to NORMAL mode"

  # Test COMMAND mode
  tmax_command
  assert_mode "COMMAND" "Should be in COMMAND mode"
  input_send_escape "$TMAX_TEST_WINDOW"
  sleep 0.5
  assert_mode "NORMAL" "Should return to NORMAL mode"

  # Test navigation doesn't change mode
  tmax_move down 2
  assert_mode "NORMAL" "Should still be in NORMAL mode after navigation"

  # Test typing in INSERT mode
  tmax_insert
  tmax_type "test"
  assert_mode "INSERT" "Should still be in INSERT mode after typing"
  tmax_normal
  assert_mode "NORMAL" "Should return to NORMAL mode"

  tmax_summary

  # Cleanup
  tmax_quit
  rm -f /home/mekael/Documents/tmax/mode-test.txt
  tmax_cleanup
}

# Run test
test_mode_switching
