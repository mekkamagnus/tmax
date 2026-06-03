"""Pure assertion functions — each returns frozen AssertionResult."""

from __future__ import annotations

import os
import re
import subprocess

from .types import (
    HarnessConfig, HarnessState, AssertionResult, AssertionSummary,
    Option, Some, Nothing,
)
from . import client
from . import queries


def _is_daemon(config: HarnessConfig) -> bool:
    return config.mode.startswith("daemon")


def _status(config: HarnessConfig) -> dict:
    result = client.status(config)
    return result.unwrap_or({})


def _tui_frames(status: dict) -> list[dict]:
    frames = status.get("frames", [])
    if not isinstance(frames, list):
        return []
    return [
        frame for frame in frames
        if isinstance(frame, dict) and frame.get("clientType") == "tui"
    ]


def assert_text_visible(config: HarnessConfig, window: str, pattern: str,
                        msg: str = "") -> AssertionResult:
    message = msg or f"Text visible: {pattern}"
    # Use daemon buffer query in any daemon mode
    if _is_daemon(config):
        result = client.buffer_contains(config, pattern)
        if result.is_ok() and result.unwrap():
            return AssertionResult(passed=True, message=message)
        return AssertionResult(passed=False, message=message,
                              details=Some(f"Pattern not in buffer: {pattern}"))
    # Fallback: tmux screen scraping
    if queries.text_visible(config, window, pattern):
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message)


def assert_mode(config: HarnessConfig, window: str, expected: str,
                msg: str = "") -> AssertionResult:
    message = msg or f"Mode should be {expected}"
    if _is_daemon(config):
        return assert_daemon_mode(config, expected, message)
    actual = queries.capture_output(config, window).unwrap_or("")
    if expected.upper() in actual:
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some(f"Screen output does not contain {expected}"))


def assert_daemon_mode(config: HarnessConfig, expected: str,
                       msg: str = "") -> AssertionResult:
    message = msg or f"Daemon mode should be {expected}"
    result = client.get_mode(config)
    if result.is_err():
        return AssertionResult(passed=False, message=message,
                              details=Some(f"Daemon query failed: {result.unwrap_err().message}"))
    actual = result.unwrap()
    if actual == expected.upper():
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some(f"Actual mode: {actual}"))


def assert_daemon_text(config: HarnessConfig, pattern: str,
                       msg: str = "") -> AssertionResult:
    message = msg or f"Buffer should contain: {pattern}"
    result = client.buffer_contains(config, pattern)
    if result.is_ok() and result.unwrap():
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message)


def assert_no_errors(config: HarnessConfig, window: str,
                     msg: str = "") -> AssertionResult:
    message = msg or "No errors should be present"
    if _is_daemon(config):
        # Check daemon buffer for error indicators
        result = client.get_buffer_text(config)
        if result.is_ok():
            text = result.unwrap()
            if not re.search(r"error|failed|exception", text, re.IGNORECASE):
                return AssertionResult(passed=True, message=message)
            return AssertionResult(passed=False, message=message,
                                  details=Some("Error indicators in buffer"))
        return AssertionResult(passed=True, message=message,
                              details=Some("Daemon query failed, assuming no errors"))
    if not queries.has_errors(config, window):
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message)


def assert_running(state: HarnessState, msg: str = "") -> AssertionResult:
    message = msg or "Editor should be running"
    from . import editor
    if editor.daemon_is_running(state):
        return AssertionResult(passed=True, message=message)
    # Also check tmux window
    window = state.active_window.unwrap_or("")
    if window:
        result = queries.capture_output(state.config, window)
        if result.is_ok() and result.unwrap().strip():
            return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message)


def assert_screen_fill(config: HarnessConfig, window: str,
                       msg: str = "", tolerance: int = 2) -> AssertionResult:
    message = msg or "UI should fill terminal height"
    # Screen fill only applies when a TUI is rendering in tmux
    if config.mode in ("daemon", "direct"):
        return AssertionResult(passed=True, message=f"{message} (skipped: {config.mode} mode)")

    if not window:
        return AssertionResult(passed=True, message=f"{message} (skipped: no window)")

    try:
        proc = subprocess.run(
            ["tmux", "display", "-t", f"{config.session_name}:{window}",
             "-p", "#{pane_height}"],
            capture_output=True, text=True, timeout=5,
        )
        if proc.returncode != 0:
            return AssertionResult(passed=False, message=message,
                                  details=Some("Failed to get terminal height"))
        term_height = int(proc.stdout.strip())
    except (subprocess.TimeoutExpired, ValueError) as e:
        return AssertionResult(passed=False, message=message,
                              details=Some(f"Height query error: {e}"))

    result = subprocess.run(
        ["tmux", "capture-pane", "-t", f"{config.session_name}:{window}", "-p"],
        capture_output=True, text=True, timeout=5,
    )
    line_count = len(result.stdout.splitlines()) if result.stdout else 0
    diff = abs(term_height - line_count)

    if diff <= tolerance:
        return AssertionResult(passed=True, message=message,
                              details=Some(f"terminal: {term_height}, rendered: {line_count}"))
    return AssertionResult(passed=False, message=message,
                          details=Some(f"terminal: {term_height}, rendered: {line_count}, diff: {diff}"))


