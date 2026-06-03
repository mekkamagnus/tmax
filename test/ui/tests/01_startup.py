"""Test: Application Startup — verify editor starts correctly."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_running, assert_daemon_mode, assert_no_errors,
    assert_screen_fill, create_test_file, delete_test_file,
    assert_tui_connected, assert_tui_ready, assert_render_count_at_least,
    assert_no_client_errors, assert_frame_editor_sync,
    AssertionResult, Ok,
)


def test_startup() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Application Startup ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    print(f"Mode: {state.config.mode}")

    # Create test file
    test_file = f"{state.config.project_root}/startup-test.txt"
    create_test_file(test_file, "")

    # Start editor
    start_result = start(state, "startup-test.txt")
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, f"Editor start failed: {start_result.unwrap_err().message}"),)
    state = start_result.unwrap()

    # Assertions
    results.append(assert_running(state, "Editor should be running"))
    results.append(assert_daemon_mode(state.config, "NORMAL", "Should start in NORMAL mode"))
    results.append(assert_no_errors(state.config, state.active_window.unwrap_or(""), "No errors should be present"))
    results.append(assert_screen_fill(state.config, state.active_window.unwrap_or("")))
    if state.config.mode == "daemon-tmux":
        results.append(assert_tui_connected(state.config))
        results.append(assert_tui_ready(state.config))
        results.append(assert_render_count_at_least(state.config, 1))
        results.append(assert_no_client_errors(state.config))
        results.append(assert_frame_editor_sync(state.config))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_startup()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
