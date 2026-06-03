"""Tmux session operations — all functions return Result."""

from __future__ import annotations

import subprocess
import time

from .types import HarnessConfig, HarnessError, Result, Ok, Err, Some


def _tmux(*args: str) -> Result[str, HarnessError]:
    """Run a tmux command, return Result of stdout."""
    try:
        proc = subprocess.run(
            ["tmux", *args], capture_output=True, text=True, timeout=10,
        )
        if proc.returncode != 0:
            return Err(HarnessError(
                f"tmux {' '.join(args)} failed",
            ))
        return Ok(proc.stdout.strip())
    except FileNotFoundError:
        return Err(HarnessError("tmux not found"))
    except subprocess.TimeoutExpired:
        return Err(HarnessError("tmux command timed out"))


def validate(config: HarnessConfig) -> Result[None, HarnessError]:
    """Validate tmux environment for the configured mode."""
    if config.mode == "direct":
        return Ok(None)

    # Check tmux installed
    import shutil
    if not shutil.which("tmux"):
        return Err(HarnessError("tmux is not installed"))

    # Check session exists
    result = _tmux("list-sessions")
    if result.is_err():
        return Err(HarnessError("No tmux sessions found"))

    sessions = result.unwrap().splitlines()
    session_names = [s.split(":")[0] for s in sessions]
    if config.session_name not in session_names:
        return Err(HarnessError(
            f"Session '{config.session_name}' not found. "
            f"Available: {session_names}",
        ))

    return Ok(None)


def _ensure_session(config: HarnessConfig) -> Result[None, HarnessError]:
    """Create the tmux session if it doesn't exist."""
    result = _tmux("list-sessions")
    if result.is_ok():
        names = [s.split(":")[0] for s in result.unwrap().splitlines()]
        if config.session_name in names:
            return Ok(None)

    # Create a detached session
    result = _tmux("new-session", "-d", "-s", config.session_name)
    if result.is_err():
        return Err(HarnessError(
            f"Failed to create session '{config.session_name}'",
            Some(result.unwrap_err().message),
        ))
    time.sleep(config.operation_delay)
    return Ok(None)


def create_window(config: HarnessConfig, name: str) -> Result[str, HarnessError]:
    """Create a tmux window. Returns window name."""
    # Ensure session exists first
    ensure = _ensure_session(config)
    if ensure.is_err():
        return Err(ensure.unwrap_err())

    # Check if window already exists
    existing = list_windows(config)
    if existing.is_ok() and name in existing.unwrap():
        return Ok(name)

    result = _tmux("new-window", "-a", "-t", config.session_name, "-n", name)
    if result.is_err():
        return Err(HarnessError(
            f"Failed to create window '{name}'",
            Some(result.unwrap_err().message),
        ))
    time.sleep(config.operation_delay)
    return Ok(name)


def create_window_with_command(
    config: HarnessConfig,
    name: str,
    command: str,
    cwd: str,
) -> Result[str, HarnessError]:
    """Create a fresh tmux window running command directly."""
    ensure = _ensure_session(config)
    if ensure.is_err():
        return Err(ensure.unwrap_err())

    kill_window(config, name)

    result = _tmux(
        "new-window",
        "-a",
        "-t",
        config.session_name,
        "-n",
        name,
        "-c",
        cwd,
        command,
    )
    if result.is_err():
        return Err(HarnessError(
            f"Failed to create window '{name}' with command",
            Some(result.unwrap_err().message),
        ))
    time.sleep(config.operation_delay)
    return Ok(name)


def kill_window(config: HarnessConfig, name: str) -> Result[None, HarnessError]:
    """Kill a tmux window by name. Non-fatal if it doesn't exist."""
    # Find the window index(es) for this name to avoid ambiguity
    result = _tmux("list-windows", "-t", config.session_name, "-F", "#{window_index}:#{window_name}")
    if result.is_err():
        return Ok(None)
    for line in result.unwrap().splitlines():
        parts = line.strip().split(":", 1)
        if len(parts) == 2 and parts[1] == name:
            _tmux("kill-window", "-t", f"{config.session_name}:{parts[0]}")
    time.sleep(config.operation_delay)
    return Ok(None)


def select_window(config: HarnessConfig, name: str) -> Result[None, HarnessError]:
    """Select (focus) a tmux window."""
    return _tmux("select-window", "-t", f"{config.session_name}:{name}").map(lambda _: None)


def list_windows(config: HarnessConfig) -> Result[list[str], HarnessError]:
    """List window names in the session."""
    result = _tmux("list-windows", "-t", config.session_name, "-F", "#{window_name}")
    if result.is_err():
        return result  # type: ignore[return-value]
    names = [n.strip() for n in result.unwrap().splitlines() if n.strip()]
    return Ok(names)


def get_pane_pid(config: HarnessConfig, window: str) -> Result[int, HarnessError]:
    """Get the PID of the main pane in a window."""
    result = _tmux("list-panes", "-t", f"{config.session_name}:{window}", "-F", "#{pane_pid}")
    if result.is_err():
        return Err(HarnessError(f"Failed to get pane PID for {window}"))
    lines = result.unwrap().splitlines()
    if not lines:
        return Err(HarnessError(f"No panes found for {window}"))
    try:
        return Ok(int(lines[0].strip()))
    except ValueError:
        return Err(HarnessError(f"Invalid PID: {lines[0]}"))


def get_pane_command(config: HarnessConfig, window: str) -> Result[str, HarnessError]:
    """Get the current command for the main pane in a window."""
    result = _tmux("list-panes", "-t", f"{config.session_name}:{window}", "-F", "#{pane_current_command}")
    if result.is_err():
        return Err(HarnessError(f"Failed to get pane command for {window}"))
    lines = [line.strip() for line in result.unwrap().splitlines() if line.strip()]
    if not lines:
        return Err(HarnessError(f"No panes found for {window}"))
    return Ok(lines[0])


def cleanup(config: HarnessConfig) -> Result[None, HarnessError]:
    """Kill all test-editor windows in the session."""
    existing = list_windows(config)
    if existing.is_err():
        return Ok(None)

    for name in existing.unwrap():
        if name == config.test_window:
            kill_window(config, name)

    return Ok(None)
