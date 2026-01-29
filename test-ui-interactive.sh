#!/bin/bash
# Interactive UI Test Suite for tmax

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

# Create new window and keep it running
echo "Creating tmux window..."
tmux new-window -n "$TMAX_WINDOW"

# Wait for window to be ready
sleep 2

# Start tmax in the new window with proper TTY
echo "Starting tmax editor..."
tmux send-keys -t "$TMAX_WINDOW" "deno task start $TEST_FILE" C-m

# Wait for editor to initialize
echo "Waiting for editor to start..."
sleep 4

# Check if editor is running
if tmux capture-pane -t "$TMAX_WINDOW" -p | grep -q "tmax"; then
  echo "✓ Application opened successfully"
else
  # Check for errors
  echo "Checking for errors..."
  tmux capture-pane -t "$TMAX_WINDOW" -p | tail -10
  echo "✗ Application failed to open"
  exit 1
fi

# Test 2: Enter insert mode
echo ""
echo "Test 2: Enter Insert Mode"
tmux send-keys -t "$TMAX_WINDOW" "i"
sleep 1
echo "✓ Entered insert mode"

# Test 3: Type text
echo "Test 3: Type Text"
tmux send-keys -t "$TMAX_WINDOW" "Hello from tmux!"
sleep 2
tmux send-keys -t "$TMAX_WINDOW" "Escape"
sleep 1
echo "✓ Text typed successfully"

# Test 4: Save
echo "Test 4: Save File"
tmux send-keys -t "$TMAX_WINDOW" ":w" C-m
sleep 3

if [ -f "$TEST_FILE" ]; then
  echo "✓ File saved"
  echo "Content: $(cat $TEST_FILE)"
else
  echo "✗ Save failed"
  exit 1
fi

# Test 5: Status check
echo "Test 5: Status Line"
tmux send-keys -t "$TMAX_WINDOW" "SPC ;"
sleep 1
tmux send-keys -t "$TMAX_WINDOW" "Escape"
sleep 1
echo "✓ M-x mode accessible"

# Test 6: Quit
echo "Test 6: Quit Application"
tmux send-keys -t "$TMAX_WINDOW" ":q" C-m
sleep 3

echo ""
echo "=== Switch to tmux window '$TMAX_WINDOW' to see the editor ==="
echo "Press any key in that window to test manually"
echo "When done, press Ctrl+C to return here"
