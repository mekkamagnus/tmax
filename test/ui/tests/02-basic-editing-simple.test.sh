#!/bin/bash
# Test: Basic Editing - Simplified
# Verify basic text editing functionality

# Source test framework from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/test-framework.sh"

test_basic_editing_simple_logic() {
  # Create a test file in project root
  setup_test_file "test-edit-simple.txt" "ABC"

  # Start editor with file
  tmax_start "test-edit-simple.txt"
  tmax_wait_for_ready 10

  # Verify file loaded
  assert_text_visible "ABC" "File content should be visible"

  # Enter insert mode at end of line
  tmax_move right 3  # Move to end of "ABC"
  tmax_insert
  tmax_assert_mode "INSERT"

  # Type a single character
  tmax_type "X"

  # Return to normal mode
  tmax_normal
  tmax_assert_mode "NORMAL"

  # Save the file
  tmax_save
  sleep 2

  # Quit and verify file content
  tmax_quit
  sleep 1

  # Check file was saved
  if grep -q "ABCX" "$TMAX_PROJECT_ROOT/test-edit-simple.txt"; then
    echo "✓ File contains ABCX - typing works!"
    cleanup_test_file "test-edit-simple.txt"
    return 0
  else
    echo "✗ File does not contain ABCX"
    echo "File content:"
    cat "$TMAX_PROJECT_ROOT/test-edit-simple.txt" || echo "File not found"
    echo "Keeping file for inspection at $TMAX_PROJECT_ROOT/test-edit-simple.txt"
    return 1
  fi
}

# Run test
run_test "Basic Editing (Simplified)" test_basic_editing_simple_logic
