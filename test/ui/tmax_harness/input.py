"""Key sending functions — take (config, window) not self."""

from __future__ import annotations

import subprocess
import time

from .types import HarnessConfig, HarnessError, Result, Ok, Err


def translate_key(key: str) -> str:
    """Pure key translation for tmux send-keys. No IO."""
    mapping = {
        "Escape": "Escape",
        "Enter": "Enter",
        "Space": "Space",
        "Backspace": "BSpace",
        "Tab": "Tab",
        "C-[": "Escape",
        "C-m": "Enter",
        "C-f": "C-f",
        "C-b": "C-b",
        "C-d": "C-d",
        "C-u": "C-u",
        "C-r": "C-r",
        "C-g": "C-g",
        "C-n": "C-n",
        "C-p": "C-p",
        "C-x": "C-x",
    }
    return mapping.get(key, key)


def escape_literal_key(key: str) -> str:
    """Escape tmux command separators while preserving the literal key."""
    return key.replace(";", r"\;")


def _target(config: HarnessConfig, window: str) -> str:
    return f"{config.session_name}:{window}"


def _send_raw(target: str, keys: list[str], literal: bool = False) -> Result[None, HarnessError]:
    """Send keys to tmux target."""
    cmd = ["tmux", "send-keys"]
    if literal:
        cmd.append("-l")
    tmux_keys = [escape_literal_key(key) for key in keys] if literal else keys
    cmd.extend(["-t", target, *tmux_keys])
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        if proc.returncode != 0:
            return Err(HarnessError(
                f"send-keys failed: {proc.stderr.strip() or proc.stdout.strip()}",
            ))
        return Ok(None)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return Err(HarnessError(f"send-keys failed: {e}"))


def send_key(config: HarnessConfig, window: str, key: str) -> Result[None, HarnessError]:
    """Send a single key to window."""
    target = _target(config, window)
    translated = translate_key(key)
    # Use literal mode for regular characters, non-literal for special keys
    special_keys = {"Escape", "Enter", "Space", "BSpace", "Tab",
        "C-f", "C-b", "C-d", "C-u", "C-r", "C-g", "C-n", "C-p",
        "C-m", "C-w", "C-v", "C-x", "Up", "Down", "Left", "Right",
        "PageUp", "PageDown"}
    if translated in special_keys:
        result = _send_raw(target, [translated])
    else:
        result = _send_raw(target, [translated], literal=True)
    time.sleep(config.key_delay)
    return result


def send_keys(config: HarnessConfig, window: str, *keys: str) -> Result[None, HarnessError]:
    """Send multiple keys in sequence."""
    for key in keys:
        r = send_key(config, window, key)
        if r.is_err():
            return r
    return Ok(None)


def send_command(config: HarnessConfig, window: str, cmd: str) -> Result[None, HarnessError]:
    """Send a shell command (text + Enter)."""
    target = _target(config, window)
    result = _send_raw(target, [cmd, "Enter"])
    time.sleep(config.operation_delay)
    return result


def send_text(config: HarnessConfig, window: str, text: str) -> Result[None, HarnessError]:
    """Send text literally, character by character."""
    target = _target(config, window)
    for ch in text:
        r = _send_raw(target, [ch], literal=True)
        if r.is_err():
            return r
        time.sleep(config.key_delay)
    return Ok(None)


def send_enter(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    return send_key(config, window, "Enter")


def send_escape(config: HarnessConfig, window: str) -> Result[None, HarnessError]:
    return send_key(config, window, "Escape")


def send_vim_command(config: HarnessConfig, window: str, cmd: str) -> Result[None, HarnessError]:
    """Send a vim-style command (:cmd + Enter)."""
    send_key(config, window, ":")
    send_text(config, window, cmd)
    return send_enter(config, window)
