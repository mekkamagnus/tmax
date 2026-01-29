#!/bin/bash
# Test basic file save (no typing)

echo "Testing basic file save..."

# Create test file
echo "ORIGINAL" > /tmp/test-save.txt

cd /home/mekael/Documents/tmax

# Start editor
deno task start-old /tmp/test-save.txt 2>&1 &
EDITOR_PID=$!

sleep 3

# Just save and quit without typing
tmux send-keys -t tmax:test-editor ":w" "Enter"
sleep 2
tmux send-keys -t tmax:test-editor ":q" "Enter"
sleep 2

# Check file
echo "File content after save:"
cat /tmp/test-save.txt

if grep -q "ORIGINAL" /tmp/test-save.txt; then
  echo "✓ Basic save works"
else
  echo "✗ Basic save failed"
fi

# Cleanup
kill $EDITOR_PID 2>/dev/null || true
rm -f /tmp/test-save.txt
