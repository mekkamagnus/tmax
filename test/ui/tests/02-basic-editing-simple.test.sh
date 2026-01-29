#!/bin/bash
# Test: Basic Editing - Simplified
# Verify basic text editing functionality

# Source API from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/api.sh"

test_basic_editing_simple() {
  echo "=== Test: Basic Editing (Simplified) ==="

  tmax_init

  # Create a test file in project root
  echo "ABC" > /home/mekael/Documents/tmax/test-edit-simple.txt

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
  if grep -q "ABCX" /home/mekael/Documents/tmax/test-edit-simple.txt; then
    echo "✓ File contains ABCX - typing works!"
    rm -f /home/mekael/Documents/tmax/test-edit-simple.txt
    tmax_cleanup
    return 0
  else
    echo "✗ File does not contain ABCX"
    echo "File content:"
    cat /home/mekael/Documents/tmax/test-edit-simple.txt || echo "File not found"
    echo "Keeping file for inspection at /home/mekael/Documents/tmax/test-edit-simple.txt"
    tmax_cleanup
    return 1
  fi
}

# Run test
test_basic_editing_simple
