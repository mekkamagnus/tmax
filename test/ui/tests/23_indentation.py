"""Test: Indentation — indent primitives and Tab key behavior."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    enter_normal, move_cursor,
    create_test_file, delete_test_file,
    AssertionResult, client,
)
from tmax_harness import input as inp


def test_indentation() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Indentation ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    test_file = f"{state.config.test_dir}/indent-test.txt"
    create_test_file(test_file, "hello\nworld")

    start_result = start(state, test_file)
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()
    window = state.active_window.unwrap_or("")

    # indent-get-rules should be callable (returns null if no mode set)
    r = client.eval_expr(state.config, '(indent-get-rules)')
    results.append(AssertionResult(
        r.is_ok(),
        f"indent-get-rules should be callable: {r.unwrap_or('ERR')}",
    ))

    # buffer-set-line-indent should work
    r = client.eval_expr(state.config, '(buffer-set-line-indent 0 4)')
    results.append(AssertionResult(
        r.is_ok(),
        f"buffer-set-line-indent should succeed: {r.unwrap_or('ERR')}",
    ))

    # Verify line was indented
    buf = client.get_buffer_text(state.config).unwrap_or("")
    results.append(AssertionResult(
        buf.startswith("    ") or "    " in buf,
        f"Line 0 should be indented with 4 spaces, got: {buf[:30]}",
    ))

    # Module loading for indent should work
    r = client.eval_expr(state.config, '(require-module editor/commands/indent)')
    results.append(AssertionResult(
        r.is_ok(),
        f"require-module indent should succeed: {r.unwrap_or('ERR')}",
    ))

    # Verify editor is still responsive
    buf = client.get_buffer_text(state.config)
    results.append(AssertionResult(
        buf.is_ok() and len(buf.unwrap_or("")) > 0,
        "Buffer should have content after indent operations",
    ))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_indentation()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
