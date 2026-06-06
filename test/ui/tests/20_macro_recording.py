"""Test: Macro Recording — record, stop, execute, list macros."""

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


def test_macro_recording() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Macro Recording ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    test_file = f"{state.config.test_dir}/macro-test.txt"
    create_test_file(test_file, "placeholder")

    start_result = start(state, test_file)
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()
    window = state.active_window.unwrap_or("")

    # Reset macro state for clean test
    client.eval_expr(state.config, '(macro-record-reset)')

    # Start recording to register "a"
    r = client.eval_expr(state.config, '(macro-record-start "a")')
    results.append(AssertionResult(
        r.is_ok(),
        f"macro-record-start 'a' should succeed: {r.unwrap_or('ERR')}",
    ))

    # Verify recording is active
    r = client.eval_expr(state.config, '(macro-record-active)')
    active = r.unwrap_or("").strip()
    results.append(AssertionResult(
        active == "t" or active == "true",
        f"macro-record-active should return t while recording, got: {active}",
    ))

    # Verify current register
    r = client.eval_expr(state.config, '(macro-record-register)')
    reg = r.unwrap_or("").strip()
    results.append(AssertionResult(
        "a" in reg,
        f"macro-record-register should return 'a', got: {reg}",
    ))

    # Record some keys
    client.eval_expr(state.config, '(macro-record-key "i")')
    client.eval_expr(state.config, '(macro-record-key "x")')
    client.eval_expr(state.config, '(macro-record-key "Escape")')

    # Stop recording
    r = client.eval_expr(state.config, '(macro-record-stop)')
    results.append(AssertionResult(
        r.is_ok(),
        f"macro-record-stop should succeed: {r.unwrap_or('ERR')}",
    ))

    # Verify recording is no longer active
    r = client.eval_expr(state.config, '(macro-record-active)')
    active = r.unwrap_or("").strip()
    results.append(AssertionResult(
        active == "nil" or active == "false",
        f"macro-record-active should be nil after stop, got: {active}",
    ))

    # List macros — should have register "a"
    r = client.eval_expr(state.config, '(macro-list)')
    macros_text = r.unwrap_or("")
    results.append(AssertionResult(
        "a" in macros_text,
        f"macro-list should contain register 'a', got: {macros_text[:60]}",
    ))

    # Execute the macro
    r = client.eval_expr(state.config, '(macro-execute "a")')
    results.append(AssertionResult(
        r.is_ok(),
        f"macro-execute 'a' should succeed: {r.unwrap_or('ERR')}",
    ))

    # Invalid register should fail
    r = client.eval_expr(state.config, '(macro-record-start "!")')
    results.append(AssertionResult(
        r.is_ok() is False or "invalid" in r.unwrap_or("").lower() or "error" in r.unwrap_or("").lower(),
        f"macro-record-start '!' should reject invalid register, got: {r.unwrap_or('OK')}",
    ))

    # Double-start should fail
    client.eval_expr(state.config, '(macro-record-start "b")')
    r = client.eval_expr(state.config, '(macro-record-start "c")')
    results.append(AssertionResult(
        r.is_ok() is False or "already" in r.unwrap_or("").lower() or "error" in r.unwrap_or("").lower(),
        f"Starting second recording should fail, got: {r.unwrap_or('OK')}",
    ))
    client.eval_expr(state.config, '(macro-record-stop)')

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_macro_recording()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