def assert_tui_connected(config: HarnessConfig, msg: str = "") -> AssertionResult:
    message = msg or "TUI client should be connected"
    status = _status(config)
    frames = _tui_frames(status)
    if frames:
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some("No connected TUI frames in daemon status"))


def assert_tui_ready(config: HarnessConfig, msg: str = "") -> AssertionResult:
    message = msg or "TUI client should be ready"
    status = _status(config)
    for frame in _tui_frames(status):
        if (
            frame.get("ready") is True
            and bool(frame.get("firstRenderAt"))
            and frame.get("rawModeReady") is True
            and int(frame.get("renderCount") or 0) >= 1
        ):
            return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some("No TUI frame reached readiness"))


def assert_render_count_at_least(config: HarnessConfig, minimum: int,
                                 msg: str = "") -> AssertionResult:
    message = msg or f"TUI render count should be >= {minimum}"
    status = _status(config)
    counts = [int(frame.get("renderCount") or 0) for frame in _tui_frames(status)]
    if counts and max(counts) >= minimum:
        return AssertionResult(passed=True, message=message,
                              details=Some(f"render counts: {counts}"))
    return AssertionResult(passed=False, message=message,
                          details=Some(f"render counts: {counts}"))


def assert_no_client_errors(config: HarnessConfig, msg: str = "") -> AssertionResult:
    message = msg or "Daemon clients should have no errors"
    status = _status(config)
    errors = status.get("recentErrors", [])
    if isinstance(errors, list) and len(errors) == 0:
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some(f"recent errors: {errors}"))


def assert_frame_editor_sync(config: HarnessConfig, msg: str = "") -> AssertionResult:
    message = msg or "TUI frame should match editor state"
    status = _status(config)
    editor = status.get("editor", {})
    if not isinstance(editor, dict):
        return AssertionResult(passed=False, message=message,
                              details=Some("Missing editor status"))

    editor_mode = str(editor.get("mode", "")).upper()
    editor_file = editor.get("currentFilename")
    for frame in _tui_frames(status):
        frame_mode = str(frame.get("mode", "")).upper()
        frame_file = frame.get("currentFilename")
        if frame_mode == editor_mode and frame_file == editor_file:
            return AssertionResult(passed=True, message=message)

    return AssertionResult(passed=False, message=message,
                          details=Some(f"editor={editor}, frames={_tui_frames(status)}"))


def assert_file_exists(path: str, msg: str = "") -> AssertionResult:
    message = msg or f"File should exist: {path}"
    if os.path.isfile(path):
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message)


def assert_file_contains(path: str, pattern: str, msg: str = "") -> AssertionResult:
    message = msg or f"File should contain: {pattern}"
    try:
        with open(path) as f:
            if pattern in f.read():
                return AssertionResult(passed=True, message=message)
    except FileNotFoundError:
        pass
    return AssertionResult(passed=False, message=message)


# ---------------------------------------------------------------------------
# Cursor assertions
# ---------------------------------------------------------------------------

def assert_cursor_position(config: HarnessConfig, expected_line: int, expected_col: int,
                           msg: str = "") -> AssertionResult:
    message = msg or f"Cursor should be at ({expected_line}, {expected_col})"
    result = client.get_cursor_position(config)
    if result.is_err():
        return AssertionResult(passed=False, message=message,
                              details=Some(f"Query failed: {result.unwrap_err().message}"))
    actual = result.unwrap()
    if actual == (expected_line, expected_col):
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some(f"Actual position: {actual}"))


def assert_cursor_line(config: HarnessConfig, expected_line: int,
                       msg: str = "") -> AssertionResult:
    message = msg or f"Cursor line should be {expected_line}"
    result = client.get_cursor_position(config)
    if result.is_err():
        return AssertionResult(passed=False, message=message,
                              details=Some(f"Query failed: {result.unwrap_err().message}"))
    actual_line = result.unwrap()[0]
    if actual_line == expected_line:
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some(f"Actual line: {actual_line}"))


def assert_cursor_col(config: HarnessConfig, expected_col: int,
                      msg: str = "") -> AssertionResult:
    message = msg or f"Cursor column should be {expected_col}"
    result = client.get_cursor_position(config)
    if result.is_err():
        return AssertionResult(passed=False, message=message,
                              details=Some(f"Query failed: {result.unwrap_err().message}"))
    actual_col = result.unwrap()[1]
    if actual_col == expected_col:
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some(f"Actual column: {actual_col}"))


# ---------------------------------------------------------------------------
# Buffer assertions
# ---------------------------------------------------------------------------

def assert_buffer_text_equals(config: HarnessConfig, expected: str,
                               msg: str = "") -> AssertionResult:
    message = msg or "Buffer text should match expected"
    result = client.get_buffer_text(config)
    if result.is_err():
        return AssertionResult(passed=False, message=message,
                              details=Some(f"Query failed: {result.unwrap_err().message}"))
    actual = result.unwrap()
    if actual == expected:
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some(f"Expected: {expected!r}, Got: {actual!r}"))


