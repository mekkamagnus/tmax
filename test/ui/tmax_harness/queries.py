"""State query functions — daemon and tmux queries, wait loops."""

from __future__ import annotations

import re
import subprocess
import time

from .types import HarnessConfig, HarnessError, Result, Ok, Err
from . import client


# ---------------------------------------------------------------------------
# Daemon queries (take config)
# ---------------------------------------------------------------------------

def mode(config: HarnessConfig) -> Result[str, HarnessError]:
    """Get editor mode via daemon."""
    return client.get_mode(config)


def buffer_text(config: HarnessConfig) -> Result[str, HarnessError]:
    """Get buffer text via daemon."""
    return client.get_buffer_text(config)


def cursor_position(config: HarnessConfig) -> Result[tuple[int, int], HarnessError]:
    """Get cursor position via daemon."""
    return client.get_cursor_position(config)


# ---------------------------------------------------------------------------
# Tmux queries (take config, window)
# ---------------------------------------------------------------------------

def capture_output(config: HarnessConfig, window: str, lines: int = 0) -> Result[str, HarnessError]:
    """Capture tmux pane output."""
    if config.mode == "direct":
        return _capture_direct(config)

    if not window:
        return Err(HarnessError("No window specified"))

    capture_lines = lines or config.capture_lines
    try:
        proc = subprocess.run(
            ["tmux", "capture-pane", "-t", f"{config.session_name}:{window}",
             "-p", "-S", f"-{capture_lines}"],
            capture_output=True, text=True, timeout=10,
        )
        if proc.returncode != 0:
            return Err(HarnessError("capture-pane failed"))
        return Ok(proc.stdout)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return Err(HarnessError(f"capture-pane error: {e}"))


def text_visible(config: HarnessConfig, window: str, pattern: str) -> bool:
    """Check if pattern is visible in the tmux pane."""
    result = capture_output(config, window)
    if result.is_err():
        return False
    return pattern in result.unwrap()


def has_errors(config: HarnessConfig, window: str) -> bool:
    """Check for error indicators in the pane."""
    result = capture_output(config, window)
    if result.is_err():
        return False
    output = result.unwrap()
    return bool(re.search(r"error|failed|exception", output, re.IGNORECASE))


# ---------------------------------------------------------------------------
# Wait loops (boundary functions with side effects)
# ---------------------------------------------------------------------------

def wait_for_text(config: HarnessConfig, window: str, pattern: str,
                  timeout: int = 0) -> Result[None, HarnessError]:
    """Wait for text to appear in the pane."""
    timeout = timeout or config.default_timeout
    elapsed = 0.0
    while elapsed < timeout:
        if text_visible(config, window, pattern):
            return Ok(None)
        time.sleep(0.5)
        elapsed += 0.5
    return Err(HarnessError(f"Timeout waiting for text: {pattern}"))


def wait_for_mode(config: HarnessConfig, window: str, expected: str,
                  timeout: int = 0) -> Result[None, HarnessError]:
    """Wait for editor to reach expected mode."""
    timeout = timeout or config.default_timeout
    elapsed = 0.0
    while elapsed < timeout:
        result = mode(config)
        if result.is_ok() and result.unwrap() == expected.upper():
            return Ok(None)
        time.sleep(0.5)
        elapsed += 0.5
    actual = mode(config).unwrap_or("?")
    return Err(HarnessError(
        f"Timeout waiting for mode {expected} (current: {actual})",
    ))


def wait_for_ready(config: HarnessConfig, window: str,
                   timeout: int = 0) -> Result[None, HarnessError]:
    """Wait for the editor to be ready."""
    timeout = timeout or config.default_timeout

    if config.mode == "daemon-tmux":
        elapsed = 0.0
        while elapsed < timeout:
            if client.ping(config):
                return Ok(None)
            time.sleep(0.5)
            elapsed += 0.5
        return Err(HarnessError("Timeout waiting for daemon"))

    # Legacy: wait for NORMAL in output
    elapsed = 0.0
    while elapsed < timeout:
        if text_visible(config, window, "NORMAL"):
            return Ok(None)
        time.sleep(0.5)
        elapsed += 0.5
    return Err(HarnessError("Timeout waiting for editor"))


# ---------------------------------------------------------------------------
# Direct mode helpers
# ---------------------------------------------------------------------------

def _capture_direct(config: HarnessConfig) -> Result[str, HarnessError]:
    """Read direct-mode output file."""
    output_file = f"{config.test_dir}/direct-editor.log"
    try:
        with open(output_file) as f:
            return Ok(f.read())
    except FileNotFoundError:
        return Ok("")
