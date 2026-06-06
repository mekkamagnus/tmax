"""Test: Yank Ring — kill-ring-save, kill-ring-yank, kill-ring-rotate."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    create_test_file, delete_test_file,
    AssertionResult, client,
)


def test_yank_ring() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Yank Ring ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    test_file = f"{state.config.test_dir}/yank-test.txt"
    create_test_file(test_file, "placeholder")

    start_result = start(state, test_file)
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, "Editor start failed"),)
    state = start_result.unwrap()

    # Save three entries to the kill ring
    for name in ["AAA", "BBB", "CCC"]:
        r = client.eval_expr(state.config, f'(kill-ring-save "{name}")')
        results.append(AssertionResult(
            r.is_ok(),
            f"kill-ring-save {name} should succeed: {r.unwrap_or('ERR')}",
        ))

    # kill-ring-list should contain all three
    r = client.eval_expr(state.config, '(kill-ring-list)')
    ring_text = r.unwrap_or("")
    results.append(AssertionResult(
        "AAA" in ring_text and "BBB" in ring_text and "CCC" in ring_text,
        f"kill-ring-list should contain all entries, got: {ring_text[:80]}",
    ))

    # kill-ring-yank returns most recent (CCC)
    r = client.eval_expr(state.config, '(kill-ring-yank)')
    yanked = r.unwrap_or("").strip()
    results.append(AssertionResult(
        "CCC" in yanked,
        f"kill-ring-yank should return most recent (CCC), got: {yanked}",
    ))

    # kill-ring-rotate then yank returns next (BBB)
    r = client.eval_expr(state.config, '(progn (kill-ring-rotate) (kill-ring-yank))')
    rotated = r.unwrap_or("").strip()
    results.append(AssertionResult(
        "BBB" in rotated,
        f"rotate+yank should return BBB, got: {rotated}",
    ))

    # Rotate again returns oldest (AAA)
    r = client.eval_expr(state.config, '(progn (kill-ring-rotate) (kill-ring-yank))')
    rotated = r.unwrap_or("").strip()
    results.append(AssertionResult(
        "AAA" in rotated,
        f"second rotate+yank should return AAA, got: {rotated}",
    ))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_yank_ring()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
