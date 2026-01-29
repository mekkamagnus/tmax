#!/bin/bash
# Debug test to see what's happening with typing

echo "=== Debug Typing Test ==="

# Create test file
echo "ABC" > /tmp/test-debug.txt

cd /home/mekael/Documents/tmax

# Start editor
tmux new-window -n debug-test -d
tmux send-keys -t tmax:debug-test "cd /home/mekael/Documents/tmax && deno task start-old /tmp/test-debug.txt 2>&1 | tee /tmp/debug.log" Enter

sleep 4

# Check what's visible
echo "=== Initial state ==="
tmux capture-pane -t tmax:debug-test -p | grep -E "ABC|NORMAL|Welcome" | head -10

# Try to type
echo "=== Typing 'i' to enter insert mode ==="
tmux send-keys -t tmax:debug-test "i"
sleep 1

echo "=== After 'i' ==="
tmux capture-pane -t tmax:debug-test -p | grep -E "INSERT|ABC" | head -10

echo "=== Typing 'X' ==="
tmux send-keys -t tmax:debug-test "X"
sleep 1

echo "=== After 'X' ==="
tmux capture-pane -t tmax:debug-test -p | grep -E "ABCX|INSERT|ABC" | head -10

echo "=== Typing Escape ==="
tmux send-keys -t tmax:debug-test "Escape"
sleep 1

echo "=== After Escape ==="
tmux capture-pane -t tmax:debug-test -p | grep -E "NORMAL|ABC" | head -10

echo "=== Saving ==="
tmux send-keys -t tmax:debug-test ":w" Enter
sleep 2

echo "=== Quitting ==="
tmux send-keys -t tmax:debug-test ":q" Enter
sleep 2

echo "=== Final file content ==="
cat /tmp/test-debug.txt

echo "=== Debug log ==="
cat /tmp/debug.log | grep -E "buffer-insert|Unbound|ERROR" | head -20

# Cleanup
tmux kill-window -t tmax:debug-test
rm -f /tmp/test-debug.txt
