"""Test: Text Objects — delete-inner-word, change-inner-quote, etc."""

import sys
import os
import time
import subprocess

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_daemon_mode, assert_daemon_text,
    enter_normal, move_cursor,
    create_test_file, delete_test_file,
    AssertionResult, client,
)


def _switch_to_file(config, path: str) -> None:
    subprocess.run(
        [config.client_cmd, "--socket", config.socket_path, path],
        capture_output=True, text=True, timeout=5,
    )
    time.sleep(0.3)


def test_text_objects() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Text Objects ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    test_dir = state.config.test_dir
    test_file = f"{test_dir}/textobj-base.txt"
    create_test_file(test_file, "placeholder")

    start_result = start(state, test_file)
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()
    window = state.active_window.unwrap_or("")

    # --- delete-inner-word ---
    f1 = f"{test_dir}/tiw.txt"
    create_test_file(f1, "hello world end")
    _switch_to_file(state.config, f1)
    move_cursor(state.config, window, 0, 2)  # cursor inside "hello"
    client.eval_expr(state.config, '(delete-inner-word)')
    time.sleep(0.3)
    buf = client.get_buffer_text(state.config).unwrap_or("")
    results.append(AssertionResult(
        "hello" not in buf and "world" in buf,
        f"delete-inner-word should remove 'hello', got: {buf[:40]}",
    ))

    # --- delete-around-word ---
    f2 = f"{test_dir}/taw.txt"
    create_test_file(f2, "hello world end")
    _switch_to_file(state.config, f2)
    move_cursor(state.config, window, 0, 2)  # cursor inside "hello"
    client.eval_expr(state.config, '(delete-around-word)')
    time.sleep(0.3)
    buf = client.get_buffer_text(state.config).unwrap_or("")
    results.append(AssertionResult(
        "hello" not in buf,
        f"delete-around-word should remove 'hello' + trailing space, got: {buf[:40]}",
    ))

    # --- change-inner-double-quote ---
    f3 = f'{test_dir}/ciq.txt'
    create_test_file(f3, 'say "hello" ok')
    _switch_to_file(state.config, f3)
    move_cursor(state.config, window, 0, 5)  # cursor inside "hello"
    client.eval_expr(state.config, '(change-inner-double-quote)')
    time.sleep(0.3)
    buf = client.get_buffer_text(state.config).unwrap_or("")
    results.append(AssertionResult(
        "hello" not in buf,
        f"change-inner-double-quote should clear inside quotes, got: {buf[:40]}",
    ))
    results.append(assert_daemon_mode(state.config, "INSERT",
        "change-inner-double-quote should enter insert mode"))

    # --- delete-inner-paren ---
    enter_normal(state.config, window)
    f4 = f"{test_dir}/tip.txt"
    create_test_file(f4, "(inner)")
    _switch_to_file(state.config, f4)
    move_cursor(state.config, window, 0, 2)  # cursor inside parens
    client.eval_expr(state.config, '(delete-inner-paren)')
    time.sleep(0.3)
    buf = client.get_buffer_text(state.config).unwrap_or("")
    results.append(AssertionResult(
        "inner" not in buf and "()" in buf,
        f"delete-inner-paren should clear inside parens, got: {buf[:30]}",
    ))

    # --- delete-inner-brace ---
    f5 = f"{test_dir}/tib.txt"
    create_test_file(f5, "{body}")
    _switch_to_file(state.config, f5)
    move_cursor(state.config, window, 0, 2)  # cursor inside braces
    client.eval_expr(state.config, '(delete-inner-brace)')
    time.sleep(0.3)
    buf = client.get_buffer_text(state.config).unwrap_or("")
    results.append(AssertionResult(
        "body" not in buf and "{}" in buf,
        f"delete-inner-brace should clear inside braces, got: {buf[:30]}",
    ))

    cleanup(state)
    for f in [test_file, f1, f2, f3, f4, f5]:
        delete_test_file(f)

    return tuple(results)


if __name__ == "__main__":
    results = test_text_objects()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
