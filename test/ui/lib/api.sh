#!/bin/bash
# Main API - Single entry point for all UI testing operations

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source all modules
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/debug.sh"

# Core modules
source "$SCRIPT_DIR/../core/session.sh"
source "$SCRIPT_DIR/../core/input.sh"
source "$SCRIPT_DIR/../core/query.sh"
source "$SCRIPT_DIR/../core/editor.sh"

# Operations
source "$SCRIPT_DIR/../ops/editing.sh"
source "$SCRIPT_DIR/../ops/navigation.sh"
source "$SCRIPT_DIR/../ops/files.sh"

# Assertions
source "$SCRIPT_DIR/../assert/assertions.sh"

# ============================================================================
# HIGH-LEVEL API FUNCTIONS
# Functions designed for AI assistant usage
# ============================================================================

# Initialize the test harness
tmax_init() {
  log_info "Initializing tmax UI test harness..."

  # Validate tmux environment
  session_validate

  # Detect and use active tmux session
  if [[ -n "$TMAX_ACTIVE_SESSION" ]]; then
    log_info "Using active tmux session: $TMAX_SESSION"
  else
    log_info "Using tmux session: $TMAX_SESSION"
  fi

  session_create

  log_info "Test harness ready"
  log_info "Session: $TMAX_SESSION"
  log_info "Test window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
  log_info "Test directory: $TMAX_TEST_DIR"
}

# Cleanup and shutdown (test window only)
tmax_cleanup() {
  if [[ "$TMAX_KEEP_WINDOW" == "true" ]]; then
    log_info "Test window kept for manual inspection"
    log_info "Window location: $TMAX_SESSION:$TMAX_TEST_WINDOW"
    log_info "Close manually when done inspecting"
  else
    log_info "Cleaning up tmax UI test harness..."
    session_cleanup
    log_info "Cleanup complete"
  fi
}

# Full cleanup (entire session)
tmax_cleanup_full() {
  log_info "Full cleanup: killing tmux session..."
  session_kill
  log_info "Session killed: $TMAX_SESSION"
}

# Start editor (with optional file)
tmax_start() {
  local file="${1:-}"

  log_info "Starting tmax editor..."

  if [[ -n "$file" ]]; then
    editor_start "$file"
  else
    editor_start ""
  fi
}

# Stop editor
tmax_stop() {
  log_info "Stopping tmax editor..."

  editor_stop "$TMAX_TEST_WINDOW"
}

# Restart editor
tmax_restart() {
  local file="${1:-}"

  log_info "Restarting tmax editor..."

  editor_stop "$TMAX_TEST_WINDOW" 2>/dev/null || true
  sleep 1
  editor_start "$file"
}

# ============================================================================
# EDITING API
# ============================================================================

# Enter insert mode
tmax_insert() {
  editing_enter_insert_mode "$TMAX_TEST_WINDOW"
}

# Enter normal mode
tmax_normal() {
  editing_enter_normal_mode "$TMAX_TEST_WINDOW"
}

# Enter command mode
tmax_command() {
  editing_enter_command_mode "$TMAX_TEST_WINDOW"
}

# Type text
tmax_type() {
  local text="$1"

  editing_type_text "$text" "$TMAX_TEST_WINDOW"
}

# Type and then normal mode
tmax_type_line() {
  local text="$1"

  tmax_insert
  editing_type_text "$text" "$TMAX_TEST_WINDOW"
  input_send_escape "$TMAX_TEST_WINDOW"
}

# Save file
tmax_save() {
  file_save "$TMAX_TEST_WINDOW"
}

# Quit
tmax_quit() {
  file_quit "$TMAX_TEST_WINDOW"
}

# Save and quit
tmax_save_quit() {
  file_save_and_quit "$TMAX_TEST_WINDOW"
}

# ============================================================================
# NAVIGATION API
# ============================================================================

