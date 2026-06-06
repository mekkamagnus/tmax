"""Renderer E2E: send real Vim and insert-mode keys through daemon --key."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    AssertionResult,
    assert_buffer_text_equals,
    assert_daemon_mode,
    assert_no_client_errors,
    cleanup,
    create_test_file,
    delete_test_file,
    enter_insert,
    enter_normal,
    format_summary,
    init,
    start,
    summarize,
    type_text,
)
from tmax_harness import input as inp


def test_vim_input() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []
    state = init({"mode_override": "daemon"}).unwrap()
    test_file = f"{state.config.test_dir}/vim-input-test.txt"
    create_test_file(test_file, "")

    try:
        state = start(state, test_file).unwrap()

        results.append(AssertionResult(
            enter_insert(state.config).is_ok(),
            "Real i key should enter insert mode",
        ))
        type_text(state.config, text="A")
        inp.send_enter(state.config)
        type_text(state.config, text="B")
        inp.send_key(state.config, "Backspace")
        inp.send_key(state.config, "Tab")
        type_text(state.config, text="C")
        results.append(AssertionResult(
            enter_normal(state.config).is_ok(),
            "Real Escape key should return to normal mode",
        ))

        results.append(assert_daemon_mode(state.config, "NORMAL"))
        results.append(assert_buffer_text_equals(
            state.config,
            "A\n\tC",
            "Enter, Backspace, and Tab should traverse the renderer input path",
        ))

        inp.send_keys(state.config, "g", "g", "d", "d")
        results.append(assert_buffer_text_equals(
            state.config,
            "\tC",
            "Real normal-mode motions and operator keys should edit the buffer",
        ))
        results.append(assert_no_client_errors(state.config))
        return tuple(results)
    finally:
        cleanup(state)
        delete_test_file(test_file)


if __name__ == "__main__":
    summary = summarize(test_vim_input())
    print(format_summary(summary))
    sys.exit(summary.failed)
