"""Test: Buffers and Files — multiple buffers, file operations."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_daemon_text, assert_file_exists, assert_file_contains,
    assert_file_content_equals, assert_buffer_list_contains,
    assert_buffer_modified, assert_daemon_mode, assert_no_errors,
    enter_insert, enter_normal, type_text, save_file,
    open_file, create_test_file, delete_test_file,
    AssertionResult, client,
)


def test_buffers_files() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Buffers and Files ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    # Create test files
    file_a = f"{state.config.test_dir}/buf-a.txt"
    file_b = f"{state.config.test_dir}/buf-b.txt"
    create_test_file(file_a, "content A")
    create_test_file(file_b, "content B")

    # Start with file A
    start_result = start(state, file_a)
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(file_a)
        delete_test_file(file_b)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()
    window = state.active_window.unwrap_or("")

    # Verify file A loaded
    results.append(assert_daemon_text(state.config, "content A", "File A should be in buffer"))

    # Check buffer list
    buf_list = client.get_buffer_list(state.config)
    results.append(AssertionResult(
        buf_list.is_ok(),
        f"Buffer list queryable: {buf_list.unwrap_or([])}",
    ))

    # Edit and save file A
    enter_insert(state.config, window)
    type_text(state.config, window, " extra")
    enter_normal(state.config, window)
    save_file(state.config, window)
    time.sleep(1)

    # Verify saved (buffer-insert prepends at cursor position)
    results.append(assert_file_contains(file_a, "extra", "File A should have inserted text"))
    results.append(assert_file_contains(file_a, "content A", "File A should have original text"))

    # Open file B via client
    open_file(state.config, window, file_b)
    time.sleep(0.5)

    # Buffer should now have file B content
    results.append(assert_daemon_text(state.config, "content B", "File B should be in buffer"))

    # Save file B (should preserve its content)
    save_file(state.config, window)
    time.sleep(1)
    results.append(assert_file_contains(file_b, "content B", "File B preserved after save"))

    # Test creating a new file
    new_file = f"{state.config.test_dir}/new-file.txt"
    open_file(state.config, window, new_file)
    time.sleep(0.5)
    type_text(state.config, window, "brand new")
    save_file(state.config, window)
    time.sleep(1)
    results.append(assert_file_exists(new_file, "New file should exist"))
    results.append(assert_file_contains(new_file, "brand new", "New file should have inserted text"))

    # Test file with spaces in name
    space_file = f"{state.config.test_dir}/file with spaces.txt"
    create_test_file(space_file, "spaced content")
    open_file(state.config, window, space_file)
    time.sleep(0.5)
    results.append(assert_daemon_text(state.config, "spaced content", "File with spaces should load"))

    cleanup(state)
    for f in [file_a, file_b, new_file, space_file]:
        delete_test_file(f)

    return tuple(results)


if __name__ == "__main__":
    results = test_buffers_files()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
