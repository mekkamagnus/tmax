#!/bin/bash
# Configuration for UI Test Harness

# Detect active tmux session
# Try multiple methods: $TMUX var, tmux display-message, and session listing
_tmax_detect_session() {
  # Method 1: inside a tmux pane (most reliable when available)
  if [[ -n "$TMUX" ]] && command -v tmux &> /dev/null; then
    tmux display-message -p '#S' 2>/dev/null
    return
  fi
  # Method 2: tmux server running with sessions (works from child processes)
  if command -v tmux &> /dev/null; then
    local attached
    attached=$(tmux list-sessions -F '#{?session_attached,#{session_name},}' 2>/dev/null | grep -v '^$' | head -1)
    if [[ -n "$attached" ]]; then
      echo "$attached"
      return
    fi
  fi
  echo ""
}

if command -v tmux &> /dev/null; then
  export TMAX_ACTIVE_SESSION="${TMAX_ACTIVE_SESSION:-$(_tmax_detect_session)}"
else
  export TMAX_ACTIVE_SESSION=""
fi

# UI testing mode
# - daemon-tmux: start daemon, run TUI client in tmux, query via tmaxclient (default, most reliable)
# - tmux: start editor directly in tmux panes (legacy)
# - direct: basic non-tmux startup/output checks
# - auto: choose daemon-tmux when tmux sessions exist, else direct
export TMAX_UI_TEST_MODE="${TMAX_UI_TEST_MODE:-auto}"
if [[ "$TMAX_UI_TEST_MODE" == "auto" ]]; then
  if command -v tmux &> /dev/null && [[ -n "$TMAX_ACTIVE_SESSION" ]]; then
    export TMAX_UI_TEST_MODE="daemon-tmux"
  else
    export TMAX_UI_TEST_MODE="direct"
  fi
fi

# Session Configuration
# Use detected session if available, otherwise fallback to default
if [[ -n "$TMAX_ACTIVE_SESSION" ]]; then
  export TMAX_SESSION="${TMAX_SESSION:-$TMAX_ACTIVE_SESSION}"
else
  export TMAX_SESSION="${TMAX_SESSION:-tmax-ui-tests}"
fi

export TMAX_WINDOW_PREFIX="${TMAX_WINDOW_PREFIX:-test-}"
export TMAX_CONTROL_WINDOW="control"
export TMAX_TEST_WINDOW="${TMAX_TEST_WINDOW:-test-editor}"

# Cleanup Configuration
export TMAX_KEEP_WINDOW="${TMAX_KEEP_WINDOW:-false}"
export TMAX_INTERACTIVE="${TMAX_INTERACTIVE:-false}"

# Timing Configuration
export TMAX_DEFAULT_TIMEOUT="${TMAX_DEFAULT_TIMEOUT:-10}"
export TMAX_KEY_DELAY="${TMAX_KEY_DELAY:-0.1}"
export TMAX_OPERATION_DELAY="${TMAX_OPERATION_DELAY:-0.5}"
export TMAX_STARTUP_WAIT="${TMAX_STARTUP_WAIT:-3}"

# Capture Configuration
export TMAX_CAPTURE_LINES="${TMAX_CAPTURE_LINES:-100}"

# Debug Configuration
export TMAX_DEBUG="${TMAX_DEBUG:-false}"
export TMAX_VERBOSE="${TMAX_VERBOSE:-false}"

# Paths
DEFAULT_TMAX_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export TMAX_PROJECT_ROOT="${TMAX_PROJECT_ROOT:-$DEFAULT_TMAX_PROJECT_ROOT}"
export TMAX_TEST_DIR="${TMAX_TEST_DIR:-/tmp/tmax-ui-tests}"
export TMAX_DIRECT_OUTPUT_FILE="${TMAX_DIRECT_OUTPUT_FILE:-$TMAX_TEST_DIR/direct-editor.log}"
export TMAX_DIRECT_STATUS_FILE="${TMAX_DIRECT_STATUS_FILE:-$TMAX_TEST_DIR/direct-editor.status}"
export TMAX_DIRECT_TIMEOUT="${TMAX_DIRECT_TIMEOUT:-6}"

# Editor Commands
DEFAULT_BUN_BIN="$(command -v bun 2>/dev/null || true)"
export BUN_BIN="${BUN_BIN:-${DEFAULT_BUN_BIN:-bun}}"

# Daemon/Client Commands (used in daemon-tmux mode)
export TMAX_DAEMON_CMD="${TMAX_DAEMON_CMD:-$BUN_BIN $TMAX_PROJECT_ROOT/src/server/server.ts}"
export TMAX_TUI_CMD="${TMAX_TUI_CMD:-$BUN_BIN $TMAX_PROJECT_ROOT/src/client/tui-client.ts}"
export TMAX_CLIENT_CMD="${TMAX_CLIENT_CMD:-$TMAX_PROJECT_ROOT/bin/tmaxclient}"
export TMAX_SOCKET="${TMAX_SOCKET:-/tmp/tmax-$(id -u)/server}"

# Legacy direct-start command (used in tmux/direct modes)
export TMAX_START_CMD="${TMAX_START_CMD:-$BUN_BIN run src/main.tsx --dev}"
export TMAX_START_FLAGS="${TMAX_START_FLAGS:-}"

# Key Sequences
export TMAX_KEY_ENTER_INSERT="i"
export TMAX_KEY_ENTER_COMMAND=":"
export TMAX_KEY_ENTER_NORMAL="C-["
export TMAX_KEY_ENTER_MX="SPC ;"
export TMAX_KEY_SAVE=":w"
export TMAX_KEY_QUIT=":q"
export TMAX_KEY_SAVE_QUIT=":wq"

# ANSI Color Codes
export TMAX_COLOR_RED='\033[0;31m'
export TMAX_COLOR_GREEN='\033[0;32m'
export TMAX_COLOR_YELLOW='\033[1;33m'
export TMAX_COLOR_BLUE='\033[0;34m'
export TMAX_COLOR_NC='\033[0m'

# State
export TMAX_ACTIVE_WINDOW="${TMAX_ACTIVE_WINDOW:-}"
export TMAX_EDITOR_PID="${TMAX_EDITOR_PID:-}"
export TMAX_DAEMON_PID="${TMAX_DAEMON_PID:-}"
export TMAX_LAST_ACTION="${TMAX_LAST_ACTION:-}"

# Initialize test directory
mkdir -p "$TMAX_TEST_DIR"
