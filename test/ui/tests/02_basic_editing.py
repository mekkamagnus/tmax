"""Test: Basic Editing — create file, edit, save, verify."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_running, assert_text_visible, assert_daemon_mode,
    assert_file_contains, assert_screen_fill,
    assert_tui_ready, assert_frame_editor_sync, assert_no_client_errors,
    enter_insert, enter_normal, type_text, save_file, quit_editor,
    create_test_file, delete_test_file,
    AssertionResult, Ok,
)


def test_basic_editing() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Basic Editing ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    print(f"Mode: {state.config.mode}")

    test_file = f"{state.config.project_root}/test-edit.txt"
    create_test_file(test_file, "Initial content")

    start_result = start(state, "test-edit.txt")
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, f"Editor start failed: {start_result.unwrap_err().message}"),)
    state = start_result.unwrap()

    window = state.active_window.unwrap_or("")

    # Verify file loaded
    results.append(assert_text_visible(state.config, window, "Initial content", "File content should be visible"))
    results.append(assert_screen_fill(state.config, window))
    if state.config.mode == "daemon-tmux":
        results.append(assert_tui_ready(state.config))
        results.append(assert_frame_editor_sync(state.config))

    # Enter insert mode and add text
    enter_insert(state.config, window)
    time.sleep(0.5)
    results.append(assert_daemon_mode(state.config, "INSERT", "Should be in INSERT mode"))

    type_text(state.config, window, " - Appended text")

    # Return to normal mode
    enter_normal(state.config, window)
    time.sleep(0.5)
    results.append(assert_daemon_mode(state.config, "NORMAL", "Should return to NORMAL mode"))
    if state.config.mode == "daemon-tmux":
        results.append(assert_frame_editor_sync(state.config))

    # Save the file
    save_file(state.config, window)
    time.sleep(2)
    if state.config.mode == "daemon-tmux":
        results.append(assert_no_client_errors(state.config))

    # Quit
    quit_editor(state.config, window)
    time.sleep(1)

    # Cleanup
    cleanup(state)

    # Check file was saved
    results.append(assert_file_contains(test_file, "Appended text", "File should contain appended text"))

    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_basic_editing()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
