#!/bin/bash
# Integration test for buffer insert

echo "=== Testing buffer insert via T-Lisp ==="

# Create test file
echo "ABC" > /tmp/test-tlisp-insert.txt

cd /home/mekael/Documents/tmax

# Start editor
tmux new-window -n test-insert -d
tmux send-keys -t tmax:test-insert "cd /home/mekael/Documents/tmax && deno task start-old /tmp/test-tlisp-insert.txt" Enter

sleep 4

# Check initial content
echo "Initial tmux output:"
tmux capture-pane -t tmax:test-insert -p | grep "ABC"

# Try to execute buffer-insert directly via M-x
echo "Trying M-x buffer-insert..."
tmux send-keys -t tmax:test-insert " " ";"  # SPC ; to enter M-x mode
sleep 0.5
tmux send-keys -t tmax:test-insert "X"
sleep 0.5
tmux send-keys -t tmax:test-insert "Enter"
sleep 1

# Check what's visible
echo "After M-x X:"
tmux capture-pane -t tmax:test-insert -p | grep -E "ABC|X|error" | head -5

# Save and quit
tmux send-keys -t tmax:test-insert ":w" Enter
sleep 2
tmux send-keys -t tmax:test-insert ":q" Enter
sleep 2

# Check file
echo "File content:"
cat /tmp/test-tlisp-insert.txt

if grep -q "X" /tmp/test-tlisp-insert.txt; then
  echo "✅ Buffer insert works!"
else
  echo "❌ Buffer insert failed"
fi

# Cleanup
tmux kill-window -t tmax:test-insert
rm -f /tmp/test-tlisp-insert.txt
