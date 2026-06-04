"""Test: Renderer Layout — daemon-tmux only, verifies TUI surface."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_screen_fill, assert_daemon_mode, assert_no_errors,
    assert_tui_connected, assert_tui_ready, assert_render_count_at_least,
    assert_render_count_advanced, assert_status_line_visible,
    assert_daemon_text,
    enter_insert, enter_normal, type_text,
    create_test_file, delete_test_file,
    AssertionResult, client,
)


def test_renderer_layout() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Renderer Layout (daemon-tmux) ===")

    state_result = init()
    if state_result.is_err():
        print(f"ERROR: {state_result.unwrap_err().message}")
        return (AssertionResult(False, "Harness init failed"),)

    state = state_result.unwrap()

    if state.config.mode != "daemon-tmux":
        print("SKIP: This test requires daemon-tmux mode")
        return (AssertionResult(True, "Skipped: not daemon-tmux mode"),)

    content = "Renderer test line 1\nLine 2 content\nLine 3 here"
    test_file = f"{state.config.test_dir}/renderer-test.txt"
    create_test_file(test_file, content)

    start_result = start(state, test_file)
    if start_result.is_err():
        print(f"ERROR: {start_result.unwrap_err().message}")
        delete_test_file(test_file)
        return (AssertionResult(False, f"Editor start failed: {start_result.unwrap_err().message}"),)
    state = start_result.unwrap()
    window = state.active_window.unwrap_or("")

    # TUI observability
    results.append(assert_tui_connected(state.config, "TUI should be connected"))
    results.append(assert_tui_ready(state.config, "TUI should be ready"))

    # Screen fill
    results.append(assert_screen_fill(state.config, window, "TUI should fill terminal height"))

    # Status line visible
    results.append(assert_status_line_visible(state.config, window, "Status line should be visible"))

    # Record baseline render count, then make a change and verify it advances
    status = client.status(state.config).unwrap_or({})
    tui_frames = [f for f in status.get("frames", []) if isinstance(f, dict) and f.get("clientType") == "tui"]
    baseline = max((int(f.get("renderCount") or 0) for f in tui_frames), default=0)

    # Make a daemon-side edit
    enter_insert(state.config, window)
    type_text(state.config, window, "new text")
    enter_normal(state.config, window)
    time.sleep(1)

    results.append(assert_render_count_advanced(state.config, baseline, "Render count should advance after edit"))

    # Buffer should have the edit
    results.append(assert_daemon_text(state.config, "new text", "Edit should be in buffer"))

    # No client errors throughout
    results.append(assert_no_errors(state.config, window, "No errors after render test"))

    cleanup(state)
    delete_test_file(test_file)

    return tuple(results)


if __name__ == "__main__":
    results = test_renderer_layout()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
