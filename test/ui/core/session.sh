#!/bin/bash
# Tmux Session Management - Uses active session, creates test windows

# Source library files (relative to this file)
CORE_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$CORE_DIR/../lib/config.sh"
source "$CORE_DIR/../lib/debug.sh"
source "$CORE_DIR/../lib/common.sh"

# Get the active tmux session (the one running this script)
session_get_active() {
  validate_tmux_installation || return 1
  validate_tmux_session || return 1

  local session
  session=$(tmux display-message -p '#S' 2>/dev/null)

  if [[ -n "$session" ]]; then
    echo "$session"
    return 0
  else
    log_error "Failed to detect tmux session"
    return 1
  fi
}

# Validate tmux environment - must be in active session
session_validate() {
  log_debug "Validating tmux environment..."

  validate_tmux_installation || return 1
  validate_tmux_session || return 1

  # Detect and use the active session
  local active_session
  active_session=$(session_get_active 2>/dev/null)

  if [[ -z "$active_session" ]]; then
    log_error "Cannot detect active tmux session"
    return 1
  fi

  # Set session to active session
  export TMAX_SESSION="$active_session"
  log_info "Using active tmux session: $TMAX_SESSION"

  return 0
}

# Setup - ensure we're using active session
session_create() {
  log_debug "Using session: $TMAX_SESSION"

  # We don't create sessions - we use the active one
  if ! session_exists; then
    log_error "Session $TMAX_SESSION does not exist"
    return 1
  fi

  log_info "Using active session: $TMAX_SESSION"
  return 0
}

# Kill the test window only (never kill the session)
session_kill() {
  log_warn "session_kill() called - this only removes the test window, not the session"
  session_cleanup
}

# Check if session exists
session_exists() {
  if [[ -z "$TMAX_SESSION" ]]; then
    return 1
  fi

  tmux list-sessions 2>/dev/null | grep -q "^$TMAX_SESSION:"
  return $?
}

# Create a new window in the active session
session_create_window() {
  local name="$1"

  if [[ -z "$name" ]]; then
    log_error "Window name required"
    return 1
  fi

  if ! session_exists; then
    log_error "Session does not exist: $TMAX_SESSION"
    return 1
  fi

  # Check if window already exists
  if tmux list-windows -t "$TMAX_SESSION" 2>/dev/null | grep -q "^[0-9]*: $name "; then
    log_info "Window already exists: $name"
    return 0
  fi

  log_debug "Creating window: $name in session: $TMAX_SESSION"

  tmux new-window -t "$TMAX_SESSION" -n "$name"

  # Wait for window to be ready
  sleep "$TMAX_OPERATION_DELAY"

  log_info "Window created: $TMAX_SESSION:$name"
  echo "$name"
}

# Create test window (visible in active session)
session_create_test_window() {
  if ! session_exists; then
    log_error "Session does not exist: $TMAX_SESSION"
    return 1
  fi

  log_debug "Creating test window in session: $TMAX_SESSION"

  # Kill ALL windows with test-editor name to prevent duplicates
  kill_matching_windows "$TMAX_TEST_WINDOW"

  # Create new test window
  tmux new-window -t "$TMAX_SESSION" -n "$TMAX_TEST_WINDOW"

  # Wait for window to be ready
  sleep "$TMAX_OPERATION_DELAY"

  # Select the window so it's visible
  session_select_test_window

  log_info "Test window created and selected: $TMAX_SESSION:$TMAX_TEST_WINDOW"
  echo "$TMAX_TEST_WINDOW"
}

# Create test window with initial command
session_create_test_window_with_cmd() {
  local cmd="$1"

  if ! session_exists; then
    log_error "Session does not exist: $TMAX_SESSION"
    return 1
  fi

  log_debug "Creating test window in session: $TMAX_SESSION with command"

  # Kill ALL windows with test-editor name to prevent duplicates
  kill_matching_windows "$TMAX_TEST_WINDOW"

  # Create new test window with the specified command
  tmux new-window -t "$TMAX_SESSION" -n "$TMAX_TEST_WINDOW" "$cmd"

  # Wait for window to be ready
  sleep "$TMAX_STARTUP_WAIT"

  # Select the window so it's visible
  session_select_test_window

  log_info "Test window created and selected: $TMAX_SESSION:$TMAX_TEST_WINDOW"
  echo "$TMAX_TEST_WINDOW"
}

# Select the test window (make it visible)
session_select_test_window() {
  if ! session_exists; then
    log_warn "Session does not exist: $TMAX_SESSION"
    return 1
  fi

  tmux select-window -t "$TMAX_SESSION:$TMAX_TEST_WINDOW" 2>/dev/null
  log_debug "Test window selected: $TMAX_SESSION:$TMAX_TEST_WINDOW"
}

# Cleanup test window only (not entire session)
session_cleanup() {
  log_debug "Cleaning up test window: $TMAX_TEST_WINDOW"

  # Kill ALL windows with test-editor name
  kill_matching_windows "$TMAX_TEST_WINDOW"
  log_info "Test window(s) cleaned up"

  export TMAX_ACTIVE_WINDOW=""
  return 0
}

# Kill a specific window
session_kill_window() {
  local name="$1"

  if [[ -z "$name" ]]; then
    log_error "Window name required"
    return 1
  fi

  log_debug "Killing window: $name"

  tmux kill-window -t "$TMAX_SESSION:$name" 2>/dev/null

  if [[ "$TMAX_ACTIVE_WINDOW" == "$name" ]]; then
    export TMAX_ACTIVE_WINDOW=""
  fi

  log_info "Window killed: $name"
}

# List all windows in the session
session_list_windows() {
  if ! session_exists; then
    log_error "Session does not exist: $TMAX_SESSION"
    return 1
  fi

  tmux list-windows -t "$TMAX_SESSION" -F "#{window_name}"
}

# Set the active window for operations
session_set_active_window() {
  local name="$1"

  if [[ -z "$name" ]]; then
    log_error "Window name required"
    return 1
  fi

  if ! session_list_windows | grep -q "^$name$"; then
    log_error "Window does not exist: $name"
    return 1
  fi

  export TMAX_ACTIVE_WINDOW="$name"
  log_debug "Active window set to: $name"
}

# Get the active window name
session_get_active_window() {
  echo "$TMAX_ACTIVE_WINDOW"
}

# Attach to the session (for manual debugging)
session_attach() {
  log_info "Already in session. Use Ctrl+B, W to list windows"
  # No-op since we're already attached
}

# Detach from the session
session_detach() {
  tmux detach-client -s "$TMAX_SESSION"
}
