"""Key sending functions — drive editor through tmaxclient --key (agent-as-user)."""

from __future__ import annotations

import time

from .types import HarnessConfig, HarnessError, Result, Ok, Err
from . import client


def translate_key_for_daemon(key: str) -> str:
    """Map harness key notation to the raw character tmaxclient --key expects."""
    mapping = {
        "Escape": "\x1b",
        "Enter": "\r",
        "Space": " ",
        "Backspace": "\x7f",
        "Tab": "\t",
        "BSpace": "\x7f",
        "C-[": "\x1b",
        "C-m": "\r",
        "C-f": "\x06",
        "C-b": "\x02",
        "C-d": "\x04",
        "C-u": "\x15",
        "C-r": "\x12",
        "C-g": "\x07",
        "C-n": "\x0e",
        "C-p": "\x10",
        "C-w": "\x17",
        "C-v": "\x16",
        "C-x": "\x18",
        "Up": "\x1b[A",
        "Down": "\x1b[B",
        "Left": "\x1b[D",
        "Right": "\x1b[C",
        "PageUp": "\x1b[5~",
        "PageDown": "\x1b[6~",
    }
    return mapping.get(key, key)


def send_key(config: HarnessConfig, key: str) -> Result[None, HarnessError]:
    """Send a single key to the editor via daemon --key."""
    translated = translate_key_for_daemon(key)
    result = client.send_key(config, translated)
    if result.is_err():
        return Err(result.unwrap_err())
    time.sleep(config.key_delay)
    return Ok(None)


def send_keys(config: HarnessConfig, *keys: str) -> Result[None, HarnessError]:
    """Send multiple keys in sequence."""
    for key in keys:
        r = send_key(config, key)
        if r.is_err():
            return r
    return Ok(None)


def send_text(config: HarnessConfig, text: str) -> Result[None, HarnessError]:
    """Send text character by character."""
    for ch in text:
        r = send_key(config, ch)
        if r.is_err():
            return r
    return Ok(None)


def send_enter(config: HarnessConfig) -> Result[None, HarnessError]:
    return send_key(config, "Enter")


def send_escape(config: HarnessConfig) -> Result[None, HarnessError]:
    return send_key(config, "Escape")


def send_vim_command(config: HarnessConfig, cmd: str) -> Result[None, HarnessError]:
    """Send a vim-style command (:cmd + Enter)."""
    send_key(config, ":")
    send_text(config, cmd)
    return send_enter(config)
