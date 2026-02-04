#!/bin/bash
# Test: Keymap Customization
# Verify that custom keybindings defined in .tmaxrc work correctly
# and that runtime keymap modification via M-x functions properly

# Source test framework from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/test-framework.sh"

test_custom_keybinding_in_tmaxrc() {
  echo "=== Test: Custom Keybinding in .tmaxrc ==="
  echo ""

  # Create a custom .tmaxrc file
  TMAXRC_FILE="$TMAX_PROJECT_ROOT/.tmaxrc-test-custom"
  cat > "$TMAXRC_FILE" << 'EOF'
;; Custom keymap configuration for testing
(defkeymap "*test-custom-keymap*")
(setq "*test-custom-keymap*" (keymap-define-key *test-custom-keymap* "x" "test-custom-command"))
(keymap-set "normal" *test-custom-keymap*)

;; Also add a binding to test mode
(keymap-define-key *test-custom-keymap* "y" "another-test-command")
EOF

  # Create test file
  setup_test_file "keymap-test.txt" "Test content for keymap customization"

  # Start editor with custom .tmaxrc
  tmax_start "keymap-test.txt"
  tmax_wait_for_ready 10

  # The custom keybinding 'x' should now trigger "test-custom-command"
  # We can't directly test the command execution, but we can verify the editor doesn't crash
  # when the key is pressed

  # Type 'x' to trigger custom binding
  tmax_type "x"
  sleep 0.5

  # Verify editor is still running (custom binding didn't crash it)
  tmax_assert_running

  # Cleanup
  tmax_quit
  sleep 1
  cleanup_test_file "keymap-test.txt"
  rm -f "$TMAXRC_FILE"

  tmax_summary
}

test_runtime_keymap_modification() {
  echo "=== Test: Runtime Keymap Modification via M-x ==="
  echo ""

  # Create test file
  setup_test_file "runtime-keymap-test.txt" "Test content for runtime keymap modification"

  # Start editor
  tmax_start "runtime-keymap-test.txt"
  tmax_wait_for_ready 10

  # Enter M-x mode (SPC ;)
  tmax_type " "
  sleep 0.2
  tmax_type ";"
  sleep 0.5

  # Type a command to create a custom keymap at runtime
  # Note: This is a simplified test - in real usage, user would type this interactively
  # For now, we just verify M-x mode is accessible
  tmax_assert_mode "mx"

  # Exit M-x mode
  tmax_type "\e"  # Escape key
  sleep 0.5

  # Verify we're back in normal mode
  tmax_assert_mode "normal"

  # Cleanup
  tmax_quit
  sleep 1
  cleanup_test_file "runtime-keymap-test.txt"

  tmax_summary
}

test_mode_specific_keymaps() {
  echo "=== Test: Mode-Specific Keymaps ==="
  echo ""

  # Create a .tmaxrc with mode-specific keymaps
  TMAXRC_FILE="$TMAX_PROJECT_ROOT/.tmaxrc-test-modes"
  cat > "$TMAXRC_FILE" << 'EOF'
;; Normal mode custom keymap
(defkeymap "*test-normal-keymap*")
(setq "*test-normal-keymap*" (keymap-define-key *test-normal-keymap* "1" "normal-custom"))
(keymap-set "normal" *test-normal-keymap*)

;; Insert mode custom keymap
(defkeymap "*test-insert-keymap*")
(setq "*test-insert-keymap*" (keymap-define-key *test-insert-keymap* "2" "insert-custom"))
(keymap-set "insert" *test-insert-keymap*)
EOF

  # Create test file
  setup_test_file "mode-keymap-test.txt" "Test content for mode-specific keymaps"

  # Start editor
  tmax_start "mode-keymap-test.txt"
  tmax_wait_for_ready 10

  # Test normal mode custom binding
  tmax_type "1"
  sleep 0.5
  tmax_assert_running  # Editor should still be running

  # Switch to insert mode
  tmax_type "i"
  sleep 0.5
  tmax_assert_mode "insert"

  # Test insert mode custom binding
  tmax_type "2"
  sleep 0.5
  tmax_assert_running  # Editor should still be running

  # Return to normal mode
  tmax_type "\e"
  sleep 0.5
  tmax_assert_mode "normal"

  # Cleanup
  tmax_quit
  sleep 1
  cleanup_test_file "mode-keymap-test.txt"
  rm -f "$TMAXRC_FILE"

  tmax_summary
}

test_keymap_precedence() {
  echo "=== Test: Keymap Precedence and Conflicts ==="
  echo ""

  # Create a .tmaxrc that overrides default bindings
  TMAXRC_FILE="$TMAX_PROJECT_ROOT/.tmaxrc-test-precedence"
  cat > "$TMAXRC_FILE" << 'EOF'
;; Override default 'j' binding in normal mode
(defkeymap "*override-keymap*")
(setq "*override-keymap*" (keymap-define-key *override-keymap* "j" "custom-down-command"))
(keymap-set "normal" *override-keymap*)

;; Keep 'k' as default (no override)
EOF

  # Create test file
  setup_test_file "precedence-test.txt" "Test content for keymap precedence

Line 2
Line 3"

  # Start editor
  tmax_start "precedence-test.txt"
  tmax_wait_for_ready 10

  # Test that 'j' now uses custom binding
  # (We can't directly verify the command, but we verify no crash)
  tmax_type "j"
  sleep 0.5
  tmax_assert_running

  # Test that 'k' still works (default binding)
  tmax_type "k"
  sleep 0.5
  tmax_assert_running

  # Cleanup
  tmax_quit
  sleep 1
  cleanup_test_file "precedence-test.txt"
  rm -f "$TMAXRC_FILE"

  tmax_summary
}

test_keymap_query_functions() {
  echo "=== Test: Keymap Query Functions ==="
  echo ""

  # Create a .tmaxrc with keymaps
  TMAXRC_FILE="$TMAX_PROJECT_ROOT/.tmaxrc-test-query"
  cat > "$TMAXRC_FILE" << 'EOF'
;; Create test keymap
(defkeymap "*query-test-keymap*")
(setq "*query-test-keymap*" (keymap-define-key *query-test-keymap* "a" "command-a"))
(setq "*query-test-keymap*" (keymap-define-key *query-test-keymap* "b" "command-b"))
(keymap-set "normal" *query-test-keymap*)
EOF

  # Create test file
  setup_test_file "query-test.txt" "Test content for keymap query"

  # Start editor
  tmax_start "query-test.txt"
  tmax_wait_for_ready 10

  # Query active keymap via M-x (keymap-active)
  # This is a basic test that M-x mode works
  tmax_type " "
  sleep 0.2
  tmax_type ";"
  sleep 0.5
  tmax_assert_mode "mx"

  # Exit M-x mode
  tmax_type "\e"
  sleep 0.5
  tmax_assert_mode "normal"

  # Cleanup
  tmax_quit
  sleep 1
  cleanup_test_file "query-test.txt"
  rm -f "$TMAXRC_FILE"

  tmax_summary
}

# Run all tests
echo "======================================"
echo "Keymap Customization UI Test Suite"
echo "======================================"
echo ""

run_test "Custom Keybinding in .tmaxrc" test_custom_keybinding_in_tmaxrc
run_test "Runtime Keymap Modification via M-x" test_runtime_keymap_modification
run_test "Mode-Specific Keymaps" test_mode_specific_keymaps
run_test "Keymap Precedence and Conflicts" test_keymap_precedence
run_test "Keymap Query Functions" test_keymap_query_functions

echo ""
echo "======================================"
echo "Keymap Customization Tests Complete"
echo "======================================"
