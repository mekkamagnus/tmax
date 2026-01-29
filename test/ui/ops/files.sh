#!/bin/bash
# File Operations

# Source library files (relative to this file)
OPS_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$OPS_DIR/../lib/config.sh"
source "$OPS_DIR/../lib/debug.sh"
source "$OPS_DIR/../core/input.sh"
source "$OPS_DIR/../core/query.sh"
source "$OPS_DIR/editing.sh"

# Save current file
file_save() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Save file"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_vim_command "w" "$window"

  # Wait for save to complete
  sleep "$TMAX_OPERATION_DELAY"

  # Check for success message
  if query_text_visible "Saved" "$window" || query_text_visible "Written" "$window"; then
    log_debug "File saved successfully"
    return 0
  else
    log_warn "Save status unclear"
    return 1
  fi
}

# Save file as
file_save_as() {
  local filepath="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Save file as: $filepath"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key ":" "$window"
  sleep "$TMAX_KEY_DELAY"
  input_send_text "w $filepath" "$window"
  input_send_enter "$window"

  sleep "$TMAX_OPERATION_DELAY"

  if query_text_visible "Saved" "$window"; then
    log_debug "File saved as: $filepath"
    return 0
  else
    log_warn "Save status unclear"
    return 1
  fi
}

# Quit editor (without saving)
file_quit() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Quit editor"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_vim_command "q" "$window"

  sleep "$TMAX_OPERATION_DELAY"
}

# Save and quit
file_save_and_quit() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Save and quit"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_vim_command "wq" "$window"

  sleep "$TMAX_OPERATION_DELAY"
}

# Quit without saving (force quit)
file_quit_force() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Force quit"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_vim_command "q!" "$window"

  sleep "$TMAX_OPERATION_DELAY"
}

# Open a file
file_open() {
  local filepath="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Open file: $filepath"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key ":" "$window"
  sleep "$TMAX_KEY_DELAY"
  input_send_text "e $filepath" "$window"
  input_send_enter "$window"

  sleep "$TMAX_OPERATION_DELAY"

  # Check if file opened successfully
  if ! query_has_errors "$window"; then
    log_debug "File opened: $filepath"
    return 0
  else
    log_error "Failed to open file: $filepath"
    return 1
  fi
}

# Create a new buffer
file_new() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Create new buffer"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_vim_command "enew" "$window"

  sleep "$TMAX_OPERATION_DELAY"
}

# Write all buffers
file_write_all() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Write all buffers"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_vim_command "wa" "$window"

  sleep "$TMAX_OPERATION_DELAY"
}

# Quit all windows
file_quit_all() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Quit all"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_vim_command "qa" "$window"

  sleep "$TMAX_OPERATION_DELAY"
}

# Read file into current buffer
file_read() {
  local filepath="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Read file into buffer: $filepath"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key ":" "$window"
  sleep "$TMAX_KEY_DELAY"
  input_send_text "r $filepath" "$window"
  input_send_enter "$window"

  sleep "$TMAX_OPERATION_DELAY"
}

# Create a test file with content
file_create_test() {
  local filepath="$1"
  local content="${2:-test content}"
  local window="${3:-$TMAX_ACTIVE_WINDOW}"

  log_action "Create test file: $filepath"

  # Create file using shell
  local target
  target=$(_get_window_target "$window") 2>/dev/null || echo "${TMAX_SESSION}:${window}"

  tmux send-keys -t "$target" "echo '$content' > $filepath" Enter
  sleep "$TMAX_OPERATION_DELAY"
}

# Append content to file
file_append() {
  local filepath="$1"
  local content="$2"
  local window="${3:-$TMAX_ACTIVE_WINDOW}"

  log_action "Append to file: $filepath"

  local target
  target=$(_get_window_target "$window") 2>/dev/null || echo "${TMAX_SESSION}:${window}"

  tmux send-keys -t "$target" "echo '$content' >> $filepath" Enter
  sleep "$TMAX_OPERATION_DELAY"
}

# Get file content
file_get_content() {
  local filepath="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  local target
  target=$(_get_window_target "$window") 2>/dev/null || echo "${TMAX_SESSION}:${window}"

  # Send cat command and capture output
  tmux send-keys -t "$target" "cat $filepath" Enter
  sleep "$TMAX_OPERATION_DELAY"

  query_capture_output "$window"
}

# Delete test file
file_delete_test() {
  local filepath="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Delete test file: $filepath"

  local target
  target=$(_get_window_target "$window") 2>/dev/null || echo "${TMAX_SESSION}:${window}"

  tmux send-keys -t "$target" "rm -f $filepath" Enter
  sleep "$TMAX_OPERATION_DELAY"
}

# Check if file exists
file_exists() {
  local filepath="$1"

  [[ -f "$filepath" ]]
}

# Get file size
file_size() {
  local filepath="$1"

  if [[ -f "$filepath" ]]; then
    wc -c < "$filepath"
  else
    echo "0"
  fi
}
