#!/bin/bash
# Debug and Logging Utilities

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

# Logging functions
log_info() {
  echo -e "${TMAX_COLOR_GREEN}[INFO]${TMAX_COLOR_NC} $1"
}

log_warn() {
  echo -e "${TMAX_COLOR_YELLOW}[WARN]${TMAX_COLOR_NC} $1"
}

log_error() {
  echo -e "${TMAX_COLOR_RED}[ERROR]${TMAX_COLOR_NC} $1"
}

log_debug() {
  if [[ "$TMAX_DEBUG" == "true" ]] || [[ "$TMAX_VERBOSE" == "true" ]]; then
    echo -e "${TMAX_COLOR_BLUE}[DEBUG]${TMAX_COLOR_NC} $1"
  fi
}

log_action() {
  local action="$1"
  log_debug "Action: $action"
  export TMAX_LAST_ACTION="$action"
}

# Enable debug mode
debug_enable() {
  export TMAX_DEBUG=true
  export TMAX_VERBOSE=true
  log_info "Debug mode enabled"
}

# Disable debug mode
debug_disable() {
  export TMAX_DEBUG=false
  export TMAX_VERBOSE=false
  log_info "Debug mode disabled"
}

# Dump current state to file
dump_state() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"
  local output_file="${2:-$TMAX_TEST_DIR/state-dump-$(date +%s).txt}"

  {
    echo "=== TMAX UI Test State Dump ==="
    echo "Timestamp: $(date)"
    echo "Window: $window"
    echo "Session: $TMAX_SESSION"
    echo "Active Window: $TMAX_ACTIVE_WINDOW"
    echo "Last Action: $TMAX_LAST_ACTION"
    echo ""
    echo "=== Window Output ==="
    if [[ "$TMAX_UI_TEST_MODE" == "direct" ]]; then
      cat "$TMAX_DIRECT_OUTPUT_FILE" 2>/dev/null || echo "No direct output available"
    else
      tmux capture-pane -t "$TMAX_SESSION:$window" -p -S -"$TMAX_CAPTURE_LINES" 2>/dev/null || echo "Failed to capture window"
    fi
    echo ""
    echo "=== Environment ==="
    echo "TMAX_DEBUG: $TMAX_DEBUG"
    echo "TMAX_VERBOSE: $TMAX_VERBOSE"
  } > "$output_file"

  log_info "State dumped to: $output_file"
  echo "$output_file"
}

# Show last actions
show_last_actions() {
  log_info "Last action: $TMAX_LAST_ACTION"
}

# Capture screenshot (save pane output)
capture_screenshot() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"
  local output_file="${2:-$TMAX_TEST_DIR/screenshot-$(date +%s).txt}"

  if [[ "$TMAX_UI_TEST_MODE" == "direct" ]]; then
    cat "$TMAX_DIRECT_OUTPUT_FILE" > "$output_file" 2>/dev/null || true
  else
    tmux capture-pane -t "$TMAX_SESSION:$window" -p -S -"$TMAX_CAPTURE_LINES" > "$output_file" 2>/dev/null
  fi
  log_info "Screenshot saved to: $output_file"
  echo "$output_file"
}

# Show current state
show_state() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  echo "=== Current Editor State ==="
  echo "Window: $window"
  echo "Session: $TMAX_SESSION"
  echo ""

  if [[ "$TMAX_UI_TEST_MODE" == "direct" ]]; then
    echo "Mode: DIRECT"
    echo ""
    echo "=== Captured Output ==="
    cat "$TMAX_DIRECT_OUTPUT_FILE" 2>/dev/null || echo "No direct output available"
    return 0
  fi

  if tmux list-sessions 2>/dev/null | grep -q "^$TMAX_SESSION:"; then
    echo "Session: RUNNING"
  else
    echo "Session: NOT RUNNING"
    return 1
  fi

  if [[ -n "$window" ]] && tmux list-windows -t "$TMAX_SESSION" 2>/dev/null | grep -q "$window"; then
    echo "Window: EXISTS"
    echo ""
    echo "=== Window Content ==="
    tmux capture-pane -t "$TMAX_SESSION:$window" -p -S -"$TMAX_CAPTURE_LINES"
  else
    echo "Window: NOT FOUND"
  fi
}
