#!/bin/bash
# Test: Full Height Layout
# Verify that the editor UI fills the entire terminal height
# This test catches regressions where the status bar appears in the middle of the screen

# Source API from test/ui root directory
TEST_UI_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$TEST_UI_DIR/../lib/api.sh"

test_full_height_layout() {
  echo "=== Test: Full Height Layout ==="
  echo "Verifying UI fills entire terminal height"
  echo "Running in visible window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
  echo ""

  tmax_init

  # Create a test file with enough lines to fill any reasonable terminal
  # 100 lines should be enough for any terminal (typical max is 50-60 lines)
  TEST_FILE="$TMAX_TEST_DIR/full-height-test.txt"
  {
    for i in {1..100}; do
      echo "Line $i"
    done
  } > "$TEST_FILE"

  echo "Created test file with 100 lines: $TEST_FILE"
  echo ""

  tmax_start "$TEST_FILE"

  # Wait for editor to be ready
  tmax_wait_for_ready 10

  # Get terminal dimensions for reporting
  local term_width term_height
  term_width=$(tmux display -t "${TMAX_SESSION}:${TMAX_TEST_WINDOW}" -p '#{pane_width}')
  term_height=$(tmux display -t "${TMAX_SESSION}:${TMAX_TEST_WINDOW}" -p '#{pane_height}')

  echo "Terminal dimensions: ${term_width}x${term_height}"
  echo ""

  # Assertions
  assert_running "Editor should be running"
  assert_mode "NORMAL" "Should start in NORMAL mode"
  assert_no_errors "No errors should be present"

  # Core assertion: UI should fill the screen
  # We use tolerance of 2 to account for possible borders/padding differences
  assert_screen_fill "UI should fill entire terminal height" "" 2

  # Additional verification: check that status bar is at the bottom
  # by verifying the last visible line is the status line
  local output
  output=$(query_capture_output "$TMAX_TEST_WINDOW")
  local last_line
  last_line=$(echo "$output" | tail -1)

  if echo "$last_line" | grep -q "NORMAL.*Line:.*Col:"; then
    _assertion_record 0 "Status bar should be at bottom of screen"
  else
    _assertion_record 1 "Status bar should be at bottom of screen (found: $last_line)"
  fi

  # Verify that we can see lines beyond the old hardcoded 24-line limit
  # If the terminal is taller than 24 lines, we should see line 25
  if [[ $term_height -gt 24 ]]; then
    if query_text_visible "Line 25" "$TMAX_TEST_WINDOW"; then
      _assertion_record 0 "Should render beyond old 24-line limit (line 25 visible)"
    else
      _assertion_record 1 "Should render beyond old 24-line limit (line 25 not visible)"
    fi
  fi

  tmax_summary

  # Cleanup
  tmax_quit
  sleep 1
  rm -f "$TEST_FILE"
  tmax_cleanup
}

# Run test
test_full_height_layout
