#!/bin/bash
# Input Handling - Send keys and commands to tmux windows

# Source library files (relative to this file)
CORE_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$CORE_DIR/../lib/config.sh"
source "$CORE_DIR/../lib/debug.sh"
source "$CORE_DIR/../lib/common.sh"

# Translate special key names to actual control characters
input_translate_key() {
  local key="$1"

  case "$key" in
    "C-[") echo -ne "\x1b" ;;      # Escape
    "Enter") echo -ne "\x0d" ;;     # Return/Enter
    "Space") echo -ne " " ;;        # Space
    "Backspace") echo -ne "\x7f" ;; # Backspace
    "Tab") echo -ne "\x09" ;;      # Tab
    *) echo -n "$key" ;;            # Literal character
  esac
}

# Write input to test input file (for testing)
input_write_to_fifo() {
  local input="$1"

  if [[ -n "$TMAX_TEST_INPUT_FIFO" ]]; then
    # Translate special keys and append to test input file
    local translated=$(input_translate_key "$input")
    echo -n "$translated" >> "$TMAX_TEST_INPUT_FIFO"
    log_debug "Wrote to test input file: $input (as ${#translated} bytes)"
    return 0
  else
    # Test input not configured, fall back to tmux send-keys
    return 1
  fi
}

# Send a single key to the active window
input_send_key() {
  local key="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  # Try FIFO first (for testing)
  if input_write_to_fifo "$key"; then
    log_debug "Sent key via FIFO: $key"
    sleep "$TMAX_KEY_DELAY"
    return 0
  fi

  # Fall back to tmux send-keys
  local target
  target=$(get_window_target "$window") || return 1

  log_action "Send key: $key"

  # Use -l (literal) flag to send keys without translation for raw mode applications
  tmux send-keys -l -t "$target" "$key"

  # Small delay after each key
  sleep "$TMAX_KEY_DELAY"
}

# Send multiple keys in sequence
input_send_keys() {
  local window="$1"
  shift

  local target
  target=$(get_window_target "$window") || return 1

  log_action "Send keys: $*"

  for key in "$@"; do
    # Use -l (literal) flag for raw mode applications
    tmux send-keys -l -t "$target" "$key"
    sleep "$TMAX_KEY_DELAY"
  done
}

# Send a command string (followed by Enter)
input_send_command() {
  local command="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  local target
  target=$(get_window_target "$window") || return 1

  log_action "Send command: $command"

  tmux send-keys -t "$target" "$command" C-m
  sleep "$TMAX_OPERATION_DELAY"
}

# Send text literally (special characters not interpreted)
input_send_text() {
  local text="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Send text: $text"

  # Try to write to test input file first
  if [[ -n "$TMAX_TEST_INPUT_FIFO" ]]; then
    # Write the entire text at once
    echo -n "$text" >> "$TMAX_TEST_INPUT_FIFO"
    log_debug "Wrote text to input file: $text (${#text} chars)"
    sleep "$TMAX_KEY_DELAY"
    return 0
  fi

  # Fall back to tmux send-keys for each character
  local target
  target=$(get_window_target "$window") || return 1

  for (( i=0; i<${#text}; i++ )); do
    char="${text:$i:1}"
    tmux send-keys -l -t "$target" "$char"
    sleep "$TMAX_KEY_DELAY"
  done
}

# Send Enter key
input_send_enter() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Send Enter"
  input_send_key "Enter" "$window"
}

# Send Escape key
input_send_escape() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Send Escape"
  input_send_key "C-[" "$window"
}

# Send Space key
input_send_space() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Send Space"
  input_send_key "Space" "$window"
}

# Send a sequence of keys (e.g., ":w Enter")
input_send_sequence() {
  local sequence="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Send sequence: $sequence"

  # Split by spaces and send each part
  for part in $sequence; do
    case "$part" in
      Enter)
        input_send_enter "$window"
        ;;
      Escape)
        input_send_escape "$window"
        ;;
      Space)
        input_send_space "$window"
        ;;
      C-m)
        input_send_key "C-m" "$window"
        ;;
      *)
        input_send_key "$part" "$window"
        ;;
    esac
  done
}

# Send a Vim-style command (e.g., ":w", ":q")
input_send_vim_command() {
  local command="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Send Vim command: $command"

  input_send_key ":" "$window"
  input_send_text "$command" "$window"
  input_send_enter "$window"
}

# Clear the input line (Ctrl+U)
input_clear_line() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Clear line"
  input_send_key "C-u" "$window"
}

# Delete backwards
input_send_backspace() {
  local count="${1:-1}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Send backspace x$count"

  for (( i=0; i<count; i++ )); do
    input_send_key "Backspace" "$window"
  done
}
