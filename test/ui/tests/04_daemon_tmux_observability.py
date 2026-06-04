"""Test: Daemon/Tmux Observability — verify structured TUI readiness."""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_screen_fill, assert_tui_connected, assert_tui_ready,
    assert_render_count_at_least, assert_frame_editor_sync,
    assert_no_client_errors, enter_insert,
    create_test_file, delete_test_file,
    AssertionResult, Some,
)
from tmax_harness import client


def _max_render_count(status: dict) -> int:
    frames = status.get("frames", [])
    if not isinstance(frames, list):
        return 0
    counts = [
        int(frame.get("renderCount") or 0)
        for frame in frames
        if isinstance(frame, dict) and frame.get("clientType") == "tui"
    ]
    return max(counts) if counts else 0


def test_daemon_tmux_observability() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Daemon/Tmux Observability ===")

    state_result = init({"mode_override": "daemon-tmux"})
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)
    state = state_result.unwrap()

    print(f"Mode: {state.config.mode}")

    test_file = f"{state.config.test_dir}/observability-test.txt"
    create_test_file(test_file, "Observed content")

    start_result = start(state, test_file)
    if start_result.is_err():
        delete_test_file(test_file)
        err = start_result.unwrap_err()
        details = err.details.unwrap_or("")
        print(f"ERROR: {err.message}")
        if details:
            print(details)
        return (AssertionResult(False, f"Editor start failed: {err.message}", Some(details)),)
    state = start_result.unwrap()
    window = state.active_window.unwrap_or("")

    status_result = client.status(state.config)
    if status_result.is_err():
        results.append(AssertionResult(False, "Daemon status should be available"))
        initial_render_count = 0
    else:
        initial_render_count = _max_render_count(status_result.unwrap())

    results.append(assert_tui_connected(state.config))
    results.append(assert_tui_ready(state.config))
    results.append(assert_render_count_at_least(state.config, 1))
    results.append(assert_frame_editor_sync(state.config))
    results.append(assert_screen_fill(state.config, window))

    enter_insert(state.config, window)
    time.sleep(1.0)

    results.append(assert_frame_editor_sync(state.config, "Frame should follow daemon mode change"))
    results.append(assert_render_count_at_least(
        state.config,
        initial_render_count + 1,
        "Render count should advance after daemon state change",
    ))
    results.append(assert_no_client_errors(state.config))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_daemon_tmux_observability()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
