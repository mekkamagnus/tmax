#!/bin/bash
# Test: Command Mode Backspace
# Verify backspace works correctly in command mode to correct typos

# Source test framework from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/test-framework.sh"

test_command_mode_backspace() {
  # Create a test file in project root
  setup_test_file "test-backspace.txt" "Test content for backspace"

  # Start editor with file (relative to project root)
  tmax_start "test-backspace.txt"
  tmax_wait_for_ready 10

  # Initial mode should be NORMAL
  tmax_assert_mode "NORMAL"

  # Test: Use command mode with backspace to correct filename typo
  echo "Test: Backspace in command mode to correct filename typo"

  # Enter command mode
  tmax_command
  tmax_assert_mode "COMMAND"

  # Type command with intentional typo: 'w testTTfile.txt'
  # The 'TT' is the typo we'll correct with backspace
  tmax_type "w testTTfile.txt"

  # Wait a moment for input to register
  sleep 0.3

  # Send backspace key 4 times to delete 'TTf' (3 characters: T, T, f)
  # We want to end up with 'w testile.txt' then add 'le.txt' to get 'testfile.txt'
  # Actually let's just delete 'TT' (2 backspaces) and continue
  tmux send-keys -t "$TMAX_SESSION:$TMAX_TEST_WINDOW" C-h
  sleep 0.1
  tmux send-keys -t "$TMAX_SESSION:$TMAX_TEST_WINDOW" C-h
  sleep 0.1

  # Type the correct continuation: 'file.txt'
  tmax_type "file.txt"

  # Press Enter to save
  tmux send-keys -t "$TMAX_SESSION:$TMAX_TEST_WINDOW" C-m

  # Wait for save to complete
  sleep 1

  # Verify we're back in normal mode
  tmax_assert_mode "NORMAL"

  # Verify the file was created with the corrected name
  tmax_check_file "$TMAX_PROJECT_ROOT/testfile.txt" "Test content for backspace"

  # Cleanup test files
  cleanup_test_file "test-backspace.txt"
  cleanup_test_file "testfile.txt"
}

# Run test
run_test "Command Mode Backspace" test_command_mode_backspace
