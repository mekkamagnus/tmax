#!/bin/bash
# UI Test Runner
# Run all UI tests and report results

set -e

# Source configuration for color definitions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh"

# Configuration
TEST_DIR="$(dirname "$0")/tests"
TOTAL=0
PASSED=0
FAILED=0
FAILED_TESTS=()
INTERACTIVE_MODE=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --interactive|-i)
      INTERACTIVE_MODE=true
      ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --interactive, -i  Run tests in interactive mode (windows visible)"
      echo "  --help, -h         Show this help message"
      echo ""
      echo "Environment variables:"
      echo "  TMAX_KEEP_WINDOW=true  Keep test windows open after tests"
      echo ""
      echo "Examples:"
      echo "  $0                    # Run tests (non-interactive, auto cleanup)"
      echo "  $0 --interactive       # Run tests (interactive, windows visible)"
      echo "  TMAX_KEEP_WINDOW=true $0  # Keep windows open"
      exit 0
      ;;
  esac
done

echo "========================================="
echo "  tmax UI Test Suite"
echo "========================================="
echo ""

# Check if tmux is available
if ! command -v tmux &> /dev/null; then
    echo -e "${TMAX_COLOR_RED}Error: tmux is not installed${TMAX_COLOR_NC}"
    echo "Install tmux to run UI tests:"
    echo "  sudo apt-get install tmux"
    exit 1
fi

# Check if in tmux session
if [[ -z "$TMUX" ]]; then
    echo -e "${TMAX_COLOR_YELLOW}Warning: Not in a tmux session${TMAX_COLOR_NC}"
    echo "For interactive testing, run from within tmux."
    echo ""
    if [[ "$INTERACTIVE_MODE" == "true" ]]; then
        echo "Starting in detached mode (non-interactive)..."
        INTERACTIVE_MODE=false
    fi
else
    echo -e "${TMAX_COLOR_GREEN}In tmux session: $(tmux display-message -p '#S')${TMAX_COLOR_NC}"
    echo ""
fi

# Set mode based on arguments or environment
if [[ "$INTERACTIVE_MODE" == "true" ]] || [[ "$TMAX_KEEP_WINDOW" == "true" ]]; then
    export TMAX_KEEP_WINDOW=true
    export TMAX_INTERACTIVE=true
    echo -e "${TMAX_COLOR_BLUE}Interactive mode: windows will be visible${TMAX_COLOR_NC}"
    echo ""
else
    export TMAX_KEEP_WINDOW=false
    export TMAX_INTERACTIVE=false
    echo "Non-interactive mode: windows will be cleaned up"
    echo ""
fi

# Kill any existing test session only in non-interactive mode
if [[ "$INTERACTIVE_MODE" == "false" ]]; then
    echo "Cleaning up any existing sessions..."
    tmux kill-session -t tmax-ui-tests 2>/dev/null || true
    sleep 1
fi

# Run all test files
for test_file in "$TEST_DIR"/*.test.sh; do
    if [[ -f "$test_file" ]]; then
        TOTAL=$((TOTAL + 1))
        test_name=$(basename "$test_file" .test.sh)

        echo ""
        echo "========================================="
        echo "Running: $test_name"
        echo "========================================="

        # Run test from test directory to fix relative paths
        if (cd "$(dirname "$test_file")" && bash "$(basename "$test_file")"); then
            PASSED=$((PASSED + 1))
            echo -e "${TMAX_COLOR_GREEN}✓ $test_name PASSED${TMAX_COLOR_NC}"
        else
            FAILED=$((FAILED + 1))
            FAILED_TESTS+=("$test_name")
            echo -e "${TMAX_COLOR_RED}✗ $test_name FAILED${TMAX_COLOR_NC}"
        fi

        # Small delay between tests
        sleep 1
    fi
done

# Final cleanup
echo ""
if [[ "$INTERACTIVE_MODE" == "true" ]]; then
    source "$(dirname "$0")/lib/api.sh"
    echo "========================================="
    echo "Final Test Window Status"
    echo "========================================="
    echo "Window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
    echo ""
    echo -e "${TMAX_COLOR_GREEN}Test window kept open for inspection${TMAX_COLOR_NC}"
    echo ""
    echo "To inspect the window:"
    echo "  tmux select-window -t $TMAX_SESSION:$TMAX_TEST_WINDOW"
    echo ""
    echo "To close the window when done:"
    echo "  tmux kill-window -t $TMAX_SESSION:$TMAX_TEST_WINDOW"
    echo "  Or run: source test/ui/lib/api.sh && tmax_cleanup_full"
    echo ""
else
    echo "Cleaning up..."
    tmux kill-session -t tmax-ui-tests 2>/dev/null || true
fi

# Print summary
echo ""
echo "========================================="
echo "  Test Summary"
echo "========================================="
echo "Total:  $TOTAL"
echo -e "${TMAX_COLOR_GREEN}Passed: ${PASSED}${TMAX_COLOR_NC}"
echo -e "${TMAX_COLOR_RED}Failed: ${FAILED}${TMAX_COLOR_NC}"

if [[ $FAILED -gt 0 ]]; then
    echo ""
    echo -e "${TMAX_COLOR_RED}Failed tests:${TMAX_COLOR_NC}"
    for test in "${FAILED_TESTS[@]}"; do
        echo "  - $test"
    done
    echo ""
    exit 1
else
    echo ""
    echo -e "${TMAX_COLOR_GREEN}All tests passed!${TMAX_COLOR_NC}"
    echo ""
    exit 0
fi