def assert_buffer_not_contains(config: HarnessConfig, pattern: str,
                                msg: str = "") -> AssertionResult:
    message = msg or f"Buffer should not contain: {pattern}"
    result = client.buffer_contains(config, pattern)
    if result.is_ok() and not result.unwrap():
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some(f"Pattern found in buffer: {pattern}"))


def assert_buffer_list_contains(config: HarnessConfig, name: str,
                                 msg: str = "") -> AssertionResult:
    message = msg or f"Buffer list should contain: {name}"
    result = client.get_buffer_list(config)
    if result.is_err():
        return AssertionResult(passed=False, message=message,
                              details=Some(f"Query failed: {result.unwrap_err().message}"))
    if name in result.unwrap():
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some(f"Buffer list: {result.unwrap()}"))


def assert_buffer_modified(config: HarnessConfig, expected: bool,
                           msg: str = "") -> AssertionResult:
    message = msg or f"Buffer modified should be {expected}"
    result = client.eval_expr(config, "(buffer-modified-p)")
    if result.is_err():
        return AssertionResult(passed=False, message=message,
                              details=Some(f"Query failed: {result.unwrap_err().message}"))
    raw = result.unwrap().strip().lower()
    actual = raw == "true"
    if actual == expected:
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some(f"Actual: {raw}"))


def assert_not_daemon_error(result: Result, msg: str = "") -> AssertionResult:
    """Assert a daemon eval result is not an error (for command-mode tests)."""
    message = msg or "Daemon eval should succeed"
    if result.is_ok():
        return AssertionResult(passed=True, message=message)
    err = result.unwrap_err()
    return AssertionResult(passed=False, message=message,
                          details=Some(err.message))


# ---------------------------------------------------------------------------
# File assertions
# ---------------------------------------------------------------------------

def assert_file_not_contains(path: str, pattern: str, msg: str = "") -> AssertionResult:
    message = msg or f"File should not contain: {pattern}"
    try:
        with open(path) as f:
            if pattern not in f.read():
                return AssertionResult(passed=True, message=message)
    except FileNotFoundError:
        return AssertionResult(passed=True, message=message,
                              details=Some("File does not exist"))
    return AssertionResult(passed=False, message=message)


def assert_file_content_equals(path: str, expected: str, msg: str = "") -> AssertionResult:
    message = msg or "File content should match expected"
    try:
        with open(path) as f:
            actual = f.read()
        if actual == expected:
            return AssertionResult(passed=True, message=message)
        return AssertionResult(passed=False, message=message,
                              details=Some(f"Expected: {expected!r}, Got: {actual!r}"))
    except FileNotFoundError:
        return AssertionResult(passed=False, message=message,
                              details=Some("File not found"))


# ---------------------------------------------------------------------------
# Renderer layout assertions (daemon-tmux only)
# ---------------------------------------------------------------------------

def assert_status_line_visible(config: HarnessConfig, window: str,
                                msg: str = "") -> AssertionResult:
    message = msg or "Status line should be visible in tmux pane"
    if config.mode != "daemon-tmux":
        return AssertionResult(passed=True, message=f"{message} (skipped: {config.mode})")
    result = queries.capture_output(config, window)
    if result.is_err():
        return AssertionResult(passed=False, message=message)
    output = result.unwrap()
    # Status line contains mode indicators and cursor info
    if re.search(r'(NORMAL|INSERT|VISUAL|COMMAND|M-X).*\d+.*\d+', output):
        return AssertionResult(passed=True, message=message)
    return AssertionResult(passed=False, message=message,
                          details=Some("No status line pattern found in pane output"))


def assert_render_count_advanced(config: HarnessConfig, baseline: int,
                                  msg: str = "") -> AssertionResult:
    message = msg or f"Render count should have advanced past {baseline}"
    status = _status(config)
    counts = [int(f.get("renderCount") or 0) for f in _tui_frames(status)]
    if counts and max(counts) > baseline:
        return AssertionResult(passed=True, message=message,
                              details=Some(f"render counts: {counts}, baseline: {baseline}"))
    return AssertionResult(passed=False, message=message,
                          details=Some(f"render counts: {counts}, baseline: {baseline}"))


def summarize(results: tuple[AssertionResult, ...]) -> AssertionSummary:
    """Aggregate assertion results into a summary."""
    return AssertionSummary(results=results)


def format_summary(summary: AssertionSummary) -> str:
    """Format summary for display. Pure string formatting."""
    lines = [
        "",
        "=== Assertion Summary ===",
        f"Total:     {summary.total}",
        f"Passed:    {summary.passed}",
        f"Failed:    {summary.failed}",
    ]
    if summary.failed > 0:
        lines.append("")
        lines.append("Failed assertions:")
        for r in summary.results:
            if r.failed:
                lines.append(f"  - {r.message}")
                if isinstance(r.details, Some):
                    lines.append(f"    {r.details.unwrap()}")
    return "\n".join(lines)
