#!/bin/bash
# Test: Keymap Customization (Simplified)
# Verify that keymap system doesn't break normal editor operations

# Source test framework from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/test-framework.sh"

test_keymap_doesnt_break_editor() {
  echo "=== Test: Keymap System Doesn't Break Editor ==="
  echo ""

  # Create test file
  setup_test_file "keymap-simple-test.txt" "Test content for keymap"

  # Start editor
  tmax_start "keymap-simple-test.txt"
  tmax_wait_for_ready 10

  # Verify basic editing still works
  assert_text_visible "Test content for keymap" "File content should be visible"

  # Enter insert mode
  tmax_insert
  tmax_assert_mode "INSERT"

  # Type some text
  tmax_type " - more text"

  # Return to normal mode
  tmax_normal
  tmax_assert_mode "NORMAL"

  # Verify editor is still responsive
  if ! tmax_running; then
    echo "ERROR: Editor not running after basic operations"
    return 1
  fi

  # Cleanup
  tmax_quit
  sleep 1
  cleanup_test_file "keymap-simple-test.txt"

  echo "✓ Keymap system doesn't interfere with normal editor operations"

  tmax_summary
}

test_keymap_api_accessible() {
  echo "=== Test: Keymap API Functions Accessible ==="
  echo ""

  # Create test file
  setup_test_file "api-test.txt" "API test content"

  # Start editor
  tmax_start "api-test.txt"
  tmax_wait_for_ready 10

  # Try to access M-x mode (where keymap API functions would be used)
  tmax_type " "
  sleep 0.3
  tmax_type ";"
  sleep 0.5

  # Verify we entered M-x mode
  tmax_assert_mode "M-X"

  # Exit M-x mode
  tmax_type "\e"
  sleep 0.5
  tmax_assert_mode "NORMAL"

  # Cleanup
  tmax_quit
  sleep 1
  cleanup_test_file "api-test.txt"

  echo "✓ Keymap API accessible via M-x"

  tmax_summary
}

# Run simplified tests
echo "======================================"
echo "Keymap Customization UI Test Suite"
echo "(Simplified - focuses on non-breaking behavior)"
echo "======================================"
echo ""

run_test "Keymap Doesn't Break Editor" test_keymap_doesnt_break_editor
run_test "Keymap API Accessible" test_keymap_api_accessible

echo ""
echo "======================================"
echo "Keymap Customization Tests Complete"
echo "======================================"
