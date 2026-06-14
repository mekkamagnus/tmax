#!/usr/bin/env bash
# demo-lib.sh — Shared helper functions for tmax demo scripts.
#
# Provides primitives for driving the tmax daemon via tmaxclient in a
# deterministic, scriptable way. All demos source this file and use
# its functions rather than calling tmaxclient directly — this keeps
# demo scripts clean and ensures consistent error handling.
#
# Usage:
#   source "$(dirname "$0")/demo-lib.sh"
#   demo_start        # ensure daemon is running
#   demo_open file.txt
#   demo_eval '(+ 1 2)'
#   demo_end          # print summary

set -euo pipefail

# ── Paths ───────────────────────────────────────────────────────────
# Resolve project root relative to this script's location.
# Scripts live in .claude/skills/demo/scripts/ — go up 4 levels.
PROJECT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
CLIENT="$PROJECT_DIR/bin/tmaxclient"
SESSION="tmax"
DAEMON_WINDOW="tmax-daemon"

# ── Temp file tracking ──────────────────────────────────────────────
# Accumulate temp files so we can clean them all up at the end.
_DEMO_TEMP_FILES=()

# Create a temp file with given content, track it for cleanup.
# Usage: demo_temp_file "filename.txt" "content"
demo_temp_file() {
  local name="$1"
  local content="${2:-}"
  local path="/tmp/tmax-demo-${name}"
  echo "$content" > "$path"
  _DEMO_TEMP_FILES+=("$path")
  echo "$path"
}

# Remove all temp files created during this demo.
_demo_cleanup() {
  for f in "${_DEMO_TEMP_FILES[@]:-}"; do
    rm -f "$f" 2>/dev/null || true
  done
}

# ── Daemon lifecycle ────────────────────────────────────────────────

# Check if the tmax daemon is responding to pings.
_demo_is_running() {
  "$CLIENT" --ping 2>/dev/null
}

# Wait for the daemon to become ready (up to 10 seconds).
_demo_wait_for_daemon() {
  local attempts=0
  while [ $attempts -lt 20 ]; do
    if _demo_is_running; then
      return 0
    fi
    sleep 0.5
    attempts=$((attempts + 1))
  done
  echo "FAIL: Daemon did not start within 10 seconds" >&2
  return 1
}

# Ensure the tmax daemon is running. Starts it in tmux if needed.
# This is safe to call multiple times — it's idempotent.
#
# Strategy: uses tmux respawn-pane -k to guarantee a clean shell state.
# This avoids the unreliable send-keys + Enter approach where stale shell
# state, wrong cwd, or leftover processes cause silent failures.
demo_start() {
  echo "━━━ tmax Demo ━━━"
  echo ""

  # If already running, just confirm and return.
  if _demo_is_running; then
    echo "✓ Daemon already running"
    return 0
  fi

  # Verify the tmux session exists.
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "FAIL: tmux session '$SESSION' not found. Create it first: tmux new -s tmax" >&2
    return 1
  fi

  # Ensure the daemon window exists.
  if ! tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -q "^${DAEMON_WINDOW}$"; then
    # No daemon window yet — create one in the project directory.
    tmux new-window -t "$SESSION" -n "$DAEMON_WINDOW" -c "$PROJECT_DIR"
  fi

  # Respawn the pane with a fresh shell in the project directory,
  # then start the daemon. The -k flag kills any existing process.
  # This guarantees a clean state regardless of prior window history.
  tmux respawn-pane -t "$SESSION:$DAEMON_WINDOW" -k \
    "cd $PROJECT_DIR && bun src/server/server.ts" 2>/dev/null

  # Wait for it to accept connections.
  _demo_wait_for_daemon
  echo "✓ Daemon started"
}

# ── Editor operations ───────────────────────────────────────────────

# Open a file in the editor.
# Usage: demo_open <filepath>
demo_open() {
  local path="$1"
  "$CLIENT" --open "$path" 2>&1 > /dev/null
  echo "  opened: $path"
}

# Evaluate a T-Lisp expression. Prints the result.
# For errors, extracts just the error message (not the JSON-RPC stack trace).
# Usage: demo_eval '(+ 1 2)'
demo_eval() {
  local expr="$1"
  local result
  result=$("$CLIENT" --eval "$expr" 2>&1) || true
  # Extract the meaningful line from the result:
  #   - For errors: the "error: ..." line (skip stack trace)
  #   - For success: the first line of output
  local display
  if echo "$result" | grep -q "^error:"; then
    display=$(echo "$result" | grep "^error:" | head -1)
  else
    display=$(echo "$result" | head -1)
  fi
  echo "  eval: $expr → $display"
  echo "$display"
}

# Evaluate a T-Lisp expression silently (no output).
# Usage: demo_eval_silent '(set-message-log-level :debug)'
demo_eval_silent() {
  "$CLIENT" --eval "$1" > /dev/null 2>&1 || true
}

# Send a keystroke to the editor.
# Usage: demo_key "j"     # move down
#        demo_key "F5"    # function key
demo_key() {
  local key="$1"
  "$CLIENT" --key "$key" 2>&1 > /dev/null
}

# Insert text at the current cursor position.
# Usage: demo_insert "hello world"
demo_insert() {
  local text="$1"
  "$CLIENT" --insert "$text" 2>&1 > /dev/null
  echo "  inserted: $text"
}

# Save the current buffer.
demo_save() {
  "$CLIENT" --eval '(file-save)' 2>&1 > /dev/null
  echo "  saved"
}

# Show the *Messages* buffer contents.
# Usage: demo_messages
demo_messages() {
  echo "  messages:"
  "$CLIENT" --messages 2>&1 | while IFS= read -r line; do
    echo "    $line"
  done
}

# Show the current buffer text.
# Usage: demo_buffer
demo_buffer() {
  echo "  buffer:"
  "$CLIENT" --eval '(buffer-text)' 2>&1 | while IFS= read -r line; do
    echo "    $line"
  done
}

# Show the current editor state (mode, cursor, filename).
# Usage: demo_state
demo_state() {
  local state
  state=$("$CLIENT" --server-info 2>&1) || true
  echo "  state: $state"
}

# ── Output helpers ──────────────────────────────────────────────────

# Print a section header.
# Usage: demo_section "Format strings"
demo_section() {
  echo ""
  echo "── $1 ──"
}

# Print a step description.
# Usage: demo_step "Opening a file"
demo_step() {
  echo "  → $1"
}

# Print a pass/fail result.
# Usage: demo_check "Message appeared" $?
demo_check() {
  local desc="$1"
  local exit_code="$2"
  if [ "$exit_code" -eq 0 ]; then
    echo "  ✓ $desc"
  else
    echo "  ✗ $desc"
  fi
}

# ── Demo lifecycle ──────────────────────────────────────────────────

# Print a demo summary and clean up.
# Call this at the end of every demo script.
demo_end() {
  echo ""
  echo "━━━ Demo complete ━━━"
  _demo_cleanup
}

# Register cleanup on exit (even on error).
trap _demo_cleanup EXIT
