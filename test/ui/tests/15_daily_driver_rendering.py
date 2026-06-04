"""Renderer E2E: splits, tabs, focus, resizing, and relative line numbers."""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    AssertionResult,
    Some,
    assert_no_client_errors,
    assert_text_visible,
    cleanup,
    create_test_file,
    delete_test_file,
    format_summary,
    init,
    start,
    summarize,
)
from tmax_harness import client, input as inp, queries


def _eval_equals(config, expression: str, expected: str, message: str) -> AssertionResult:
    result = client.eval_expr(config, expression)
    actual = result.unwrap_or("<query failed>").strip()
    return AssertionResult(
        result.is_ok() and actual == expected,
        message,
        details=Some(f"Expected: {expected}, got: {actual}"),
    )


def test_daily_driver_rendering() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []
    state = init({"mode_override": "daemon-tmux"}).unwrap()
    test_file = f"{state.config.test_dir}/daily-render-test.txt"
    create_test_file(test_file, "one\ntwo\nthree\nfour")

    try:
        state = start(state, test_file).unwrap()
        window = state.active_window.unwrap()

        client.eval_expr(state.config, '(key-bind "R" "(relative-line-numbers-mode 1)" "normal")')
        inp.send_key(state.config, window, "R")
        time.sleep(0.5)
        screen = queries.capture_output(state.config, window).unwrap_or("")
        results.append(AssertionResult(
            "\u2502" in screen,
            "Relative line-number gutter should be visible",
        ))

        inp.send_keys(state.config, window, "C-w", "s")
        time.sleep(0.5)
        results.append(_eval_equals(state.config, "(window-count)", "2", "C-w s should split"))
        results.append(assert_text_visible(state.config, window, "\u2500", "Horizontal split separator should be visible"))

        inp.send_keys(state.config, window, "C-w", "w")
        results.append(_eval_equals(state.config, "(window-current)", "1", "C-w w should switch focus"))
        inp.send_keys(state.config, window, "C-w", "+")
        inp.send_keys(state.config, window, "C-w", "q")
        results.append(_eval_equals(state.config, "(window-count)", "1", "C-w q should close the focused split"))

        client.eval_expr(state.config, '(tab-new "one-tab")')
        client.eval_expr(state.config, '(buffer-insert "TAB-ONE")')
        client.eval_expr(state.config, '(tab-new "two-tab")')
        client.eval_expr(state.config, '(buffer-insert "TAB-TWO")')
        time.sleep(0.5)
        results.append(assert_text_visible(state.config, window, "one-tab", "Tab bar should show the first tab"))
        results.append(assert_text_visible(state.config, window, "two-tab", "Tab bar should show the active tab"))

        inp.send_keys(state.config, window, "g", "T")
        time.sleep(0.5)
        results.append(assert_text_visible(state.config, window, "TAB-ONE", "gT should render the previous tab"))
        inp.send_keys(state.config, window, "g", "t")
        time.sleep(0.5)
        results.append(assert_text_visible(state.config, window, "TAB-TWO", "gt should render the next tab"))

        results.append(assert_no_client_errors(state.config, window))
        return tuple(results)
    finally:
        cleanup(state)
        delete_test_file(test_file)


if __name__ == "__main__":
    summary = summarize(test_daily_driver_rendering())
    print(format_summary(summary))
    sys.exit(summary.failed)
