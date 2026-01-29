#!/bin/bash
# High-Level Editing Operations

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/config.sh"
source "$SCRIPT_DIR/../lib/debug.sh"
source "$SCRIPT_DIR/../core/input.sh"
source "$SCRIPT_DIR/../core/query.sh"

# Enter insert mode
editing_enter_insert_mode() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Enter insert mode"

  input_send_escape "$window"  # Ensure normal mode first
  sleep 0.1
  input_send_key "$TMAX_KEY_ENTER_INSERT" "$window"
  sleep "$TMAX_OPERATION_DELAY"

  # Verify mode change
  local mode
  mode=$(query_get_mode "$window")
  if [[ "$mode" == "INSERT" ]]; then
    log_debug "Successfully entered INSERT mode"
    return 0
  else
    log_warn "Mode is: $mode (expected INSERT)"
    return 1
  fi
}

# Enter normal mode
editing_enter_normal_mode() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Enter normal mode"

  input_send_key "$TMAX_KEY_ENTER_NORMAL" "$window"
  sleep "$TMAX_OPERATION_DELAY"

  # Verify mode change
  local mode
  mode=$(query_get_mode "$window")
  if [[ "$mode" == "NORMAL" ]]; then
    log_debug "Successfully entered NORMAL mode"
    return 0
  else
    log_warn "Mode is: $mode (expected NORMAL)"
    return 1
  fi
}

# Enter command mode
editing_enter_command_mode() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Enter command mode"

  input_send_escape "$window"  # Ensure normal mode first
  sleep 0.1
  input_send_key "$TMAX_KEY_ENTER_COMMAND" "$window"
  sleep "$TMAX_OPERATION_DELAY"

  # Verify mode change
  local mode
  mode=$(query_get_mode "$window")
  if [[ "$mode" == "COMMAND" ]]; then
    log_debug "Successfully entered COMMAND mode"
    return 0
  else
    log_warn "Mode is: $mode (expected COMMAND)"
    return 1
  fi
}

# Enter M-x mode
editing_enter_mx_mode() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Enter M-x mode"

  input_send_escape "$window"  # Ensure normal mode first
  sleep 0.1
  input_send_sequence "SPC ;" "$window"
  sleep "$TMAX_OPERATION_DELAY"

  # Verify mode change
  local mode
  mode=$(query_get_mode "$window")
  if [[ "$mode" == "M-X" ]]; then
    log_debug "Successfully entered M-X mode"
    return 0
  else
    log_warn "Mode is: $mode (expected M-X)"
    return 1
  fi
}

# Type text in insert mode
editing_type_text() {
  local text="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Type text: $text"

  # Ensure we're in insert mode
  local mode
  mode=$(query_get_mode "$window")
  if [[ "$mode" != "INSERT" ]]; then
    log_warn "Not in INSERT mode, entering INSERT mode"
    editing_enter_insert_mode "$window"
  fi

  input_send_text "$text" "$window"
}

# Type a single character
editing_type_char() {
  local char="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Type char: $char"

  # Ensure we're in insert mode
  local mode
  mode=$(query_get_mode "$window")
  if [[ "$mode" != "INSERT" ]]; then
    editing_enter_insert_mode "$window"
  fi

  input_send_key "$char" "$window"
}

# Delete character(s)
editing_delete_chars() {
  local count="${1:-1}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Delete $count character(s)"

  # In insert mode, use Backspace
  local mode
  mode=$(query_get_mode "$window")
  if [[ "$mode" == "INSERT" ]]; then
    input_send_backspace "$count" "$window"
  else
    # In normal mode, use 'x'
    for (( i=0; i<count; i++ )); do
      input_send_key "x" "$window"
      sleep "$TMAX_KEY_DELAY"
    done
  fi
}

# Delete current line
editing_delete_line() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Delete line"

  # Ensure normal mode
  editing_enter_normal_mode "$window"

  input_send_key "d" "$window"
  sleep "$TMAX_KEY_DELAY"
  input_send_key "d" "$window"
}

# Undo last action
editing_undo() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Undo"

  editing_enter_normal_mode "$window"
  input_send_key "u" "$window"
}

# Redo last undone action
editing_redo() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Redo"

  editing_enter_normal_mode "$window"
  input_send_key "C-r" "$window"
}

# Yank (copy) line
editing_yank_line() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Yank line"

  editing_enter_normal_mode "$window"
  input_send_key "y" "$window"
  sleep "$TMAX_KEY_DELAY"
  input_send_key "y" "$window"
}

# Paste (put)
editing_paste() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Paste"

  editing_enter_normal_mode "$window"
  input_send_key "p" "$window"
}

# Append after cursor
editing_append() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Append after cursor"

  editing_enter_normal_mode "$window"
  input_send_key "a" "$window"
  sleep "$TMAX_OPERATION_DELAY"
}

# Insert at beginning of line
editing_insert_line_start() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Insert at line start"

  editing_enter_normal_mode "$window"
  input_send_key "I" "$window"  # Shift+i
  sleep "$TMAX_OPERATION_DELAY"
}

# Append at end of line
editing_append_line_end() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Append at line end"

  editing_enter_normal_mode "$window"
  input_send_key "A" "$window"  # Shift+a
  sleep "$TMAX_OPERATION_DELAY"
}
