#!/bin/bash
# Navigation Operations

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/config.sh"
source "$SCRIPT_DIR/../lib/debug.sh"
source "$SCRIPT_DIR/../core/input.sh"
source "$SCRIPT_DIR/../core/query.sh"

# Move cursor: h (left)
nav_left() {
  local count="${1:-1}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Move left $count"

  editing_enter_normal_mode "$window" 2>/dev/null || true

  for (( i=0; i<count; i++ )); do
    input_send_key "h" "$window"
    sleep "$TMAX_KEY_DELAY"
  done
}

# Move cursor: l (right)
nav_right() {
  local count="${1:-1}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Move right $count"

  editing_enter_normal_mode "$window" 2>/dev/null || true

  for (( i=0; i<count; i++ )); do
    input_send_key "l" "$window"
    sleep "$TMAX_KEY_DELAY"
  done
}

# Move cursor: k (up)
nav_up() {
  local count="${1:-1}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Move up $count"

  editing_enter_normal_mode "$window" 2>/dev/null || true

  for (( i=0; i<count; i++ )); do
    input_send_key "k" "$window"
    sleep "$TMAX_KEY_DELAY"
  done
}

# Move cursor: j (down)
nav_down() {
  local count="${1:-1}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Move down $count"

  editing_enter_normal_mode "$window" 2>/dev/null || true

  for (( i=0; i<count; i++ )); do
    input_send_key "j" "$window"
    sleep "$TMAX_KEY_DELAY"
  done
}

# Move to start of line
nav_line_start() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Move to line start"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key "0" "$window"
}

# Move to end of line
nav_line_end() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Move to line end"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key "$" "$window"
}

# Go to specific line (gg)
nav_goto_line() {
  local line_number="$1"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Go to line: $line_number"

  editing_enter_normal_mode "$window" 2>/dev/null || true

  # Type line number then 'gg'
  input_send_text "$line_number" "$window"
  input_send_key "g" "$window"
  sleep "$TMAX_KEY_DELAY"
  input_send_key "g" "$window"
}

# Go to first line of file
nav_goto_first_line() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Go to first line"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key "g" "$window"
  sleep "$TMAX_KEY_DELAY"
  input_send_key "g" "$window"
}

# Go to last line of file
nav_goto_last_line() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Go to last line"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key "G" "$window"
}

# Move forward by word
nav_word_forward() {
  local count="${1:-1}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Move forward $count word(s)"

  editing_enter_normal_mode "$window" 2>/dev/null || true

  for (( i=0; i<count; i++ )); do
    input_send_key "w" "$window"
    sleep "$TMAX_KEY_DELAY"
  done
}

# Move backward by word
nav_word_backward() {
  local count="${1:-1}"
  local window="${2:-$TMAX_ACTIVE_WINDOW}"

  log_action "Move backward $count word(s)"

  editing_enter_normal_mode "$window" 2>/dev/null || true

  for (( i=0; i<count; i++ )); do
    input_send_key "b" "$window"
    sleep "$TMAX_KEY_DELAY"
  done
}

# Page down (Ctrl+f)
nav_page_down() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Page down"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key "C-f" "$window"
}

# Page up (Ctrl+b)
nav_page_up() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Page up"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key "C-b" "$window"
}

# Half page down (Ctrl+d)
nav_half_page_down() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Half page down"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key "C-d" "$window"
}

# Half page up (Ctrl+u)
nav_half_page_up() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Half page up"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key "C-u" "$window"
}

# Jump to matching bracket
nav_match_bracket() {
  local window="${1:-$TMAX_ACTIVE_WINDOW}"

  log_action "Jump to matching bracket"

  editing_enter_normal_mode "$window" 2>/dev/null || true
  input_send_key "%" "$window"
}

# Source editing operations for mode switching
OPS_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$OPS_DIR/editing.sh"
