#!/bin/bash
# Editor Lifecycle Management

# Source library files (relative to this file)
CORE_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$CORE_DIR/../lib/config.sh"
source "$CORE_DIR/../lib/debug.sh"

# Source other core modules (relative to this file)
source "$CORE_DIR/session.sh"
source "$CORE_DIR/input.sh"
source "$CORE_DIR/query.sh"

# Start the editor
editor_start() {
  local file="${1:-}"

  log_info "Starting editor in visible window${file:+ with file: $file}"

  # Create test window (visible in active session)
  session_create_test_window
  session_set_active_window "$TMAX_TEST_WINDOW"

  # Change to project directory
  input_send_command "cd $TMAX_PROJECT_ROOT"

  # Build start command
  local start_cmd="$TMAX_START_CMD"
  if [[ -n "$file" ]]; then
    start_cmd="$start_cmd $file"
  fi

  # Start the editor
  input_send_command "$start_cmd"

  # Wait for editor to be ready
  sleep "$TMAX_STARTUP_WAIT"

  if query_wait_for_ready "$TMAX_DEFAULT_TIMEOUT" "$TMAX_TEST_WINDOW"; then
    log_info "Editor started successfully in window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
    export TMAX_EDITOR_PID=$(tmux list-panes -t "${TMAX_SESSION}:${TMAX_TEST_WINDOW}" -F "#{pane_pid}" | head -1)
    return 0
  else
    log_error "Editor failed to start"
    dump_state "$TMAX_TEST_WINDOW"
    return 1
  fi
}

# Stop the editor (gracefully)
editor_stop() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  if [[ -z "$window" ]]; then
    log_error "No active window"
    return 1
  fi

  log_info "Stopping editor"

  # Try graceful quit first
  input_send_vim_command "q" "$window"

  # Wait a bit
  sleep 1

  # If still running, force quit
  if query_is_running "$window"; then
    log_warn "Editor still running, forcing quit"
    input_send_vim_command "q!" "$window"
    sleep 1
  fi

  # Check if we should keep the window
  if [[ "$TMAX_KEEP_WINDOW" == "true" ]]; then
    log_info "Editor stopped (window kept for inspection: $TMAX_SESSION:$TMAX_TEST_WINDOW)"
    log_info "Window will remain open. Close manually when done."
  else
    # Kill window if still exists
    if query_is_running "$window"; then
      session_kill_window "$window"
    fi
  fi

  export TMAX_EDITOR_PID=""
}

# Restart the editor
editor_restart() {
  local file="${1:-}"
  local window="${2:-$TMAX_TEST_WINDOW}"

  log_info "Restarting editor"

  editor_stop "$window" 2>/dev/null || true
  sleep 1
  editor_start "$file"
}

# Ensure editor is running (start if not)
editor_ensure_running() {
  local file="${1:-}"
  local window="${2:-$TMAX_TEST_WINDOW}"

  if query_is_running "$window"; then
    log_debug "Editor already running"
    return 0
  fi

  log_info "Editor not running, starting..."
  editor_start "$file"
}

# Reset the editor environment (kill and restart clean)
editor_reset() {
  local file="${1:-}"

  log_info "Resetting editor environment"

  # Stop editor
  editor_stop "$TMAX_TEST_WINDOW" 2>/dev/null || true

  # Kill session entirely
  session_kill

  # Wait a bit
  sleep 1

  # Create fresh session
  session_create

  # Start editor
  if [[ -n "$file" ]]; then
    editor_start "$file"
  fi
}

# Get editor PID
editor_get_pid() {
  echo "$TMAX_EDITOR_PID"
}

# Check if editor process is alive
editor_is_alive() {
  local pid="${1:-$TMAX_EDITOR_PID}"

  if [[ -z "$pid" ]]; then
    return 1
  fi

  ps -p "$pid" > /dev/null 2>&1
  return $?
}
