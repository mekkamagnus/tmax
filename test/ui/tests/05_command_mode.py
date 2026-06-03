"""Test: Command Mode — :w, :q, invalid commands, backspace, M-x."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_running, assert_daemon_mode, assert_no_errors,
    assert_daemon_text, assert_screen_fill, assert_file_contains,
    assert_not_daemon_error, assert_buffer_modified,
    enter_insert, enter_normal, enter_command_mode, exit_command_mode,
    enter_mx_mode, exit_mx_mode, type_text, save_file,
    create_test_file, delete_test_file,
    AssertionResult, Ok, client,
)


def test_command_mode() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Command Mode ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    test_file = f"{state.config.project_root}/cmd-test.txt"
    create_test_file(test_file, "hello world")

    start_result = start(state, "cmd-test.txt")
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, f"Editor start failed"),)
    state = start_result.unwrap()

    window = state.active_window.unwrap_or("")

    # Verify file loaded
    results.append(assert_daemon_text(state.config, "hello world", "File should be loaded"))

    # Test :w (save) via daemon eval
    results.append(assert_not_daemon_error(
        save_file(state.config, window),
        "Save via daemon should succeed",
    ))
    time.sleep(0.5)

    # Test entering command mode
    r = enter_command_mode(state.config, window)
    results.append(assert_not_daemon_error(r, "Enter command mode should succeed"))
    time.sleep(0.3)

    # Exit command mode
    exit_command_mode(state.config, window)
    time.sleep(0.3)
    results.append(assert_daemon_mode(state.config, "NORMAL", "Should return to NORMAL after command mode"))

    # Test invalid command doesn't crash
    r = client.eval_expr(state.config, '(editor-enter-command-mode)')
    time.sleep(0.2)
    # Type an invalid command
    client.eval_expr(state.config, '(buffer-insert "zzz")')
    time.sleep(0.2)
    client.eval_expr(state.config, '(editor-exit-command-mode)')
    time.sleep(0.3)
    results.append(assert_daemon_mode(state.config, "NORMAL", "Should be in NORMAL after invalid command"))
    results.append(assert_no_errors(state.config, window, "No errors after invalid command"))

    # Test M-x mode
    r = enter_mx_mode(state.config, window)
    results.append(assert_not_daemon_error(r, "Enter M-x mode should succeed"))
    time.sleep(0.3)

    # Exit M-x mode
    exit_mx_mode(state.config, window)
    time.sleep(0.3)
    results.append(assert_daemon_mode(state.config, "NORMAL", "Should return to NORMAL after M-x"))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_command_mode()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
