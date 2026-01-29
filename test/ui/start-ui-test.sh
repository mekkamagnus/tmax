#!/bin/bash
# UI Blackbox Test Suite Runner
# Runs all UI integration tests in order

set -e  # Exit on test failure

TEST_DIR="$(dirname "$0")/tests"
TOTAL=0
PASSED=0
FAILED=0

echo "==================================="
echo "  tmax UI Blackbox Test Suite"
echo "==================================="
echo ""

# Run each test
for test in "$TEST_DIR"/[0-9][0-9]-*.test.sh; do
  if [ -f "$test" ]; then
    TOTAL=$((TOTAL + 1))
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Running: $(basename "$test")"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if bash "$test"; then
      PASSED=$((PASSED + 1))
      echo "✓ PASSED"
    else
      FAILED=$((FAILED + 1))
      echo "✗ FAILED"
    fi
    echo ""
  fi
done

echo "==================================="
echo "  Test Suite Summary"
echo "==================================="
echo "Total:   $TOTAL"
echo "Passed:  $PASSED"
echo "Failed:  $FAILED"
echo "==================================="

if [ $FAILED -gt 0 ]; then
  exit 1
fi

exit 0
