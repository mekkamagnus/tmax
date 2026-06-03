"""Test: Search and Replace — forward search, no-match, cursor behavior."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_cursor_position, assert_daemon_text, assert_daemon_mode,
    enter_insert, enter_normal, type_text, move_cursor, search,
    create_test_file, delete_test_file,
    AssertionResult, client,
)


def test_search_replace() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Search and Replace ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    content = "alpha beta gamma\nbeta delta epsilon\nzeta beta eta"
    test_file = f"{state.config.project_root}/search-test.txt"
    create_test_file(test_file, content)

    start_result = start(state, "search-test.txt")
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()
    window = state.active_window.unwrap_or("")

    # Move to start
    move_cursor(state.config, window, 0, 0)
    results.append(assert_cursor_position(state.config, 0, 0, "Should start at (0,0)"))

    # Search forward for "beta" — first occurrence
    search(state.config, window, "beta")
    pos = client.get_cursor_position(state.config)
    if pos.is_ok():
        line, col = pos.unwrap()
        results.append(AssertionResult(
            line == 0 and col >= 5,
            f"Cursor should be at 'beta' on line 0 (got {line},{col})",
        ))
    else:
        results.append(AssertionResult(False, "Cursor query failed after search"))

    # Search forward for "beta" again — second occurrence
    search(state.config, window, "beta")
    pos = client.get_cursor_position(state.config)
    if pos.is_ok():
        line, col = pos.unwrap()
        results.append(AssertionResult(
            line == 1 and col >= 0,
            f"Cursor should be at 'beta' on line 1 (got {line},{col})",
        ))
    else:
        results.append(AssertionResult(False, "Cursor query failed after second search"))

    # Search for missing pattern should fail (daemon returns error)
    r = client.eval_expr(state.config, '(search-forward "NOTFOUND")')
    results.append(AssertionResult(
        r.is_err(),
        "Search for missing pattern should return error",
    ))

    # Cursor should not have moved after failed search
    pos2 = client.get_cursor_position(state.config)
    if pos2.is_ok() and pos.is_ok():
        results.append(AssertionResult(
            pos2.unwrap() == pos.unwrap(),
            "Cursor should not move after failed search",
        ))

    # Search for "epsilon"
    search(state.config, window, "epsilon")
    results.append(assert_daemon_text(state.config, "epsilon", "Buffer still contains searched text"))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_search_replace()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
