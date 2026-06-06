"""Renderer E2E: Lisp-owned buffer and M-x completion."""

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
from tmax_harness import client, input as inp


def _eval_equals(config, expression: str, expected: str, message: str) -> AssertionResult:
    result = client.eval_expr(config, expression)
    actual = result.unwrap_or("<query failed>").strip()
    return AssertionResult(
        result.is_ok() and actual == expected,
        message,
        details=Some(f"Expected: {expected}, got: {actual}"),
    )


def test_buffer_completion() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []
    state = init({"mode_override": "daemon-tmux"}).unwrap()
    test_file = f"{state.config.test_dir}/completion-test.txt"
    create_test_file(test_file, "completion")

    try:
        state = start(state, test_file).unwrap()
        window = state.active_window.unwrap()
        client.eval_expr(state.config, '(progn (buffer-create "alpha-notes") (buffer-create "beta-log"))')

        inp.send_keys(state.config, "C-x", "b")
        time.sleep(0.5)
        results.append(assert_text_visible(state.config, window, "Switch to buffer: ", "C-x b should show the buffer prompt"))
        results.append(assert_text_visible(state.config, window, "alpha-notes", "Buffer candidate should be visible"))
        results.append(assert_text_visible(state.config, window, "fundamental", "Marginalia mode annotation should be visible"))

        inp.send_text(state.config, "notes alpha")
        time.sleep(0.5)
        results.append(assert_text_visible(state.config, window, "alpha-notes", "Reverse-order components should retain the matching buffer"))
        inp.send_key(state.config, "Enter")
        results.append(_eval_equals(state.config, "(buffer-current)", "alpha-notes", "Enter should switch to the selected buffer"))

        inp.send_keys(state.config, "C-x", "b")
        inp.send_text(state.config, "beta")
        inp.send_key(state.config, "C-g")
        results.append(_eval_equals(state.config, "(buffer-current)", "alpha-notes", "C-g should cancel without switching"))

        inp.send_keys(state.config, "Space", ";")
        time.sleep(0.5)
        results.append(assert_text_visible(state.config, window, "M-x", "M-x should use the same generic vertical minibuffer"))
        results.append(assert_no_client_errors(state.config, "Completion renderer should not report client errors"))
        return tuple(results)
    finally:
        cleanup(state)
        delete_test_file(test_file)


if __name__ == "__main__":
    summary = summarize(test_buffer_completion())
    print(format_summary(summary))
    sys.exit(summary.failed)
