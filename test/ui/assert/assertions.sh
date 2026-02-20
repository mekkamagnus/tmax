#!/bin/bash
# Assertion Functions for Testing

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/config.sh"
source "$SCRIPT_DIR/../lib/debug.sh"
source "$SCRIPT_DIR/../core/query.sh"

# Track assertion results
export TMAX_ASSERTIONS_PASSED=0
export TMAX_ASSERTIONS_FAILED=0
export TMAX_ASSERTIONS_FAILED_LIST=()

# Internal: Record assertion result
_assertion_record() {
  local result="$1"  # 0 = passed, 1 = failed
  local message="$2"

  if [[ $result -eq 0 ]]; then
    TMAX_ASSERTIONS_PASSED=$((TMAX_ASSERTIONS_PASSED + 1))
    log_info "✓ $message"
  else
    TMAX_ASSERTIONS_FAILED=$((TMAX_ASSERTIONS_FAILED + 1))
    TMAX_ASSERTIONS_FAILED_LIST+=("$message")
    log_error "✗ $message"
  fi
}

# Assert that text is visible
assert_text_visible() {
  local pattern="$1"
  local message="${2:-Expected to find: $pattern}"
  local window="${3:-$TMAX_ACTIVE_WINDOW}"

  if query_text_visible "$pattern" "$window"; then
    _assertion_record 0 "$message"
    return 0
  else
    _assertion_record 1 "$message"
    log_error "Pattern not found: $pattern"
    return 1
  fi
}

# Assert that text is NOT visible
assert_text_not_visible() {
  local pattern="$1"
  local message="${2:-Expected NOT to find: $pattern}"
  local window="${3:-$TMAX_ACTIVE_WINDOW}"

  if ! query_text_visible "$pattern" "$window"; then
    _assertion_record 0 "$message"
    return 0
  else
    _assertion_record 1 "$message"
    log_error "Pattern found (should not be present): $pattern"
    return 1
  fi
}

# Assert current mode
assert_mode() {
  local expected_mode="$1"
  local message="${2:-Expected mode: $expected_mode}"
  local window="${3:-$TMAX_ACTIVE_WINDOW}"

  local actual_mode
  actual_mode=$(query_get_mode "$window")

  if [[ "$actual_mode" == "$expected_mode" ]]; then
    _assertion_record 0 "$message"
    return 0
  else
    _assertion_record 1 "$message"
    log_error "Actual mode: $actual_mode"
    return 1
  fi
}

# Assert editor is running
assert_running() {
  local message="${1:-Expected editor to be running}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  if query_is_running "$window"; then
    _assertion_record 0 "$message"
    return 0
  else
    _assertion_record 1 "$message"
    return 1
  fi
}

# Assert no errors
assert_no_errors() {
  local message="${1:-Expected no errors}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  if ! query_has_errors "$window"; then
    _assertion_record 0 "$message"
    return 0
  else
    _assertion_record 1 "$message"
    return 1
  fi
}

# Assert welcome message visible
assert_welcome_message() {
  local message="${1:-Expected welcome message}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  if query_has_welcome_message "$window"; then
    _assertion_record 0 "$message"
    return 0
  else
    _assertion_record 1 "$message"
    return 1
  fi
}

# Assert file exists on filesystem
assert_file_exists() {
  local filepath="$1"
  local message="${2:-Expected file to exist: $filepath}"

  if [[ -f "$filepath" ]]; then
    _assertion_record 0 "$message"
    return 0
  else
    _assertion_record 1 "$message"
    return 1
  fi
}

# Assert file contains text
assert_file_contains() {
  local filepath="$1"
  local pattern="$2"
  local message="${3:-Expected file $filepath to contain: $pattern}"

  if grep -q "$pattern" "$filepath" 2>/dev/null; then
    _assertion_record 0 "$message"
    return 0
  else
    _assertion_record 1 "$message"
    return 1
  fi
}

# Assert equal
assert_equals() {
  local expected="$1"
  local actual="$2"
  local message="${3:-Expected '$expected', got '$actual'}"

  if [[ "$expected" == "$actual" ]]; then
    _assertion_record 0 "$message"
    return 0
  else
    _assertion_record 1 "$message"
    return 1
  fi
}

# Assert not equal
assert_not_equals() {
  local not_expected="$1"
  local actual="$2"
  local message="${3:-Expected not '$not_expected', got '$actual'}"

  if [[ "$not_expected" != "$actual" ]]; then
    _assertion_record 0 "$message"
    return 0
  else
    _assertion_record 1 "$message"
    return 1
  fi
}

# Assert count matches
assert_count() {
  local expected="$1"
  local actual="$2"
  local message="${3:-Expected count $expected, got $actual}"

  if [[ "$expected" -eq "$actual" ]]; then
    _assertion_record 0 "$message"
    return 0
  else
    _assertion_record 1 "$message"
    return 1
  fi
}

# Assert UI fills the screen completely
# Checks that the number of visible lines matches the terminal height
assert_screen_fill() {
  local message="${1:-UI should fill the entire terminal height}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"
  local tolerance="${3:-2}"  # Allow small tolerance for borders/padding

  if [[ "$TMAX_UI_TEST_MODE" == "direct" ]]; then
    _assertion_record 0 "$message (direct mode check skipped: no tmux pane)"
    return 0
  fi

  # Get terminal height from tmux
  local term_height
  term_height=$(tmux display -t "${TMAX_SESSION}:${window}" -p '#{pane_height}' 2>/dev/null)

  if [[ -z "$term_height" ]]; then
    _assertion_record 1 "$message (failed to get terminal height)"
    return 1
  fi

  # Capture the output and count lines
  local output
  output=$(query_capture_output "$window")
  local line_count
  line_count=$(echo "$output" | wc -l)

  # Check if line count matches terminal height (within tolerance)
  local diff=$((term_height - line_count))
  local abs_diff=${diff#-}  # Absolute value

  if [[ $abs_diff -le $tolerance ]]; then
    _assertion_record 0 "$message (terminal: ${term_height} lines, rendered: ${line_count} lines)"
    return 0
  else
    _assertion_record 1 "$message (terminal: ${term_height} lines, rendered: ${line_count} lines, diff: ${abs_diff})"
    return 1
  fi
}

# Print assertion summary
assert_summary() {
  local total=$((TMAX_ASSERTIONS_PASSED + TMAX_ASSERTIONS_FAILED))

  echo ""
  echo "=== Assertion Summary ==="
  echo "Total:     $total"
  echo -e "${TMAX_COLOR_GREEN}Passed:    ${TMAX_ASSERTIONS_PASSED}${TMAX_COLOR_NC}"
  echo -e "${TMAX_COLOR_RED}Failed:    ${TMAX_ASSERTIONS_FAILED}${TMAX_COLOR_NC}"

  if [[ $TMAX_ASSERTIONS_FAILED -gt 0 ]]; then
    echo ""
    echo "Failed assertions:"
    for failure in "${TMAX_ASSERTIONS_FAILED_LIST[@]}"; do
      echo "  - $failure"
    done
  fi

  return $TMAX_ASSERTIONS_FAILED
}

# Reset assertion counters
assert_reset() {
  export TMAX_ASSERTIONS_PASSED=0
  export TMAX_ASSERTIONS_FAILED=0
  export TMAX_ASSERTIONS_FAILED_LIST=()
}

# Get assertion results
assert_results() {
  echo "{\"passed\":$TMAX_ASSERTIONS_PASSED,\"failed\":$TMAX_ASSERTIONS_FAILED,\"total\":$((TMAX_ASSERTIONS_PASSED + TMAX_ASSERTIONS_FAILED))}"
}