# Move cursor
tmax_move() {
  local direction="$1"
  local count="${2:-1}"

  case "$direction" in
    up|u|k)
      nav_up "$count" "$TMAX_TEST_WINDOW"
      ;;
    down|d|j)
      nav_down "$count" "$TMAX_TEST_WINDOW"
      ;;
    left|l|h)
      nav_left "$count" "$TMAX_TEST_WINDOW"
      ;;
    right|r|l)
      nav_right "$count" "$TMAX_TEST_WINDOW"
      ;;
    *)
      log_error "Unknown direction: $direction"
      return 1
      ;;
  esac
}

# Go to line
tmax_goto_line() {
  local line="$1"

  nav_goto_line "$line" "$TMAX_TEST_WINDOW"
}

# Go to first line
tmax_first_line() {
  nav_goto_first_line "$TMAX_TEST_WINDOW"
}

# Go to last line
tmax_last_line() {
  nav_goto_last_line "$TMAX_TEST_WINDOW"
}

# ============================================================================
# QUERY API
# ============================================================================

# Get current mode
tmax_mode() {
  query_get_mode "$TMAX_TEST_WINDOW"
}

# Check if text is visible
tmax_visible() {
  local pattern="$1"

  query_text_visible "$pattern" "$TMAX_TEST_WINDOW"
}

# Get visible text
tmax_text() {
  query_get_visible_text "$TMAX_TEST_WINDOW"
}

# Check if running
tmax_running() {
  query_is_running "$TMAX_TEST_WINDOW"
}

# ============================================================================
# ASSERTION API
# ============================================================================

# Assert text visible
tmax_assert_text() {
  local pattern="$1"
  local message="${2:-Text should be visible: $pattern}"

  assert_text_visible "$pattern" "$message" "$TMAX_TEST_WINDOW"
}

# Assert mode
tmax_assert_mode() {
  local expected_mode="$1"
  local message="${2:-Should be in mode: $expected_mode}"

  assert_mode "$expected_mode" "$message" "$TMAX_TEST_WINDOW"
}

# Assert no errors
tmax_assert_no_errors() {
  local message="${1:-No errors should be present}"

  assert_no_errors "$message" "$TMAX_TEST_WINDOW"
}

# Print summary
tmax_summary() {
  assert_summary
}

# ============================================================================
# DEBUG API
# ============================================================================

# Enable debug mode
tmax_debug() {
  debug_enable
}

# Disable debug mode
tmax_nodebug() {
  debug_disable
}

# Show current state
tmax_state() {
  show_state "$TMAX_TEST_WINDOW"
}

# Dump state to file
tmax_dump() {
  dump_state "$TMAX_TEST_WINDOW"
}

# Capture screenshot
tmax_screenshot() {
  local output_file="${1:-}"

  if [[ -n "$output_file" ]]; then
    capture_screenshot "$TMAX_TEST_WINDOW" "$output_file"
  else
    capture_screenshot "$TMAX_TEST_WINDOW"
  fi
}

# ============================================================================
# HELPERS
# ============================================================================

# Wait for text
tmax_wait_for() {
  local pattern="$1"
  local timeout="${2:-$TMAX_DEFAULT_TIMEOUT}"

  query_wait_for_text "$pattern" "$timeout" "$TMAX_TEST_WINDOW"
}

# Wait for editor to be ready
tmax_wait_for_ready() {
  local timeout="${1:-$TMAX_DEFAULT_TIMEOUT}"

  query_wait_for_ready "$timeout" "$TMAX_TEST_WINDOW"
}

# Wait for mode
tmax_wait_for_mode() {
  local mode="$1"
  local timeout="${2:-$TMAX_DEFAULT_TIMEOUT}"

  query_wait_for_mode "$mode" "$timeout" "$TMAX_TEST_WINDOW"
}

# Sleep
tmax_sleep() {
  local seconds="$1"

  sleep "$seconds"
}

# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

# Quick edit: start, type, save, quit
tmax_quick_edit() {
  local file="$1"
  local content="$2"

  log_info "Quick edit: $file"

  editor_start "$file"
  sleep 1
  tmax_insert
  editing_type_text "$content" "$TMAX_TEST_WINDOW"
  tmax_normal
  file_save "$TMAX_TEST_WINDOW"
  file_quit "$TMAX_TEST_WINDOW"
}

