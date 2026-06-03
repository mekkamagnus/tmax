"""Test: Harness helpers — pure function unit tests for T-Lisp escaping and parsing."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tmax_harness.tlisp_escape import (
    escape_tlisp_string, string_literal, buffer_insert, editor_set_mode,
    cursor_move, search_forward,
)
from tmax_harness.types import parse_value
from tmax_harness.assertions import AssertionResult, summarize, format_summary


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

    return tuple(results)


if __name__ == "__main__":
    results = test_escape_tlisp_string()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
