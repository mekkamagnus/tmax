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


def _is_daemon(config: HarnessConfig) -> bool:
    """Check if running in any daemon mode."""
    return config.mode.startswith("daemon")


# ---------------------------------------------------------------------------
# Mode operations
# ---------------------------------------------------------------------------

def enter_insert(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Enter insert mode."""
    if _is_daemon(config):
        r = client.eval_expr(config, editor_set_mode("insert"))
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    inp.send_escape(config, window)
    time.sleep(0.1)
    r = inp.send_key(config, window, "i")
    time.sleep(config.operation_delay)
    return r


def enter_normal(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Enter normal mode."""
    if _is_daemon(config):
        r = client.eval_expr(config, editor_set_mode("normal"))
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    r = inp.send_escape(config, window)
    time.sleep(config.operation_delay)
    return r


def enter_visual(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Enter visual (char) mode."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(visual-enter-char-mode)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    inp.send_escape(config, window)
    r = inp.send_key(config, window, "v")
    time.sleep(config.operation_delay)
    return r


def enter_command_mode(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Enter command mode (:)."""
    if _is_daemon(config):
        r = client.eval_expr(config, '(editor-enter-command-mode)')
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    inp.send_escape(config, window)
    r = inp.send_key(config, window, ":")
    time.sleep(config.operation_delay)
    return r


def exit_command_mode(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Exit command mode (Escape)."""
    if _is_daemon(config):
        r = client.eval_expr(config, '(editor-exit-command-mode)')
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_escape(config, window)


def enter_mx_mode(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Enter M-x mode (SPC ;)."""
    if _is_daemon(config):
        r = client.eval_expr(config, '(editor-set-mode "mx")')
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    inp.send_escape(config, window)
    inp.send_key(config, window, "Space")
    r = inp.send_key(config, window, ";")
    time.sleep(config.operation_delay)
    return r


def exit_mx_mode(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Exit M-x mode."""
    if _is_daemon(config):
        r = client.eval_expr(config, '(editor-exit-mx-mode)')
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_escape(config, window)


# ---------------------------------------------------------------------------
# Text operations
# ---------------------------------------------------------------------------

def type_text(config: HarnessConfig, window: str, text: str) -> Result[None, HarnessError]:
    """Type text into buffer."""
    if _is_daemon(config):
        r = client.eval_expr(config, buffer_insert(text))
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_text(config, window, text)


def delete_text(config: HarnessConfig, window: str, text: str) -> Result[None, HarnessError]:
    """Delete text from buffer."""
    if _is_daemon(config):
        r = client.eval_expr(config, buffer_delete(text))
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return Err(HarnessError("delete_text not supported in tmux mode"))


def save_file(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Save current file."""
    if _is_daemon(config):
        r = client.eval_expr(config, '(file-save)')
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    enter_normal(config, window)
    r = inp.send_vim_command(config, window, "w")
    time.sleep(config.operation_delay)
    return r


def quit_editor(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Quit editor."""
    if _is_daemon(config):
        r = client.eval_expr(config, '(editor-quit)')
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    enter_normal(config, window)
    r = inp.send_vim_command(config, window, "q")
    time.sleep(config.operation_delay)
    return r


# ---------------------------------------------------------------------------
# Navigation operations
# ---------------------------------------------------------------------------

def move_cursor(config: HarnessConfig, window: str, line: int, col: int) -> Result[None, HarnessError]:
    """Move cursor to absolute position (0-indexed)."""
    if _is_daemon(config):
        r = client.eval_expr(config, cursor_move(line, col))
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return Err(HarnessError("Absolute cursor move not supported in tmux mode"))


def word_next(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Move to next word."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(word-next)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "w")


def word_previous(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Move to previous word."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(word-previous)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "b")


def line_start(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Move to start of line."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(line-first-column)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "0")


def line_end(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Move to end of line."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(line-last-column)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "$")


def jump_first_line(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Jump to first line."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(jump-to-first-line)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "g")


def jump_last_line(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Jump to last line."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(jump-to-last-line)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "G")


def page_up(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Page up."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(page-up)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "C-b")


def page_down(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Page down."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(page-down)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "C-f")


def line_next(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Move to next line."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(line-next)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "j")


def line_previous(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Move to previous line."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(line-previous)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "k")


# ---------------------------------------------------------------------------
# Editing operator operations
# ---------------------------------------------------------------------------

def delete_line(config: HarnessConfig, window: str, line: int) -> Result[None, HarnessError]:
    """Delete a line by index (0-indexed). Must move to line first."""
    if _is_daemon(config):
        client.eval_expr(config, cursor_move(line, 0))
        r = client.eval_expr(config, "(delete-line)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return Err(HarnessError("delete_line not supported in tmux mode"))


def undo(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Undo last change."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(undo)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "u")


def redo(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    """Redo last undone change."""
    if _is_daemon(config):
        r = client.eval_expr(config, "(redo)")
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return inp.send_key(config, window, "C-r")


# ---------------------------------------------------------------------------
# Search operations
# ---------------------------------------------------------------------------

def search(config: HarnessConfig, window: str, pattern: str) -> Result[None, HarnessError]:
    """Search forward for pattern. Fails if not found."""
    if _is_daemon(config):
        r = client.eval_expr(config, search_forward(pattern))
        time.sleep(config.operation_delay)
        return r.map(lambda _: None)
    return Err(HarnessError("search not supported in tmux mode"))


# ---------------------------------------------------------------------------
# Buffer operations
# ---------------------------------------------------------------------------

def open_file(config: HarnessConfig, window: str, path: str) -> Result[None, HarnessError]:
    """Open a file via the daemon."""
    if _is_daemon(config):
        try:
            import subprocess
            subprocess.run(
                [config.client_cmd, path],
                capture_output=True, text=True, timeout=5,
            )
            time.sleep(config.operation_delay)
            return Ok(None)
        except (subprocess.TimeoutExpired, FileNotFoundError) as e:
            return Err(HarnessError(f"Failed to open file: {e}"))
    return Err(HarnessError("open_file via tmux not supported"))


# ---------------------------------------------------------------------------
# Legacy move (kept for backward compatibility)
# ---------------------------------------------------------------------------

def move(config: HarnessConfig, window: str, direction: str, count: int = 1) -> Result[None, HarnessError]:
    """Move cursor in direction. Uses daemon API in daemon modes."""
    direction_ops = {
        "up": line_previous, "down": line_next,
        "left": line_previous, "right": line_next,
    }
    nav_ops = {
        "up": line_previous, "down": line_next,
    }
    if _is_daemon(config):
        op = nav_ops.get(direction)
        if not op:
            return Err(HarnessError(f"Unknown direction: {direction}"))
        for _ in range(count):
            op(config, window)
        return Ok(None)
    key_map = {
        "up": "k", "down": "j", "left": "h", "right": "l",
        "u": "k", "d": "j", "h": "h", "l": "l",
        "k": "k", "j": "j",
    }
    key = key_map.get(direction)
    if not key:
        return Err(HarnessError(f"Unknown direction: {direction}"))
    enter_normal(config, window)
    for _ in range(count):
        inp.send_key(config, window, key)
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
