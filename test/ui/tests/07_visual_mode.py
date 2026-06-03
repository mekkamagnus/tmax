"""Test: Visual Mode — enter/exit, mode changes."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_daemon_mode, assert_buffer_text_equals, assert_daemon_text,
    enter_normal, enter_visual, type_text,
    word_next, delete_line, move_cursor,
    create_test_file, delete_test_file,
    AssertionResult, client,
)


def test_visual_mode() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Visual Mode ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    content = "one two three\nfour five six"
    test_file = f"{state.config.project_root}/visual-test.txt"
    create_test_file(test_file, content)

    start_result = start(state, "visual-test.txt")
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()
    window = state.active_window.unwrap_or("")

    # Enter visual mode
    enter_visual(state.config, window)
    results.append(assert_daemon_mode(state.config, "VISUAL", "Should be in VISUAL mode"))

    # Return to normal mode
    enter_normal(state.config, window)
    results.append(assert_daemon_mode(state.config, "NORMAL", "Should return to NORMAL from VISUAL"))

    # Visual mode should not change buffer text
    results.append(assert_daemon_text(state.config, "one two three", "Buffer unchanged after visual toggle"))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_visual_mode()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
