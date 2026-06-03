"""tmax UI test harness — functional Python API."""

from .types import (
    HarnessConfig, HarnessState, HarnessError,
    Result, Ok, Err, Option, Some, Nothing,
    AssertionResult, AssertionSummary,
)
from .harness import init, start, stop, cleanup, get_mode, get_text, is_running
from .assertions import (
    assert_text_visible, assert_mode, assert_daemon_mode,
    assert_daemon_text, assert_no_errors, assert_running,
    assert_screen_fill, assert_file_exists, assert_file_contains,
    assert_tui_connected, assert_tui_ready, assert_render_count_at_least,
    assert_no_client_errors, assert_frame_editor_sync,
    assert_cursor_position, assert_cursor_line, assert_cursor_col,
    assert_buffer_text_equals, assert_buffer_not_contains,
    assert_buffer_list_contains, assert_buffer_modified,
    assert_not_daemon_error,
    assert_file_not_contains, assert_file_content_equals,
    assert_status_line_visible, assert_render_count_advanced,
    summarize, format_summary,
)
from .operations import (
    enter_insert, enter_normal, enter_visual,
    enter_command_mode, exit_command_mode,
    enter_mx_mode, exit_mx_mode,
    type_text, delete_text, save_file, quit_editor,
    move_cursor, word_next, word_previous,
    line_start, line_end, jump_first_line, jump_last_line,
    page_up, page_down, line_next, line_previous,
    delete_line, undo, redo,
    search, open_file,
    move, create_test_file, delete_test_file,
)
from . import client
from . import queries
