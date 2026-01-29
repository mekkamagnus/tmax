#!/bin/bash
# Quick test to reproduce the character insertion bug

echo "=== Creating test file ==="
echo "ABC" > /tmp/test-insert-debug.txt

echo "=== Starting editor ==="
# Start editor with test file
deno task start /tmp/test-insert-debug.txt &
EDITOR_PID=$!

sleep 2

echo "=== Sending keys to insert text ==="
# Send 'i' to enter insert mode
tmux send-keys -t tmax:0 'i' Enter
sleep 0.5

# Send 'X' to insert character
tmux send-keys -t tmax:0 'X' Enter
sleep 0.5

# Send Escape to return to normal mode
tmux send-keys -t tmax:0 Escape
sleep 0.5

# Send ':w' to save
tmux send-keys -t tmax:0 ':w' Enter
sleep 1

# Send ':q' to quit
tmux send-keys -t tmax:0 ':q' Enter
sleep 1

echo "=== Checking file content ==="
cat /tmp/test-insert-debug.txt

echo ""
echo "=== Expected: ABCX ==="
echo "=== Actual content shown above ==="

# Cleanup
kill $EDITOR_PID 2>/dev/null
rm -f /tmp/test-insert-debug.txt
