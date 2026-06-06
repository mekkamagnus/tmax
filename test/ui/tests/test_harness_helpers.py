"""Test: Harness helpers — pure function unit tests for T-Lisp escaping and parsing."""

import sys
import os
import shutil
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness.tlisp_escape import (
    escape_tlisp_string, string_literal, buffer_insert, editor_set_mode,
    cursor_move, search_forward,
)
from tmax_harness.types import parse_value
from tmax_harness.assertions import (
    AssertionResult, assert_no_errors, assert_screen_fill, summarize, format_summary,
)
from tmax_harness.config import load_config
from tmax_harness.input import translate_key_for_daemon


def test_escape_tlisp_string() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    print("=== Test: Harness Helpers ===")

    # Basic string
    results.append(AssertionResult(
        escape_tlisp_string("hello") == "hello",
        "Plain string should pass through",
    ))

    # Quotes
    results.append(AssertionResult(
        escape_tlisp_string('say "hi"') == 'say \\"hi\\"',
        "Quotes should be escaped",
    ))

    # Backslash
    results.append(AssertionResult(
        escape_tlisp_string("path\\to\\file") == "path\\\\to\\\\file",
        "Backslashes should be doubled",
    ))

    # Newline
    results.append(AssertionResult(
        escape_tlisp_string("line1\nline2") == "line1\\nline2",
        "Newlines should be escaped",
    ))

    # Tab
    results.append(AssertionResult(
        escape_tlisp_string("col1\tcol2") == "col1\\tcol2",
        "Tabs should be escaped",
    ))

    # Empty string
    results.append(AssertionResult(
        escape_tlisp_string("") == "",
        "Empty string should pass through",
    ))

    # String literal builder
    results.append(AssertionResult(
        string_literal("hello") == '"hello"',
        'string_literal should wrap in quotes',
    ))
    results.append(AssertionResult(
        string_literal('say "hi"') == '"say \\"hi\\""',
        'string_literal should escape quotes inside',
    ))

    # Expression builders
    results.append(AssertionResult(
        buffer_insert("hello") == '(buffer-insert "hello")',
        "buffer_insert should build correct expression",
    ))
    results.append(AssertionResult(
        editor_set_mode("insert") == '(editor-set-mode "insert")',
        "editor_set_mode should build correct expression",
    ))
    results.append(AssertionResult(
        cursor_move(3, 5) == "(cursor-move 3 5)",
        "cursor_move should build correct expression",
    ))
    results.append(AssertionResult(
        search_forward("hello world") == '(search-forward "hello world")',
        "search_forward should build correct expression",
    ))
    results.append(AssertionResult(
        translate_key_for_daemon("Backspace") == "\x7f",
        "Backspace should map to raw DEL character for --key",
    ))
    results.append(AssertionResult(
        translate_key_for_daemon("Escape") == "\x1b",
        "Escape should map to raw ESC character for --key",
    ))

    # parse_value
    results.append(AssertionResult(
        parse_value("42") == 42,
        "parse_value should parse integers",
    ))
    results.append(AssertionResult(
        parse_value("3.14") == 3.14,
        "parse_value should parse floats",
    ))
    results.append(AssertionResult(
        parse_value("true") is True,
        "parse_value should parse true",
    ))
    results.append(AssertionResult(
        parse_value("nil") is None,
        "parse_value should parse nil as None",
    ))
    results.append(AssertionResult(
        parse_value('"hello"') == "hello",
        "parse_value should strip quotes from strings",
    ))
    results.append(AssertionResult(
        parse_value("[1, 2, 3]") == [1, 2, 3],
        "parse_value should parse lists",
    ))
    results.append(AssertionResult(
        parse_value("[0, 5]") == [0, 5],
        "parse_value should parse cursor positions",
    ))
    results.append(AssertionResult(
        parse_value("") is None,
        "parse_value should return None for empty",
    ))

    # Per-run resource isolation
    first = load_config({"run_id": "helpers-one", "mode_override": "daemon"})
    second = load_config({"run_id": "helpers-two", "mode_override": "daemon"})
    results.append(AssertionResult(
        first.socket_path != second.socket_path
        and first.session_name != second.session_name
        and first.test_dir != second.test_dir,
        "Harness configs should isolate sockets, tmux sessions, and temp roots",
    ))
    scenario_dir = Path(__file__).resolve().parent
    shared_fixture_users = [
        path.name
        for path in scenario_dir.glob("*.py")
        if path.name != Path(__file__).name
        and 'state.config.project_root}/' in path.read_text()
    ]
    results.append(AssertionResult(
        not shared_fixture_users,
        f"Scenarios should keep fixture files in their owned temp roots: {shared_fixture_users}",
    ))

    # Skips are reported separately from passes.
    skipped = assert_screen_fill(first, "")
    skipped_summary = summarize((skipped,))
    results.append(AssertionResult(
        skipped_summary.passed == 0
        and skipped_summary.failed == 0
        and skipped_summary.skipped == 1,
        "Unavailable renderer assertions should report skip, not pass",
    ))

    # Daemon query failures are failures.
    missing_client = load_config({
        "run_id": "helpers-missing-client",
        "mode_override": "daemon",
        "client_cmd": "/definitely/missing/tmaxclient",
    })
    results.append(AssertionResult(
        assert_no_errors(missing_client, "").failed,
        "Daemon query failures should fail error assertions",
    ))

    shutil.rmtree(first.test_dir, ignore_errors=True)
    shutil.rmtree(second.test_dir, ignore_errors=True)
    shutil.rmtree(missing_client.test_dir, ignore_errors=True)

    return tuple(results)


if __name__ == "__main__":
    results = test_escape_tlisp_string()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
