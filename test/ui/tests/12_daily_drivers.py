"""Test: Daily Drivers — custom key bindings, features that work today."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_daemon_mode, assert_daemon_text, assert_no_errors,
    enter_insert, enter_normal, type_text,
    create_test_file, delete_test_file,
    AssertionResult, client,
)


def test_daily_drivers() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Daily Drivers ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    test_file = f"{state.config.project_root}/daily-test.txt"
    create_test_file(test_file, "test content here")

    start_result = start(state, "daily-test.txt")
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()
    window = state.active_window.unwrap_or("")

    # Test T-Lisp evaluation (custom function)
    r = client.eval_expr(state.config, '(+ 1 2)')
    if r.is_ok():
        val = r.unwrap().strip()
        results.append(AssertionResult(
            val == "3",
            f"T-Lisp (+ 1 2) should return 3, got: {val}",
        ))
    else:
        results.append(AssertionResult(False, f"T-Lisp eval failed: {r.unwrap_err().message}"))

    # Test defining and calling a custom function
    r = client.eval_expr(state.config, '(defun test-fn () "hello from custom")')
    if r.is_ok():
        r2 = client.eval_expr(state.config, '(test-fn)')
        if r2.is_ok():
            results.append(AssertionResult(
                "hello from custom" in r2.unwrap(),
                "Custom function should return expected value",
            ))
        else:
            results.append(AssertionResult(False, f"Calling custom function failed: {r2.unwrap_err().message}"))
    else:
        results.append(AssertionResult(False, f"Defining custom function failed: {r.unwrap_err().message}"))

    # Test buffer-modified-p
    r = client.eval_expr(state.config, '(buffer-modified-p)')
    results.append(AssertionResult(
        r.is_ok(),
        f"buffer-modified-p should be queryable, got: {r.unwrap_or('ERR')}",
    ))

    # Test buffer-list
    r = client.eval_expr(state.config, '(buffer-list)')
    results.append(AssertionResult(
        r.is_ok(),
        f"buffer-list should be queryable, got: {r.unwrap_or('ERR')}",
    ))

    # Test undo/redo availability
    r = client.eval_expr(state.config, '(undo)')
    results.append(AssertionResult(
        r.is_ok(),
        "undo should be callable (even if nothing to undo)",
    ))

    # Test cursor-position
    r = client.eval_expr(state.config, '(cursor-position)')
    results.append(AssertionResult(
        r.is_ok() and "[" in r.unwrap(),
        f"cursor-position should return array, got: {r.unwrap_or('ERR')}",
    ))

    # Test word navigation works
    r = client.eval_expr(state.config, '(word-next)')
    results.append(AssertionResult(
        r.is_ok(),
        "word-next should succeed",
    ))

    # No errors throughout
    results.append(assert_no_errors(state.config, window, "No errors after daily driver tests"))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_daily_drivers()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
