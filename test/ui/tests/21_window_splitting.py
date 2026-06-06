"""Test: Window Splitting — split-window, window-next, window-close primitives."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    create_test_file, delete_test_file,
    AssertionResult, client,
)


def test_window_splitting() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Window Splitting ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    test_file = f"{state.config.test_dir}/window-test.txt"
    create_test_file(test_file, "window content")

    start_result = start(state, test_file)
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()

    # split-window "horizontal" — creates horizontal split
    r = client.eval_expr(state.config, '(split-window "horizontal")')
    results.append(AssertionResult(
        r.is_ok(),
        f"split-window horizontal should succeed: {r.unwrap_or('ERR')}",
    ))

    # split-window "vertical" — creates vertical split
    r = client.eval_expr(state.config, '(split-window "vertical")')
    results.append(AssertionResult(
        r.is_ok(),
        f"split-window vertical should succeed: {r.unwrap_or('ERR')}",
    ))

    # window-next — cycle to next window
    r = client.eval_expr(state.config, '(window-next)')
    results.append(AssertionResult(
        r.is_ok(),
        f"window-next should succeed: {r.unwrap_or('ERR')}",
    ))

    # window-close — close current window
    r = client.eval_expr(state.config, '(window-close)')
    results.append(AssertionResult(
        r.is_ok(),
        f"window-close should succeed: {r.unwrap_or('ERR')}",
    ))

    # Close remaining window — should not crash
    r = client.eval_expr(state.config, '(window-close)')
    results.append(AssertionResult(
        r.is_ok(),
        f"window-close on last window should not crash: {r.unwrap_or('ERR')}",
    ))

    # Verify editor is still responsive
    buf = client.get_buffer_text(state.config)
    results.append(AssertionResult(
        buf.is_ok(),
        "Editor should still be responsive after window ops",
    ))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_window_splitting()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
