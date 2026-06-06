"""Test: Config Loading — init-file-path, defun, runtime evaluation."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    create_test_file, delete_test_file,
    AssertionResult, client,
)


def test_config_loading() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Config Loading ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    test_file = f"{state.config.test_dir}/config-test.txt"
    create_test_file(test_file, "config test content")

    start_result = start(state, test_file)
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()

    # Test that init-file-path is queryable after startup
    r = client.eval_expr(state.config, '(init-file-path)')
    init_path = r.unwrap_or("").strip()
    results.append(AssertionResult(
        r.is_ok() and len(init_path) > 0,
        f"init-file-path should be set after startup, got: {init_path}",
    ))

    # Test that defun works at runtime (simulates what init.tlisp would do)
    r = client.eval_expr(state.config, '(defun config-test-fn () "from-config")')
    results.append(AssertionResult(
        r.is_ok(),
        f"defun should succeed: {r.unwrap_or('ERR')}",
    ))

    r = client.eval_expr(state.config, '(config-test-fn)')
    val = r.unwrap_or("").strip()
    results.append(AssertionResult(
        "from-config" in val,
        f"Custom function should return 'from-config', got: {val}",
    ))

    # Editor should still work — file loaded correctly
    buf = client.get_buffer_text(state.config)
    results.append(AssertionResult(
        buf.is_ok() and "config test content" in buf.unwrap_or(""),
        "File content should be loaded after startup",
    ))

    # Test defvar works at runtime
    r = client.eval_expr(state.config, '(defvar test-var 42)')
    results.append(AssertionResult(
        r.is_ok(),
        f"defvar should succeed: {r.unwrap_or('ERR')}",
    ))

    r = client.eval_expr(state.config, 'test-var')
    val = r.unwrap_or("").strip()
    results.append(AssertionResult(
        "42" in val,
        f"Variable should hold 42, got: {val}",
    ))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_config_loading()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
