"""State-threading harness API composing all modules."""

from __future__ import annotations

from dataclasses import replace

from .types import (
    HarnessConfig, HarnessState, HarnessError,
    Result, Ok, Err, Option, Some, Nothing,
)
from . import config as cfg
from . import client
from . import editor
from . import session
from . import queries


def _is_daemon(config: HarnessConfig) -> bool:
    return config.mode.startswith("daemon")


def init(overrides: dict | None = None) -> Result[HarnessState, HarnessError]:
    """Initialize harness: detect config, validate environment."""
    config = cfg.load_config(overrides)

    # Validate tmux only for tmux-dependent modes
    if config.mode == "daemon-tmux":
        v = session.validate(config)
        if v.is_err():
            return Err(v.unwrap_err())

    return Ok(HarnessState(config=config))


def start(state: HarnessState, file: str = "") -> Result[HarnessState, HarnessError]:
    """Start editor. Returns new state with pids/window set."""
    return editor.start(state, file)


def stop(state: HarnessState) -> Result[HarnessState, HarnessError]:
    """Stop editor. Returns new state with pids cleared."""
    return editor.stop(state)


def cleanup(state: HarnessState) -> Result[HarnessState, HarnessError]:
    """Clean up test window and daemon."""
    current = editor.stop(state).unwrap_or(state)

    if current.config.mode == "daemon-tmux":
        session.cleanup(current.config)

    return Ok(replace(current, editor_pid=Nothing, active_window=Nothing))


def get_mode(state: HarnessState) -> Result[str, HarnessError]:
    """Query current editor mode."""
    if _is_daemon(state.config):
        return client.get_mode(state.config)
    window = state.active_window.unwrap_or("")
    if not window:
        return Err(HarnessError("No active window"))
    result = queries.capture_output(state.config, window)
    if result.is_err():
        return Err(HarnessError("Failed to capture output"))
    output = result.unwrap()
    for mode in ("INSERT", "VISUAL", "COMMAND", "M-X", "NORMAL"):
        if mode in output:
            return Ok(mode)
    return Ok("UNKNOWN")


def get_text(state: HarnessState) -> Result[str, HarnessError]:
    """Query buffer text."""
    if _is_daemon(state.config):
        return client.get_buffer_text(state.config)
    window = state.active_window.unwrap_or("")
    return queries.capture_output(state.config, window)


def is_running(state: HarnessState) -> bool:
    """Check if editor/daemon is running."""
    if _is_daemon(state.config):
        return client.ping(state.config)
    pid_opt = state.editor_pid
    if isinstance(pid_opt, Some):
        import os
        try:
            os.kill(pid_opt.unwrap(), 0)
            return True
        except ProcessLookupError:
            return False
    return False
