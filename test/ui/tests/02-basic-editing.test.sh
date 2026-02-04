#!/bin/bash
# Test: Basic Editing
# Verify basic text editing functionality

# Source test framework from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/test-framework.sh"

test_basic_editing_logic() {
  # Create a test file in project root
  setup_test_file "test-edit.txt" "Initial content"

  # Start editor with file (relative to project root)
  tmax_start "test-edit.txt"
  tmax_wait_for_ready 10

  # Verify UI fills screen
  assert_screen_fill "UI should fill entire terminal height"

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
  if assert_file_contains "$TMAX_PROJECT_ROOT/test-edit.txt" "Appended text" "File should contain appended text"; then
    # Cleanup only if test passed
    cleanup_test_file "test-edit.txt"
  else
    # Keep file for inspection
    echo "Test failed - file kept at $TMAX_PROJECT_ROOT/test-edit.txt"
    cat "$TMAX_PROJECT_ROOT/test-edit.txt"
  fi
}

# Run test
run_test "Basic Editing" test_basic_editing_logic
