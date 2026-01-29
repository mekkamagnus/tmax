#!/usr/bin/env bash
# tmux UI Test Suite for tmax Editor

# Test 1: Application Opens
ui_test_01_app_opens() {
  local window="tmax-test"
  local testfile="tmux-ui-test.txt"
  
  echo "Test 01: Application Opens"
  
  # Create new window
  tmux new-window -n "$window"
  sleep 1
  
  # Start editor (this runs in the window's TTY)
  tmux send-keys -t "$window" "deno task start $testfile" Enter
  sleep 5
  
  # Check if editor is running by looking for UI elements
  local pane_content=$(tmux capture-pane -t "$window" -p -S -1000)
  
  if echo "$pane_content" | grep -qE "(NORMAL|INSERT|Welcome|tmax)"; then
    echo "✓ Application opened successfully"
    return 0
  else
    echo "✗ Application failed to open"
    echo "Content:"
    echo "$pane_content" | tail -20
    tmux kill-window -t "$window"
    return 1
  fi
}

# Run test
if ui_test_01_app_opens; then
  echo ""
  echo "=== Test Passed! ==="
  echo "Switch to tmux window '$window' to see the editor"
  echo "Window is waiting for you to test manually"
fi
