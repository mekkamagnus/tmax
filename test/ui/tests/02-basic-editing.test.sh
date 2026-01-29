#!/bin/bash
# Test: Basic Editing
# Verify basic text editing functionality

# Source API from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/api.sh"

test_basic_editing() {
  echo "=== Test: Basic Editing ==="

  tmax_init

  # Create a test file in project root
  echo "Initial content" > /home/mekael/Documents/tmax/test-edit.txt

  # Start editor with file (relative to project root)
  tmax_start "test-edit.txt"
  tmax_wait_for_ready 10

  # Verify file loaded
  assert_text_visible "Initial content" "File content should be visible"

  # Enter insert mode and add text
  tmax_insert
  tmax_assert_mode "INSERT"
  tmax_type " - Appended text"

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
  if assert_file_contains "/home/mekael/Documents/tmax/test-edit.txt" "Appended text" "File should contain appended text"; then
    # Cleanup only if test passed
    rm -f /home/mekael/Documents/tmax/test-edit.txt
    tmax_cleanup
  else
    # Keep file for inspection
    echo "Test failed - file kept at /home/mekael/Documents/tmax/test-edit.txt"
    cat /home/mekael/Documents/tmax/test-edit.txt
    tmax_cleanup
  fi

  tmax_summary
}

# Run test
test_basic_editing
