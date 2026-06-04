"""Test: Mode system loading, daemon observability, and status-line metadata."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    create_test_file, delete_test_file,
    AssertionResult, Some, Nothing,
)
from tmax_harness import client


def _eval_contains(config, expr: str, expected: str, message: str) -> AssertionResult:
    result = client.eval_expr(config, expr)
    if result.is_err():
        return AssertionResult(False, message, Some(result.unwrap_err().message))
    output = result.unwrap()
    if expected in output:
      return AssertionResult(True, message)
    return AssertionResult(False, message, Some(f"Expected {expected!r} in {output!r}"))


def test_modes() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []
    state_result = init()
    if state_result.is_err():
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    test_file = f"{state.config.test_dir}/mode-test.py"
    create_test_file(test_file, "print('hello')\n")

    start_result = start(state, test_file)
    if start_result.is_err():
        delete_test_file(test_file)
        err = start_result.unwrap_err()
        return (AssertionResult(False, f"Editor start failed: {err.message}", err.details),)
    state = start_result.unwrap()

    results.append(_eval_contains(
        state.config,
        "(major-mode-list)",
        "python",
        "Built-in python major mode should be registered",
    ))
    results.append(_eval_contains(
        state.config,
        "(featurep \"python-mode\")",
        "true",
        "python-mode feature should be provided at startup",
    ))
    results.append(_eval_contains(
        state.config,
        "(featurep \"line-numbers-mode\")",
        "true",
        "line-numbers-mode feature should be provided at startup",
    ))
    results.append(_eval_contains(
        state.config,
        "(minor-mode-list-all)",
        "line-numbers",
        "Built-in line-numbers minor mode should be registered",
    ))

    client.eval_expr(state.config, "(line-numbers-mode t)")
    status_result = client.status(state.config)
    if status_result.is_err():
        results.append(AssertionResult(False, "Daemon status should be available"))
    else:
        status = status_result.unwrap()
        editor = status.get("editor", {})
        results.append(AssertionResult(
            editor.get("currentMajorMode") == "python",
            "Daemon status should expose current major mode",
            Some(str(editor)) if editor.get("currentMajorMode") != "python" else Nothing,
        ))
        results.append(AssertionResult(
            "line-numbers" in editor.get("activeMinorModes", []),
            "Daemon status should expose active minor mode names",
            Some(str(editor)) if "line-numbers" not in editor.get("activeMinorModes", []) else Nothing,
        ))
        results.append(AssertionResult(
            "Ln" in editor.get("activeMinorModeLighters", []),
            "Daemon status should expose minor mode lighters",
            Some(str(editor)) if "Ln" not in editor.get("activeMinorModeLighters", []) else Nothing,
        ))

        if state.config.mode == "daemon-tmux":
            frames = status.get("frames", [])
            frame = frames[0] if frames else {}
            results.append(AssertionResult(
                frame.get("currentMajorMode") == "python",
                "TUI frame status should expose current major mode",
                Some(str(frame)) if frame.get("currentMajorMode") != "python" else Nothing,
            ))

    cleanup(state)
    delete_test_file(test_file)
    return tuple(results)


if __name__ == "__main__":
    results = test_modes()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
