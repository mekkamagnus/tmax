"""Test: Navigation — cursor movement, word motion, line boundaries."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_daemon_mode, assert_cursor_position, assert_cursor_line, assert_cursor_col,
    enter_insert, enter_normal, type_text,
    move_cursor, word_next, word_previous, line_start, line_end,
    jump_first_line, jump_last_line, line_next, line_previous,
    create_test_file, delete_test_file,
    AssertionResult, client,
)


def test_navigation() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Navigation ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    # Create multi-line content
    content = "alpha beta gamma\ndelta epsilon\nzeta eta theta"
    test_file = f"{state.config.project_root}/nav-test.txt"
    create_test_file(test_file, content)

    start_result = start(state, "nav-test.txt")
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()
    window = state.active_window.unwrap_or("")

    # After opening file, cursor should be somewhere in the buffer
    pos = client.get_cursor_position(state.config)
    if pos.is_ok():
        results.append(AssertionResult(True, f"Initial cursor position queryable: {pos.unwrap()}"))
    else:
        results.append(AssertionResult(False, "Cursor position query failed"))

    # Move to absolute position
    move_cursor(state.config, window, 0, 0)
    results.append(assert_cursor_position(state.config, 0, 0, "Should move to (0,0)"))

    # Word forward
    word_next(state.config, window)
    results.append(assert_cursor_line(state.config, 0, "Should stay on line 0 after word-next"))
    # Cursor should have moved past "alpha "

    # Word forward again
    word_next(state.config, window)
    results.append(assert_cursor_line(state.config, 0, "Should still be on line 0"))

    # Word backward
    word_previous(state.config, window)
    results.append(assert_cursor_line(state.config, 0, "Should be on line 0 after word-previous"))

    # Line start
    line_start(state.config, window)
    results.append(assert_cursor_col(state.config, 0, "Should be at column 0 after line-start"))

    # Line end
    line_end(state.config, window)
    # Should be at last column of first line
    col_result = client.get_cursor_position(state.config)
    if col_result.is_ok():
        col = col_result.unwrap()[1]
        results.append(AssertionResult(col > 0, f"Should be past column 0 after line-end (col={col})"))
    else:
        results.append(AssertionResult(False, "Cursor query failed after line-end"))

    # Move down a line
    line_next(state.config, window)
    results.append(assert_cursor_line(state.config, 1, "Should be on line 1 after line-next"))

    # Move up
    line_previous(state.config, window)
    results.append(assert_cursor_line(state.config, 0, "Should be on line 0 after line-previous"))

    # Jump to last line
    jump_last_line(state.config, window)
    results.append(assert_cursor_line(state.config, 2, "Should be on last line (2)"))

    # Jump to first line
    jump_first_line(state.config, window)
    results.append(assert_cursor_line(state.config, 0, "Should be on first line (0)"))

    # Boundary: move above line 0
    line_previous(state.config, window)
    results.append(assert_cursor_line(state.config, 0, "Should stay at line 0 (boundary clamp)"))

    # Boundary: move below last line
    jump_last_line(state.config, window)
    line_next(state.config, window)
    results.append(assert_cursor_line(state.config, 2, "Should stay at last line (boundary clamp)"))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_navigation()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
