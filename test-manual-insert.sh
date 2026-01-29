#!/bin/bash
# Manual test to reproduce character insertion bug

echo "=== Step 1: Create test file ==="
echo "ABC" > /tmp/test.txt
echo "Created /tmp/test.txt with content: ABC"

echo ""
echo "=== Step 2: Instructions for manual testing ==="
echo "Run the following command in another terminal:"
echo "  cd /home/mekael/Documents/tmax"
echo "  deno task start-old /tmp/test.txt"
echo ""
echo "Then:"
echo "  1. Press 'i' to enter INSERT mode"
echo "  2. Type 'X' character"
echo "  3. Press Escape to return to NORMAL mode"
echo "  4. Type ':w' and Enter to save"
echo "  5. Type ':q' and Enter to quit"
echo ""
echo "=== Step 3: Check file content ==="
echo "After quitting, run: cat /tmp/test.txt"
echo "Expected: ABCX"
echo "If bug exists: ABC (without the X)"
echo ""
echo "Press Enter when ready to check file content..."
read

echo "=== File content ==="
cat /tmp/test.txt
echo ""

# Cleanup
echo "Cleanup test file? (y/n)"
read answer
if [ "$answer" = "y" ]; then
  rm -f /tmp/test.txt
  echo "Cleaned up /tmp/test.txt"
fi
