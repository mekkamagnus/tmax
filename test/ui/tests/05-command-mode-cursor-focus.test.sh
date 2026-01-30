#!/bin/bash
# Test: Command Mode Cursor Focus
# Verify cursor returns to buffer after command mode execution

# Source API from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/api.sh"

test_command_mode_cursor_focus() {
  echo "=== Test: Command Mode Cursor Focus ==="

  tmax_init

  # Create a test file in project root
  echo "Initial content" > /home/mekael/Documents/tmax/test-cursor-focus.txt

  # Start editor with file (relative to project root)
  tmax_start "test-cursor-focus.txt"
  tmax_wait_for_ready 10

  # Initial mode should be NORMAL
  tmax_assert_mode "NORMAL"

  # Test 1: Execute save command and verify cursor returns to buffer
  echo "Test 1: Save command returns cursor to buffer"
  tmax_command
  tmax_assert_mode "COMMAND"

  # Type 'w' command and press Enter
  tmax_type "w"
  tmax_type_line ""

  sleep 0.5

  # Verify we're back in normal mode
  tmax_assert_mode "NORMAL"

  # Verify we can type (enter insert mode and add text)
  # This proves cursor is back in buffer, not stuck in status bar
  tmax_insert
  tmax_assert_mode "INSERT"
  tmax_type " - more content"
  tmax_normal
  tmax_assert_mode "NORMAL"

  # Verify text was added
  tmax_assert_text "more content"

  # Test 2: Empty command should also return cursor to buffer
  echo "Test 2: Empty command returns cursor to buffer"
  tmax_command
  tmax_assert_mode "COMMAND"

  # Press Enter without typing anything
  tmax_type_line ""

  sleep 0.5

  tmax_assert_mode "NORMAL"

  # Verify we can still edit
  tmax_insert
  tmax_type " - even more"
  tmax_normal
  tmax_assert_text "even more"

  # Test 3: Unknown command should return cursor to buffer
  echo "Test 3: Unknown command returns cursor to buffer"
  tmax_command
  tmax_assert_mode "COMMAND"

  # Type unknown command and press Enter
  tmax_type_line "unknown-command"

  sleep 0.5

  tmax_assert_mode "NORMAL"

  # Verify we can still edit after error
  tmax_insert
  tmax_type " - after error"
  tmax_normal
  tmax_assert_text "after error"

  # Save and quit
  tmax_save
  tmax_quit

  # Check file was saved with all our edits
  tmax_check_file "/home/mekael/Documents/tmax/test-cursor-focus.txt" "more content"
  tmax_check_file "/home/mekael/Documents/tmax/test-cursor-focus.txt" "even more"
  tmax_check_file "/home/mekael/Documents/tmax/test-cursor-focus.txt" "after error"

  tmax_summary
  tmax_cleanup
}

# Run test
test_command_mode_cursor_focus
