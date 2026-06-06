"""Higher-level operation functions — compose input + queries."""

from __future__ import annotations

import os
import time

from .types import HarnessConfig, HarnessError, Result, Ok, Err
from . import client
from . import input as inp
from . import queries
from .tlisp_escape import (
    buffer_insert, buffer_delete, editor_set_mode, cursor_move,
    search_forward, find_file, keypress,
)


# ---------------------------------------------------------------------------
# Mode operations
# ---------------------------------------------------------------------------

def enter_insert(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    inp.send_escape(config)
    time.sleep(0.1)
    r = inp.send_key(config, "i")
    time.sleep(config.operation_delay)
    return r


def enter_normal(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    r = inp.send_escape(config)
    time.sleep(config.operation_delay)
    return r


def enter_visual(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    inp.send_escape(config)
    r = inp.send_key(config, "v")
    time.sleep(config.operation_delay)
    return r


def enter_command_mode(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    inp.send_escape(config)
    r = inp.send_key(config, ":")
    time.sleep(config.operation_delay)
    return r


def exit_command_mode(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_escape(config)


def enter_mx_mode(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    inp.send_escape(config)
    inp.send_key(config, "Space")
    r = inp.send_key(config, ";")
    time.sleep(config.operation_delay)
    return r


def exit_mx_mode(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_escape(config)


# ---------------------------------------------------------------------------
# Text operations
# ---------------------------------------------------------------------------

def type_text(config: HarnessConfig, window: str = "", text: str = "") -> Result[None, HarnessError]:
    return inp.send_text(config, text)


def delete_text(config: HarnessConfig, window: str = "", text: str = "") -> Result[None, HarnessError]:
    count = len(text)
    r = client.eval_expr(
        config,
        f"(progn (cursor-move (cursor-line) (- (cursor-column) {count})) "
        f"{buffer_delete(count)})",
    )
    time.sleep(config.operation_delay)
    return r.map(lambda _: None)


def save_file(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    enter_normal(config)
    r = inp.send_vim_command(config, "w")
    time.sleep(config.operation_delay)
    return r


def quit_editor(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    enter_normal(config)
    r = inp.send_vim_command(config, "q")
    time.sleep(config.operation_delay)
    return r


# ---------------------------------------------------------------------------
# Navigation operations
# ---------------------------------------------------------------------------

def move_cursor(config: HarnessConfig, window: str = "", line: int = 0, col: int = 0) -> Result[None, HarnessError]:
    r = client.eval_expr(config, cursor_move(line, col))
    time.sleep(config.operation_delay)
    return r.map(lambda _: None)


def word_next(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_key(config, "w")


def word_previous(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_key(config, "b")


def line_start(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_key(config, "0")


def line_end(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_key(config, "$")


def jump_first_line(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_keys(config, "g", "g")


def jump_last_line(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_key(config, "G")


def page_up(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_key(config, "C-b")


def page_down(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_key(config, "C-f")


def line_next(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_key(config, "j")


def line_previous(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_key(config, "k")


# ---------------------------------------------------------------------------
# Editing operator operations
# ---------------------------------------------------------------------------

def delete_line(config: HarnessConfig, window: str = "", line: int = 0) -> Result[None, HarnessError]:
    client.eval_expr(config, cursor_move(line, 0))
    r = client.eval_expr(config, "(delete-line)")
    time.sleep(config.operation_delay)
    return r.map(lambda _: None)


def undo(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_key(config, "u")


def redo(config: HarnessConfig, window: str = "") -> Result[None, HarnessError]:
    return inp.send_key(config, "C-r")


# ---------------------------------------------------------------------------
# Search operations
# ---------------------------------------------------------------------------

def search(config: HarnessConfig, window: str = "", pattern: str = "") -> Result[None, HarnessError]:
    r = client.eval_expr(config, search_forward(pattern))
    time.sleep(config.operation_delay)
    return r.map(lambda _: None)


# ---------------------------------------------------------------------------
# Buffer operations
# ---------------------------------------------------------------------------

def open_file(config: HarnessConfig, window: str = "", path: str = "") -> Result[None, HarnessError]:
    try:
        import subprocess
        subprocess.run(
            [config.client_cmd, "--socket", config.socket_path, path],
            capture_output=True, text=True, timeout=5,
        )
        time.sleep(config.operation_delay)
        return Ok(None)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return Err(HarnessError(f"Failed to open file: {e}"))


# ---------------------------------------------------------------------------
# Legacy move (kept for backward compatibility)
# ---------------------------------------------------------------------------

def move(config: HarnessConfig, window: str = "", direction: str = "", count: int = 1) -> Result[None, HarnessError]:
    key_map = {
        "up": "k", "down": "j", "left": "h", "right": "l",
        "u": "k", "d": "j", "h": "h", "l": "l",
        "k": "k", "j": "j",
    }
    key = key_map.get(direction)
    if not key:
        return Err(HarnessError(f"Unknown direction: {direction}"))
    enter_normal(config)
    for _ in range(count):
        inp.send_key(config, key)
        time.sleep(config.key_delay)
    return Ok(None)


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------

def create_test_file(path: str, content: str) -> Result[None, HarnessError]:
    """Create a test file with content."""
    try:
        with open(path, "w") as f:
            f.write(content)
        return Ok(None)
    except OSError as e:
        return Err(HarnessError(f"Failed to create file: {e}"))


def delete_test_file(path: str) -> Result[None, HarnessError]:
    """Delete a test file."""
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as e:
        return Err(HarnessError(f"Failed to delete file: {e}"))
    return Ok(None)
