#!/bin/bash
# Test script to demonstrate runtime logging

echo "=== Runtime Logging Demonstration ==="
echo ""
echo "Starting tmax editor in dev mode with a test file..."
echo "The editor will start and you can press keys to see the runtime logging."
echo ""
echo "Try these key sequences to see different logs:"
echo "  1. Press 'i' to enter insert mode (shows mode change logging)"
echo "  2. Type some text (shows key press DEBUG logs)"
echo "  3. Press Escape to return to normal mode (shows mode change)"
echo "  4. Press ':' to enter command mode (shows mode change)"
echo "  5. Type ':w' and Enter (shows command execution)"
echo "  6. Press 'd' twice to delete a line (shows delete operation)"
echo ""
echo "Press Ctrl+C to exit the editor"
echo ""
echo "Starting editor..."
echo ""

# Start the editor in dev mode
bun run src/main.tsx --dev /Users/mekael/Documents/programming/typescript/tmax/runtime-test.txt 2>&1
