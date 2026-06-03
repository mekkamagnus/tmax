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

# ============================================================================
# DAEMON LIFECYCLE
# ============================================================================

# Start the tmax daemon in background
daemon_start() {
  log_info "Starting tmax daemon..."

  # Check if already running
  if daemon_is_running; then
    log_info "Daemon already running"
    return 0
  fi

  # Start daemon in background
  (
    cd "$TMAX_PROJECT_ROOT" || exit 1
    $TMAX_DAEMON_CMD >/dev/null 2>&1
  ) &

  export TMAX_DAEMON_PID=$!

  # Wait for daemon to be ready (ping via client)
  local attempts=0
  local max_attempts=25
  while [ $attempts -lt $max_attempts ]; do
    if "$TMAX_CLIENT_CMD" --ping >/dev/null 2>&1; then
      log_info "Daemon started (pid: $TMAX_DAEMON_PID)"
      return 0
    fi
    sleep 0.2
    attempts=$((attempts + 1))
  done

  log_error "Daemon failed to start within 5 seconds"
  export TMAX_DAEMON_PID=""
  return 1
}

# Stop the tmax daemon
daemon_stop() {
  log_info "Stopping tmax daemon..."

  if ! daemon_is_running; then
    log_info "Daemon not running"
    export TMAX_DAEMON_PID=""
    return 0
  fi

  # Try graceful shutdown via client
  "$TMAX_CLIENT_CMD" --eval '(editor-quit)' 2>/dev/null || true
  sleep 0.5

  # Force kill if still running
  if [[ -n "$TMAX_DAEMON_PID" ]] && ps -p "$TMAX_DAEMON_PID" >/dev/null 2>&1; then
    kill "$TMAX_DAEMON_PID" 2>/dev/null || true
    sleep 0.3
  fi

  # Clean up socket
  if [[ -S "$TMAX_SOCKET" ]]; then
    rm -f "$TMAX_SOCKET"
  fi

  export TMAX_DAEMON_PID=""
  log_info "Daemon stopped"
}

# Check if daemon is running
daemon_is_running() {
  [[ -n "$TMAX_DAEMON_PID" ]] && ps -p "$TMAX_DAEMON_PID" >/dev/null 2>&1
}

# Evaluate T-Lisp expression via daemon client
daemon_eval() {
  local expr="$1"
  "$TMAX_CLIENT_CMD" --eval "$expr" 2>/dev/null
}

# ============================================================================
# EDITOR LIFECYCLE
# ============================================================================

# Start the editor
editor_start() {
  local file="${1:-}"

  if [[ "$TMAX_UI_TEST_MODE" == "daemon-tmux" ]]; then
    _editor_start_daemon_tmux "$file"
    return $?
  fi

  if [[ "$TMAX_UI_TEST_MODE" == "direct" ]]; then
    _editor_start_direct "$file"
    return $?
  fi

  # Legacy tmux mode
  _editor_start_tmux "$file"
  return $?
}

# Start in daemon-tmux mode: daemon in background + TUI client in tmux window
_editor_start_daemon_tmux() {
  local file="${1:-}"

  log_info "Starting editor in daemon-tmux mode${file:+ with file: $file}"

  # Start daemon first
  if ! daemon_start; then
    log_error "Failed to start daemon"
    return 1
  fi

  # Open file in daemon if specified
  if [[ -n "$file" ]]; then
    "$TMAX_CLIENT_CMD" "$file" 2>/dev/null || true
  fi

  # Create test window and launch TUI client
  session_create_test_window
  session_set_active_window "$TMAX_TEST_WINDOW"

  # Start TUI client in the tmux window
  input_send_command "cd $TMAX_PROJECT_ROOT"
  input_send_command "$TMAX_TUI_CMD"

  # Wait for editor to be ready
  sleep "$TMAX_STARTUP_WAIT"

  if query_wait_for_ready "$TMAX_DEFAULT_TIMEOUT" "$TMAX_TEST_WINDOW"; then
    log_info "Editor started successfully in daemon-tmux mode"
    export TMAX_EDITOR_PID=$(tmux list-panes -t "${TMAX_SESSION}:${TMAX_TEST_WINDOW}" -F "#{pane_pid}" 2>/dev/null | head -1)
    return 0
  else
    log_error "Editor failed to start in daemon-tmux mode"
    dump_state "$TMAX_TEST_WINDOW"
    return 1
  fi
}

# Start in direct mode (no tmux)
_editor_start_direct() {
  local file="${1:-}"

  log_info "Starting editor in direct mode${file:+ with file: $file}"

  local start_cmd="$TMAX_START_CMD"
  if [[ -n "$file" ]]; then
    start_cmd="$start_cmd $file"
  fi

  mkdir -p "$TMAX_TEST_DIR"
  : > "$TMAX_DIRECT_OUTPUT_FILE"
  : > "$TMAX_DIRECT_STATUS_FILE"

  (
    cd "$TMAX_PROJECT_ROOT" || exit 1
    timeout "${TMAX_DIRECT_TIMEOUT}s" bash -lc "$start_cmd" > "$TMAX_DIRECT_OUTPUT_FILE" 2>&1
    echo "$?" > "$TMAX_DIRECT_STATUS_FILE"
  ) &

  export TMAX_EDITOR_PID=$!
  sleep "$TMAX_STARTUP_WAIT"

  if query_wait_for_ready "$TMAX_DEFAULT_TIMEOUT"; then
    log_info "Editor startup check completed in direct mode"
    return 0
  fi

  log_error "Editor failed startup checks in direct mode"
  return 1
}

# Start in legacy tmux mode (no daemon)
_editor_start_tmux() {
  local file="${1:-}"

  log_info "Starting editor in tmux mode${file:+ with file: $file}"

  local start_cmd="$TMAX_START_CMD"
  if [[ -n "$file" ]]; then
    start_cmd="$start_cmd $file"
  fi

  # Create test window (visible in active session)
  session_create_test_window
  session_set_active_window "$TMAX_TEST_WINDOW"

  # Change to project directory
  input_send_command "cd $TMAX_PROJECT_ROOT"

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

  if [[ "$TMAX_UI_TEST_MODE" == "daemon-tmux" ]]; then
    _editor_stop_daemon_tmux "$window"
    return $?
  fi

  if [[ -z "$window" ]]; then
    log_error "No active window"
    return 1
  fi

  if [[ "$TMAX_UI_TEST_MODE" == "direct" ]]; then
    if [[ -n "$TMAX_EDITOR_PID" ]]; then
      kill "$TMAX_EDITOR_PID" 2>/dev/null || true
    fi
    export TMAX_EDITOR_PID=""
    return 0
  fi

  # Legacy tmux mode
  _editor_stop_tmux "$window"
}

# Stop in daemon-tmux mode
_editor_stop_daemon_tmux() {
  local window="${1:-$TMAX_TEST_WINDOW}"

  log_info "Stopping editor (daemon-tmux mode)"

  # Quit TUI client via tmux keys
  if [[ -n "$window" ]]; then
    input_send_escape "$window"
    sleep 0.2
    input_send_keys "q" "$window"
    sleep 0.5
  fi

  # Kill tmux window
  if [[ "$TMAX_KEEP_WINDOW" != "true" ]] && [[ -n "$window" ]]; then
    session_kill_window "$window" 2>/dev/null || true
  fi

  # Stop daemon
  daemon_stop

  export TMAX_EDITOR_PID=""
}

# Stop in legacy tmux mode
_editor_stop_tmux() {
  local window="${1:-}"

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
