#!/bin/bash
# Manual test for typing functionality

echo "Starting manual typing test..."

# Create test file
echo "ABC" > /tmp/test-type.txt

# Start editor in tmux
cd /home/mekael/Documents/tmax
tmux new-window -n test-type -d
tmux send-keys -t tmax:test-type "cd /home/mekael/Documents/tmax && deno task start-old /tmp/test-type.txt" Enter

# Wait for editor to start
sleep 3

# Type: press 'i' to enter insert mode
tmux send-keys -t tmax:test-type "i"
sleep 0.5

# Type 'X'
tmux send-keys -t tmax:test-type "X"
sleep 0.5

# Escape to return to normal mode
tmux send-keys -t tmax:test-type "Escape"
sleep 0.5

# Save: :w Enter
tmux send-keys -t tmax:test-type ":w" Enter
sleep 2

# Quit: :q Enter
tmux send-keys -t tmax:test-type ":q" Enter
sleep 2

# Check file content
echo "File content:"
cat /tmp/test-type.txt

if grep -q "ABCX" /tmp/test-type.txt; then
  echo "✓ SUCCESS: Typing works!"
else
  echo "✗ FAIL: Typing doesn't work"
fi

# Cleanup
tmux kill-window -t tmax:test-type
rm -f /tmp/test-type.txt
