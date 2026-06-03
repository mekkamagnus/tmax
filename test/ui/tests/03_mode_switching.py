"""Test: Mode Switching — verify all editor modes work correctly."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_running, assert_screen_fill, assert_daemon_mode, assert_mode,
    assert_tui_ready, assert_render_count_at_least, assert_frame_editor_sync,
    assert_no_client_errors,
    enter_insert, enter_normal, type_text,
    create_test_file, delete_test_file,
    AssertionResult, Ok,
)


def test_mode_switching() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Mode Switching ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    print(f"Mode: {state.config.mode}")

    test_file = f"{state.config.project_root}/mode-test.txt"
    create_test_file(test_file, "")

    start_result = start(state, "mode-test.txt")
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, f"Editor start failed: {start_result.unwrap_err().message}"),)
    state = start_result.unwrap()

    window = state.active_window.unwrap_or("")

    results.append(assert_screen_fill(state.config, window))
    if state.config.mode == "daemon-tmux":
        results.append(assert_tui_ready(state.config))

    # Start in NORMAL mode
    results.append(assert_daemon_mode(state.config, "NORMAL", "Should start in NORMAL mode"))
    if state.config.mode == "daemon-tmux":
        results.append(assert_frame_editor_sync(state.config))

    # Test INSERT mode
    enter_insert(state.config, window)
    time.sleep(0.3)
    results.append(assert_daemon_mode(state.config, "INSERT", "Should be in INSERT mode"))
    if state.config.mode == "daemon-tmux":
        results.append(assert_frame_editor_sync(state.config))

    # Return to NORMAL
    enter_normal(state.config, window)
    time.sleep(0.3)
    results.append(assert_daemon_mode(state.config, "NORMAL", "Should return to NORMAL mode"))
    if state.config.mode == "daemon-tmux":
        results.append(assert_frame_editor_sync(state.config))

    # Test typing in INSERT mode
    enter_insert(state.config, window)
    type_text(state.config, window, "test")
    results.append(assert_daemon_mode(state.config, "INSERT", "Should still be in INSERT mode after typing"))
    if state.config.mode == "daemon-tmux":
        results.append(assert_render_count_at_least(state.config, 1))

    enter_normal(state.config, window)
    time.sleep(0.3)
    results.append(assert_daemon_mode(state.config, "NORMAL", "Should return to NORMAL mode"))
    if state.config.mode == "daemon-tmux":
        results.append(assert_frame_editor_sync(state.config))
        results.append(assert_no_client_errors(state.config))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_mode_switching()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
