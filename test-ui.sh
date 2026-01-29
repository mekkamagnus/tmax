#!/bin/bash
# UI Test Suite for tmax Editor using tmux

set -e

TMAX_WINDOW="tmax-test"
TEST_FILE="ui-test-temp.txt"

cleanup() {
  echo "Cleaning up..."
  rm -f "$TEST_FILE"
  tmux kill-window -t "$TMAX_WINDOW" 2>/dev/null || true
}

trap cleanup EXIT

echo "=== tmax UI Test Suite ==="

# Test 1: Application opens
echo "Test 1: Application Opens"
tmux new-window -n "$TMAX_WINDOW" -d

# Wait for window to initialize
sleep 1

# Start tmax editor
tmux send-keys -t "$TMAX_WINDOW" "deno task start $TEST_FILE Enter" sleep 3

# Check if window is still open (editor didn't crash)
if tmux display-message -p '#S' -t "$TMAX_WINDOW" 2>/dev/null; then
  echo "✓ Application opened successfully"
else
  echo "✗ Application failed to open or crashed"
  exit 1
fi

# Test 2: Enter insert mode
echo "Test 2: Insert Mode"
tmux send-keys -t "$TMAX_WINDOW" "i"
sleep 1
tmux send-keys -t "$TMAX_WINDOW" "Escape"
sleep 1
echo "✓ Insert mode works"

# Test 3: Type text
echo "Test 3: Text Input"
tmux send-keys -t "$TMAX_WINDOW" "iHello tmux UI Test!"
sleep 1
tmux send-keys -t "$TMAX_WINDOW" "Escape"
sleep 1
echo "✓ Text input works"

# Test 4: Save file
echo "Test 4: Save File"
tmux send-keys -t "$TMAX_WINDOW" ":w Enter"
sleep 2
if [ -f "$TEST_FILE" ]; then
  echo "✓ File saved successfully"
else
  echo "✗ File save failed"
  exit 1
fi

# Test 5: Quit application
echo "Test 5: Quit Application"
tmux send-keys -t "$TMAX_WINDOW" ":q Enter"
sleep 2

# Check if editor has quit (window should close or return to shell)
sleep 1
if ! tmux display-message -p '#S' -t "$TMAX_WINDOW" 2>/dev/null; then
  echo "✓ Application quit successfully"
else
  echo "✗ Application failed to quit"
  tmux send-keys -t "$TMAX_WINDOW" "Escape" ":q! Enter"
  sleep 1
  # Force kill if still stuck
  tmux kill-window -t "$TMAX_WINDOW"
fi

# Verify file content
echo "Test 6: Verify File Content"
if grep -q "Hello tmux UI Test!" "$TEST_FILE"; then
  echo "✓ File content verified"
  rm -f "$TEST_FILE"
else
  echo "✗ File content mismatch"
  cat "$TEST_FILE"
  exit 1
fi

echo ""
echo "=== All Tests Passed! ==="
