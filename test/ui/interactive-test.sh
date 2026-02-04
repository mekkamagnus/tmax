#!/bin/bash
# Interactive UI Test Runner
# Runs tests visibly in the active tmux session with windows kept open

set -e

# Source configuration for color definitions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh"

# Configuration
export TMAX_KEEP_WINDOW=true
export TMAX_INTERACTIVE=true
TEST_DIR="$(dirname "$0")/tests"
TOTAL=0
PASSED=0
FAILED=0
FAILED_TESTS=()

echo "========================================="
echo "  tmax UI Test Suite - Interactive"
echo "========================================="
echo ""
echo "Tests will run in visible window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
echo "Window will remain open after each test for inspection."
echo ""

# Check if in tmux
if [[ -z "$TMUX" ]]; then
  echo -e "${TMAX_COLOR_YELLOW}Warning: Not in tmux session${TMAX_COLOR_NC}"
  echo "For best experience, run from within tmux."
  echo ""
fi

# Initialize test harness
source "$(dirname "$0")/lib/api.sh"

tmax_init

# Trap to ensure cleanup on exit
trap 'echo -e "\n${TMAX_COLOR_YELLOW}Interrupted. Test window kept open for inspection.${TMAX_COLOR_NC}"' INT

# Run all test files
for test_file in "$TEST_DIR"/*.test.sh; do
    if [[ -f "$test_file" ]]; then
        TOTAL=$((TOTAL + 1))
        test_name=$(basename "$test_file" .test.sh)

        echo ""
        echo "========================================="
        echo -e "${TMAX_COLOR_BLUE}Running: $test_name${TMAX_COLOR_NC}"
        echo "========================================="
        echo "Window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
        echo ""

        if bash "$test_file"; then
            PASSED=$((PASSED + 1))
            echo -e "${TMAX_COLOR_GREEN}✓ $test_name PASSED${TMAX_COLOR_NC}"
        else
            FAILED=$((FAILED + 1))
            FAILED_TESTS+=("$test_name")
            echo -e "${TMAX_COLOR_RED}✗ $test_name FAILED${TMAX_COLOR_NC}"
        fi

        # Show window location and prompt
        echo ""
        echo "========================================="
        echo "Test window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
        echo ""

        if [[ $FAILED -gt 0 ]] && [[ "$INTERACTIVE_DEBUG" == "true" ]]; then
            echo "Test failed. You can inspect the window now."
            echo "Press Enter to continue to next test, or Ctrl+C to quit..."
            read -r
        fi

        # Small delay between tests
        sleep 1
    fi
done

# Final summary
echo ""
echo "========================================="
echo "  Test Summary"
echo "========================================="
echo "Total:  $TOTAL"
echo -e "${TMAX_COLOR_GREEN}Passed: ${PASSED}${TMAX_COLOR_NC}"
echo -e "${TMAX_COLOR_RED}Failed: ${FAILED}${TMAX_COLOR_NC}"

if [[ $FAILED -gt 0 ]]; then
    echo ""
    echo "Failed tests:"
    for test in "${FAILED_TESTS[@]}"; do
        echo "  - $test"
    done
fi

echo ""
echo "========================================="
echo "Final Test Window Status"
echo "========================================="
echo "Window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
echo ""
if [[ "$TMAX_KEEP_WINDOW" == "true" ]]; then
    echo -e "${TMAX_COLOR_GREEN}Test window kept open for inspection${TMAX_COLOR_NC}"
    echo ""
    echo "To inspect the window:"
    echo "  tmux select-window -t $TMAX_SESSION:$TMAX_TEST_WINDOW"
    echo ""
    echo "To close the window when done:"
    echo "  tmux kill-window -t $TMAX_SESSION:$TMAX_TEST_WINDOW"
    echo "  Or: tmax_cleanup_full"
    echo ""
    echo "To close entire session:"
    echo "  tmux kill-session -t $TMAX_SESSION"
else
    echo "Test window cleaned up"
fi

echo ""
echo "========================================="

if [[ $FAILED -gt 0 ]]; then
    exit 1
else
    exit 0
fi
