#!/bin/bash
# Demo: Interactive UI Testing
# This demonstrates the new interactive testing capabilities

set -e

echo "========================================="
echo "  Interactive UI Testing Demo"
echo "========================================="
echo ""
echo "This demo will:"
echo "1. Detect your active tmux session"
echo "2. Create a visible test window"
echo "3. Start the editor in that window"
echo "4. Keep the window open for inspection"
echo ""

# Check if in tmux
if [[ -z "$TMUX" ]]; then
    echo -e "\033[1;33mWarning: Not in tmux session\033[0m"
    echo "For best results, run this from within tmux."
    echo ""
    echo "Starting in detached mode..."
fi

# Initialize test harness
source "$(dirname "$0")/lib/api.sh"

echo "========================================="
echo "Step 1: Initialize"
echo "========================================="
tmax_init

echo ""
echo "========================================="
echo "Step 2: Create Test File"
echo "========================================="
echo "" > /home/mekael/Documents/tmax/demo-test.txt
echo "Created test file: demo-test.txt"

echo ""
echo "========================================="
echo "Step 3: Start Editor (in visible window)"
echo "========================================="
echo "A new window named 'test-editor' will open in your tmux session"
echo "Watch the window to see the editor start!"
echo ""

sleep 2

tmax_start "demo-test.txt"

echo ""
echo "========================================="
echo "Step 4: Editor Running"
echo "========================================="
echo "Window location: $TMAX_SESSION:$TMAX_TEST_WINDOW"
echo ""
echo "The editor is now running in the test window."
echo "You can:"
echo "  - Switch to the window: tmux select-window -t $TMAX_SESSION:$TMAX_TEST_WINDOW"
echo "  - See the window content: tmux capture-pane -t $TMAX_SESSION:$TMAX_TEST_WINDOW -p"
echo ""

# Keep window open for inspection
export TMAX_KEEP_WINDOW=true

echo "Press Enter to quit the editor and finish demo..."
read -r

tmax_quit

echo ""
echo "========================================="
echo "Demo Complete"
echo "========================================="
echo ""
echo "Test window remains open for inspection."
echo "Window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
echo ""
echo "To close the window manually:"
echo "  tmux kill-window -t $TMAX_SESSION:$TMAX_TEST_WINDOW"
echo ""
echo "To run actual tests:"
echo "  cd test/ui && bash interactive-test.sh"
echo ""