# Create test file
tmax_create_test_file() {
  local file="$1"
  local content="${2:-test content}"

  file_create_test "$file" "$content" "$TMAX_TEST_WINDOW"
}

# Check file content
tmax_check_file() {
  local file="$1"
  local pattern="$2"

  assert_file_exists "$file" "File should exist: $file"
  assert_file_contains "$file" "$pattern" "File should contain: $pattern"
}

# ============================================================================
# HELPERS FOR AI ASSISTANTS
# ============================================================================

# List all available functions
tmax_list_functions() {
  echo "=== tmax UI Test Harness - Available Functions ==="
  echo ""
  echo "Lifecycle:"
  echo "  tmax_init, tmax_cleanup, tmax_start, tmax_stop, tmax_restart"
  echo ""
  echo "Editing:"
  echo "  tmax_insert, tmax_normal, tmax_command, tmax_type, tmax_type_line"
  echo "  tmax_save, tmax_quit, tmax_save_quit"
  echo ""
  echo "Navigation:"
  echo "  tmax_move [up|down|left|right] [count]"
  echo "  tmax_goto_line [n], tmax_first_line, tmax_last_line"
  echo ""
  echo "Query:"
  echo "  tmax_mode, tmax_visible [pattern], tmax_text, tmax_running"
  echo ""
  echo "Assertion:"
  echo "  tmax_assert_text [pattern], tmax_assert_mode [mode]"
  echo "  tmax_assert_no_errors, tmax_summary"
  echo ""
  echo "Debug:"
  echo "  tmax_debug, tmax_nodebug, tmax_state, tmax_dump, tmax_screenshot"
  echo ""
  echo "Helpers:"
  echo "  tmax_wait_for [pattern] [timeout], tmax_sleep [seconds]"
  echo "  tmax_quick_edit [file] [content]"
  echo ""
  echo "For more details, see: test/ui/README.md"
}

# Show help for a function
tmax_help() {
  local func_name="$1"

  case "$func_name" in
    tmax_start)
      echo "Start the tmax editor"
      echo "Usage: tmax_start [file]"
      echo ""
      echo "Examples:"
      echo "  tmax_start           # Start with empty buffer"
      echo "  tmax_start test.txt  # Open test.txt"
      ;;
    tmax_type)
      echo "Type text in insert mode"
      echo "Usage: tmax_type <text>"
      echo ""
      echo "Example:"
      echo "  tmax_type 'Hello World'"
      ;;
    tmax_move)
      echo "Move cursor in specified direction"
      echo "Usage: tmax_move <direction> [count]"
      echo ""
      echo "Directions: up, down, left, right"
      echo ""
      echo "Examples:"
      echo "  tmax_move down 5     # Move down 5 lines"
      echo "  tmax_move right      # Move right 1 character"
      ;;
    *)
      echo "No specific help available for: $func_name"
      echo "Use 'tmax_list_functions' to see all available functions"
      ;;
  esac
}

# Export all functions
export -f tmax_init tmax_cleanup tmax_cleanup_full tmax_start tmax_stop tmax_restart
export -f tmax_insert tmax_normal tmax_command tmax_type tmax_type_line
export -f tmax_save tmax_quit tmax_save_quit
export -f tmax_move tmax_goto_line tmax_first_line tmax_last_line
export -f tmax_mode tmax_visible tmax_text tmax_running
export -f tmax_assert_text tmax_assert_mode tmax_assert_no_errors tmax_summary
export -f tmax_debug tmax_nodebug tmax_state tmax_dump tmax_screenshot
export -f tmax_wait_for tmax_wait_for_ready tmax_wait_for_mode tmax_sleep
export -f tmax_quick_edit tmax_create_test_file tmax_check_file
export -f tmax_list_functions tmax_help

# Auto-initialization message
if [[ -z "$TMAX_UI_HARNESS_LOADED" ]]; then
  log_info "tmax UI Test Harness loaded"
  log_info "Type 'tmax_list_functions' to see available commands"
  export TMAX_UI_HARNESS_LOADED=true
fi
