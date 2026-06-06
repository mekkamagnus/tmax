"""Test: Count Prefix — vim-style numeric prefixes (3j, 5l, 2dd, etc.)."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_daemon_text, assert_daemon_mode,
    enter_normal, move_cursor,
    create_test_file, delete_test_file,
    AssertionResult, client,
)
from tmax_harness import input as inp


def test_count_prefix() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Count Prefix ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    content = "aaaa\nbbbb\ncccc\ndddd\neeee"
    test_file = f"{state.config.test_dir}/count-test.txt"
    create_test_file(test_file, content)

    start_result = start(state, test_file)
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()
    window = state.active_window.unwrap_or("")

    # 3j — move down 3 lines
    move_cursor(state.config, window, 0, 0)
    inp.send_keys(state.config, "3", "j")
    time.sleep(0.2)
    pos = client.get_cursor_position(state.config)
    line = pos.unwrap_or([-1, -1])[0]
    results.append(AssertionResult(
        line == 3,
        f"3j should move to line 3, got line {line}",
    ))

    # 2k — move up 2 lines
    inp.send_keys(state.config, "2", "k")
    time.sleep(0.2)
    pos = client.get_cursor_position(state.config)
    line = pos.unwrap_or([-1, -1])[0]
    results.append(AssertionResult(
        line == 1,
        f"2k should move to line 1, got line {line}",
    ))

    # 4l — move right 4 columns (line "aaaa" has 4 chars, col 4 is end-of-line)
    move_cursor(state.config, window, 0, 0)
    inp.send_keys(state.config, "4", "l")
    time.sleep(0.2)
    pos = client.get_cursor_position(state.config)
    col = pos.unwrap_or([-1, -1])[1]
    results.append(AssertionResult(
        col == 4,
        f"4l should move to column 4, got column {col}",
    ))

    # 2w — move 2 words forward
    words_file = f"{state.config.test_dir}/count-words.txt"
    create_test_file(words_file, "alpha beta gamma delta")
    client.eval_expr(state.config, '(progn (buffer-create "count-words") (buffer-switch "count-words"))')
    time.sleep(0.3)
    # Open the file into the buffer
    import subprocess
    subprocess.run(
        [state.config.client_cmd, "--socket", state.config.socket_path, words_file],
        capture_output=True, text=True, timeout=5,
    )
    time.sleep(0.3)
    move_cursor(state.config, window, 0, 0)
    inp.send_keys(state.config, "2", "w")
    time.sleep(0.3)
    pos = client.get_cursor_position(state.config)
    col = pos.unwrap_or([-1, -1])[1]
    # "alpha"(0-4) " "(5) "beta"(6-9) " "(10) "gamma"(11-15) — 2w lands at col 11
    results.append(AssertionResult(
        col >= 11,
        f"2w should land at 'gamma' (col >= 11), got col {col}",
    ))

    # Escape clears count
    inp.send_key(state.config, "Escape")
    time.sleep(0.1)
    count_result = client.eval_expr(state.config, "(count-active)")
    count_active = count_result.unwrap_or("error").strip()
    results.append(AssertionResult(
        count_active == "nil" or count_active == "false",
        f"Escape should clear count, got {count_active}",
    ))

    # 2dd — delete 2 lines
    dd_file = f"{state.config.test_dir}/dd-test.txt"
    create_test_file(dd_file, "line1\nline2\nline3\nline4\nline5")
    client.eval_expr(state.config, '(buffer-switch "count-test")')
    time.sleep(0.3)
    subprocess.run(
        [state.config.client_cmd, "--socket", state.config.socket_path, dd_file],
        capture_output=True, text=True, timeout=5,
    )
    time.sleep(0.3)
    move_cursor(state.config, window, 0, 0)
    inp.send_keys(state.config, "2", "d", "d")
    time.sleep(0.3)
    buf = client.get_buffer_text(state.config).unwrap_or("")
    results.append(AssertionResult(
        "line1" not in buf and "line2" not in buf,
        f"2dd should delete first 2 lines, got: {buf[:60]}",
    ))
    results.append(AssertionResult(
        "line3" in buf,
        f"line3 should remain after 2dd, got: {buf[:60]}",
    ))

    # 3x — delete 3 characters
    x_file = f"{state.config.test_dir}/x-test.txt"
    create_test_file(x_file, "ABCDEFGHIJ")
    subprocess.run(
        [state.config.client_cmd, "--socket", state.config.socket_path, x_file],
        capture_output=True, text=True, timeout=5,
    )
    time.sleep(0.3)
    move_cursor(state.config, window, 0, 0)
    inp.send_keys(state.config, "3", "x")
    time.sleep(0.3)
    buf = client.get_buffer_text(state.config).unwrap_or("")
    results.append(AssertionResult(
        "ABC" not in buf and "DEFGHIJ" in buf,
        f"3x should delete 'ABC', got: {buf[:30]}",
    ))

    cleanup(state)
    for f in [test_file, words_file, dd_file, x_file]:
        delete_test_file(f)

    return tuple(results)


if __name__ == "__main__":
    results = test_count_prefix()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
