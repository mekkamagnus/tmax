"""Safe T-Lisp expression builders — pure functions, no string interpolation bugs."""

from __future__ import annotations


def escape_tlisp_string(text: str) -> str:
    """Escape a Python string for embedding inside a T-Lisp string literal."""
    return (
        text
        .replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )


def string_literal(text: str) -> str:
    """Build a T-Lisp string literal: '"escaped text"'."""
    return f'"{escape_tlisp_string(text)}"'


def buffer_insert(text: str) -> str:
    """Build (buffer-insert "escaped text")."""
    return f"(buffer-insert {string_literal(text)})"


def buffer_delete(text: str) -> str:
    """Build (buffer-delete "escaped text")."""
    return f"(buffer-delete {string_literal(text)})"


def editor_set_mode(mode: str) -> str:
    """Build (editor-set-mode "mode")."""
    return f"(editor-set-mode {string_literal(mode)})"


def cursor_move(line: int, col: int) -> str:
    """Build (cursor-move line col)."""
    return f"(cursor-move {line} {col})"


def search_forward(pattern: str) -> str:
    """Build (search-forward "escaped pattern")."""
    return f"(search-forward {string_literal(pattern)})"


def find_file(path: str) -> str:
    """Build (file-open "path") — daemon uses file-open, not find-file."""
    return f"(file-open {string_literal(path)})"


def keypress(key: str) -> str:
    """Build (handle-keypress "key")."""
    return f"(handle-keypress {string_literal(key)})"
