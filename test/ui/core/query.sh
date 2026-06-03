#!/bin/bash
# Query Functions - Ask questions about editor state

# Source library files (relative to this file)
CORE_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$CORE_DIR/../lib/config.sh"
source "$CORE_DIR/../lib/debug.sh"
source "$CORE_DIR/../lib/common.sh"

# ============================================================================
# DAEMON QUERY FUNCTIONS
# ============================================================================

# Evaluate a T-Lisp expression via the daemon and return the result
query_daemon_eval() {
  local expr="$1"

  if [[ "$TMAX_UI_TEST_MODE" != "daemon-tmux" ]]; then
    return 1
  fi

  "$TMAX_CLIENT_CMD" --eval "$expr" 2>/dev/null
}

# Get editor mode via daemon (reliable)
query_daemon_mode() {
  local result
  result=$(query_daemon_eval '(editor-mode)' 2>/dev/null)

  if [[ -z "$result" ]]; then
    echo "UNKNOWN"
    return 1
  fi

  # Normalize the result (may come back as quoted string or bare symbol)
  local mode
  mode=$(echo "$result" | tr -d '"' | tr '[:lower:]' '[:upper:]' | head -1)

  case "$mode" in
    NORMAL|INSERT|VISUAL|COMMAND|M-X|MX)
      echo "$mode"
      return 0
      ;;
    *)
      echo "$mode"
      return 0
      ;;
  esac
}

# Get buffer text via daemon (reliable)
query_daemon_buffer_text() {
  query_daemon_eval '(buffer-text)' 2>/dev/null
}

# Get cursor position via daemon (reliable)
query_daemon_cursor_position() {
  query_daemon_eval '(cursor-position)' 2>/dev/null
}

# Check if a string is in the buffer via daemon
query_daemon_text_contains() {
  local pattern="$1"

  local text
  text=$(query_daemon_buffer_text)
  echo "$text" | grep -q "$pattern"
  return $?
}

# Get current buffer name via daemon
query_daemon_buffer_name() {
  query_daemon_eval '(buffer-current)' 2>/dev/null
}

# ============================================================================
# DIRECT MODE QUERY FUNCTIONS
# ============================================================================

# Read direct-mode output safely
_query_direct_output() {
  if [[ -f "$TMAX_DIRECT_OUTPUT_FILE" ]]; then
    cat "$TMAX_DIRECT_OUTPUT_FILE"
  fi
}

# ============================================================================
# TMUX CAPTURE QUERY FUNCTIONS
# ============================================================================

# Capture window output
# Parameters:
#   $1 - Window name (optional, defaults to TMAX_ACTIVE_WINDOW)
#   $2 - Number of lines to capture (optional, defaults to TMAX_CAPTURE_LINES)
#   $3 - Include scrollback history (optional, defaults to true)
query_capture_output() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"
  local lines="${2:-$TMAX_CAPTURE_LINES}"
  local include_scrollback="${3:-true}"

  if [[ "$TMAX_UI_TEST_MODE" == "direct" ]]; then
    _query_direct_output | tail -n "$lines"
    return 0
  fi

  if [[ -z "$window" ]]; then
    log_error "No active window set"
    return 1
  fi

  if [[ "$include_scrollback" == "true" ]]; then
    # Capture with scrollback history
    tmux capture-pane -t "${TMAX_SESSION}:${window}" -p -S -"$lines" 2>/dev/null
  else
    # Capture only visible pane (no scrollback, no -S flag)
    tmux capture-pane -t "${TMAX_SESSION}:${window}" -p 2>/dev/null
  fi
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

# Get the current mode from status line (screen-scraping fallback)
query_get_mode() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  # Prefer daemon query when available
  if [[ "$TMAX_UI_TEST_MODE" == "daemon-tmux" ]]; then
    local daemon_mode
    daemon_mode=$(query_daemon_mode 2>/dev/null)
    if [[ -n "$daemon_mode" && "$daemon_mode" != "UNKNOWN" ]]; then
      echo "$daemon_mode"
      return 0
    fi
  fi

  # Fallback to screen scraping
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

  # Prefer daemon query when available
  if [[ "$TMAX_UI_TEST_MODE" == "daemon-tmux" ]]; then
    local pos
    pos=$(query_daemon_cursor_position 2>/dev/null)
    if [[ -n "$pos" ]]; then
      # Parse [line, column] format from T-Lisp
      local line col
      line=$(echo "$pos" | grep -oE '[0-9]+' | head -1)
      col=$(echo "$pos" | grep -oE '[0-9]+' | tail -1)
      if [[ -n "$line" && -n "$col" ]]; then
        echo "${line}:${col}"
        return 0
      fi
    fi
  fi

  # Fallback to screen scraping
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

# Check if editor is running
query_is_running() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  if [[ "$TMAX_UI_TEST_MODE" == "daemon-tmux" ]]; then
    # Check both daemon and TUI client
    if daemon_is_running 2>/dev/null; then
      return 0
    fi
    # Also check if TUI window exists
    if [[ -n "$window" ]] && tmux list-windows -t "$TMAX_SESSION" 2>/dev/null | grep -q "$window"; then
      return 0
    fi
    return 1
  fi

  if [[ "$TMAX_UI_TEST_MODE" == "direct" ]]; then
    if [[ -n "$TMAX_EDITOR_PID" ]] && ps -p "$TMAX_EDITOR_PID" >/dev/null 2>&1; then
      return 0
    fi
    if [[ -s "$TMAX_DIRECT_OUTPUT_FILE" ]]; then
      return 0
    fi
    return 1
  fi

  # Legacy tmux mode
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
  local current_mode=""

  while [[ $elapsed -lt $timeout ]]; do
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

  if [[ "$TMAX_UI_TEST_MODE" == "daemon-tmux" ]]; then
    # Wait for daemon to be reachable
    local elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
      if "$TMAX_CLIENT_CMD" --ping >/dev/null 2>&1; then
        log_debug "Daemon is reachable"
        # Also check TUI window if we have one
        if [[ -n "$window" ]] && query_text_visible "NORMAL" "$window"; then
          log_debug "TUI showing NORMAL mode"
          return 0
        fi
        # Daemon up is enough for readiness
        return 0
      fi
      sleep 0.5
      elapsed=$((elapsed + 1))
    done
    log_error "Timeout waiting for daemon to be ready"
    return 1
  fi

  # Legacy: wait for either welcome message or normal mode indicator
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
