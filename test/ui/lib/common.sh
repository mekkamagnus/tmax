#!/bin/bash
# Common Utility Functions for UI Test Harness
# Centralized utilities to eliminate code duplication across modules

# Source dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/debug.sh"

# ==============================================================================
# Window Target Utilities
# ==============================================================================

# Get the full window target (session:window)
# Parameters:
#   $1 - Window name (optional, defaults to TMAX_ACTIVE_WINDOW)
# Returns:
#   Full target string "session:window"
# Errors:
#   Returns 1 if no active window is set
get_window_target() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  if [[ -z "$window" ]]; then
    log_error "No active window set. Use session_set_active_window() first."
    return 1
  fi

  echo "${TMAX_SESSION}:${window}"
}

# ==============================================================================
# Mode Verification Utilities
# ==============================================================================

# Verify that the editor is in the expected mode
# Parameters:
#   $1 - Expected mode (INSERT, NORMAL, COMMAND, M-X)
#   $2 - Window name (optional, defaults to TMAX_ACTIVE_WINDOW)
#   $3 - Timeout in seconds (optional, defaults to 5)
# Returns:
#   0 if mode matches, 1 if timeout or mismatch
verify_mode_change() {
  local expected_mode="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"
  local timeout="${3:-5}"

  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    local actual_mode
    actual_mode=$(query_get_mode "$window")

    if [[ "$actual_mode" == "$expected_mode" ]]; then
      log_debug "Successfully entered $expected_mode mode"
      return 0
    fi

    sleep 0.5
    ((elapsed++))
  done

  actual_mode=$(query_get_mode "$window")
  log_warn "Mode is: $actual_mode (expected $expected_mode)"
  return 1
}

# ==============================================================================
# Session Validation Utilities
# ==============================================================================

# Validate that tmux is installed
# Returns:
#   0 if tmux is installed, 1 otherwise
validate_tmux_installation() {
  if ! command -v tmux &> /dev/null; then
    log_error "tmux is not installed. Please install tmux first."
    return 1
  fi
  return 0
}

# Validate that we're in a tmux session
# Returns:
#   0 if in tmux session, 1 otherwise
validate_tmux_session() {
  if [[ -z "$TMUX" ]]; then
    log_error "Not in a tmux session. UI tests must be run from within tmux."
    log_error "Start tmux with: tmux new -s my-session"
    return 1
  fi
  return 0
}

# ==============================================================================
# Window Cleanup Utilities
# ==============================================================================

# Kill all windows matching a pattern
# Parameters:
#   $1 - Window pattern to match (exact name match)
#   $2 - Session name (optional, defaults to TMAX_SESSION)
kill_matching_windows() {
  local window_pattern="$1"
  local session="${2:-$TMAX_SESSION}"

  local window_ids=$(tmux list-windows -t "$session" -F "#{window_name} #{window_id}" 2>/dev/null | grep "^${window_pattern} " | awk '{print $2}')

  if [[ -n "$window_ids" ]]; then
    log_info "Killing windows matching pattern '$window_pattern': $window_ids"
    for wid in $window_ids; do
      tmux kill-window -t "$session:$wid" 2>/dev/null
    done
    sleep "$TMAX_OPERATION_DELAY"
  fi
}
