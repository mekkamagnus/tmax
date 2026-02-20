#!/bin/bash
# Query Functions - Ask questions about editor state

# Source library files (relative to this file)
CORE_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$CORE_DIR/../lib/config.sh"
source "$CORE_DIR/../lib/debug.sh"


# Read direct-mode output safely
_query_direct_output() {
  if [[ -f "$TMAX_DIRECT_OUTPUT_FILE" ]]; then
    cat "$TMAX_DIRECT_OUTPUT_FILE"
  fi
}

# Capture window output
query_capture_output() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"
  local lines="${2:-$TMAX_CAPTURE_LINES}"

  if [[ "$TMAX_UI_TEST_MODE" == "direct" ]]; then
    _query_direct_output | tail -n "$lines"
    return 0
  fi

  if [[ -z "$window" ]]; then
    log_error "No active window set"
    return 1
  fi

  tmux capture-pane -t "${TMAX_SESSION}:${window}" -p -S -"$lines" 2>/dev/null
}

# Check if text is visible in the window
query_text_visible() {
  local pattern="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  local output
  output=$(query_capture_output "$window")

  echo "$output" | grep -q "$pattern"
  return $?
}

# Get the current mode from status line
query_get_mode() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"
  local output

  output=$(query_capture_output "$window")

  # Look for mode indicators in status line
  if echo "$output" | grep -q "INSERT"; then
    echo "INSERT"
  elif echo "$output" | grep -q "VISUAL"; then
    echo "VISUAL"
  elif echo "$output" | grep -q "COMMAND"; then
    echo "COMMAND"
  elif echo "$output" | grep -q "M-X"; then
    echo "M-X"
  elif echo "$output" | grep -q "NORMAL"; then
    echo "NORMAL"
  else
    echo "UNKNOWN"
  fi
}

# Get cursor position (if shown in status line)
query_get_cursor_position() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"
  local output

  output=$(query_capture_output "$window")

  # Look for cursor position in status line (e.g., "12:34" for line 12, column 34)
  local position
  position=$(echo "$output" | grep -oE "[0-9]+:[0-9]+" | tail -1)

  if [[ -n "$position" ]]; then
    echo "$position"
  else
    echo "0:0"
  fi
}

# Get status message
query_get_status_message() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"
  local output

  output=$(query_capture_output "$window")

  # Extract status line (usually last non-empty line)
  echo "$output" | grep -v "^[[:space:]]*$" | tail -1
}

# Check if editor is running (window exists and has content)
query_is_running() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  if [[ "$TMAX_UI_TEST_MODE" == "direct" ]]; then
    if [[ -n "$TMAX_EDITOR_PID" ]] && ps -p "$TMAX_EDITOR_PID" >/dev/null 2>&1; then
      return 0
    fi
    if [[ -s "$TMAX_DIRECT_OUTPUT_FILE" ]]; then
      return 0
    fi
    return 1
  fi

  if [[ -z "$window" ]]; then
    return 1
  fi

  # Check if session exists
  if ! tmux list-sessions 2>/dev/null | grep -q "^$TMAX_SESSION:"; then
    return 1
  fi

  # Check if window exists
  if ! tmux list-windows -t "$TMAX_SESSION" 2>/dev/null | grep -q "$window"; then
    return 1
  fi

  # Check if editor process is active
  return 0
}

# Check if there are errors
query_has_errors() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"
  local output

  output=$(query_capture_output "$window")

  if [[ "$TMAX_UI_TEST_MODE" == "direct" ]]; then
    if echo "$output" | grep -q "Raw mode is not supported on the current process.stdin"; then
      log_warn "Ignoring expected raw-mode limitation in direct mode"
      return 1
    fi
  fi

  # Look for error indicators
  if echo "$output" | grep -iqE "error|failed|exception"; then
    return 0
  else
    return 1
  fi
}

# Count occurrences of a pattern
query_count_pattern() {
  local pattern="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  local output
  output=$(query_capture_output "$window")

  echo "$output" | grep -c "$pattern" || echo "0"
}

# Get all visible text (for debugging)
query_get_visible_text() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  query_capture_output "$window"
}

# Check if welcome message is visible
query_has_welcome_message() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  query_text_visible "Welcome to tmax" "$window"
}

# Wait for text to appear
query_wait_for_text() {
  local pattern="$1"
  local timeout="${2:-$TMAX_DEFAULT_TIMEOUT}"
  local window="${3:-$TMAX_ACTIVE_WINDOW}"

  local elapsed=0

  while [[ $elapsed -lt $timeout ]]; do
    if query_text_visible "$pattern" "$window"; then
      log_debug "Found pattern: $pattern"
      return 0
    fi

    sleep 0.5
    elapsed=$((elapsed + 1))
  done

  log_error "Timeout waiting for pattern: $pattern"
  return 1
}

# Wait for mode
query_wait_for_mode() {
  local expected_mode="$1"
  local timeout="${2:-$TMAX_DEFAULT_TIMEOUT}"
  local window="${3:-$TMAX_ACTIVE_WINDOW}"

  local elapsed=0

  while [[ $elapsed -lt $timeout ]]; do
    local current_mode
    current_mode=$(query_get_mode "$window")

    if [[ "$current_mode" == "$expected_mode" ]]; then
      log_debug "Mode changed to: $expected_mode"
      return 0
    fi

    sleep 0.5
    elapsed=$((elapsed + 1))
  done

  log_error "Timeout waiting for mode: $expected_mode (current: $current_mode)"
  return 1
}

# Wait for editor to be ready
query_wait_for_ready() {
  local timeout="${1:-$TMAX_DEFAULT_TIMEOUT}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_debug "Waiting for editor to be ready..."

  # Wait for either welcome message or normal mode indicator
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    if query_has_welcome_message "$window" || query_text_visible "NORMAL" "$window"; then
      log_debug "Editor is ready"
      return 0
    fi

    if [[ "$TMAX_UI_TEST_MODE" == "direct" ]] && [[ -f "$TMAX_DIRECT_STATUS_FILE" ]]; then
      if query_text_visible "NORMAL" "$window" || query_text_visible "INSERT" "$window" || query_text_visible "New file:" "$window"; then
        log_debug "Direct mode output indicates editor startup"
        return 0
      fi
    fi

    sleep 0.5
    elapsed=$((elapsed + 1))
  done

  log_error "Timeout waiting for editor to be ready"
  return 1
}
