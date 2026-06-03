"""Editor lifecycle functions — thread HarnessState through."""

from __future__ import annotations

import os
import json
import subprocess
import time
from dataclasses import replace

from .types import (
    HarnessConfig, HarnessState, HarnessError, Result, Ok, Err,
    Option, Some, Nothing,
)
from . import client
from . import queries
from . import session
from . import input as inp


def start_daemon(state: HarnessState) -> Result[HarnessState, HarnessError]:
    """Start the tmax daemon in background. Returns new state with daemon_pid."""
    if client.ping(state.config):
        return Ok(state)  # Already running

    daemon_parts = state.config.daemon_cmd.split()
    try:
        proc = subprocess.Popen(
            daemon_parts,
            cwd=state.config.project_root,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        return Err(HarnessError(
            f"Failed to start daemon: {daemon_parts[0]} not found",
        ))

    # Wait for daemon to respond to ping
    for _ in range(25):
        if client.ping(state.config):
            return Ok(replace(state, daemon_pid=Some(proc.pid)))
        time.sleep(0.2)

    return Err(HarnessError("Daemon failed to start within 5 seconds"))


def stop_daemon(state: HarnessState) -> Result[HarnessState, HarnessError]:
    """Stop the daemon. Returns new state with daemon_pid cleared."""
    if not client.ping(state.config):
        return Ok(replace(state, daemon_pid=Nothing))

    # Graceful shutdown via client
    client.eval_expr(state.config, "(editor-quit)")
    time.sleep(0.5)

    # Force kill if still running
    pid_opt = state.daemon_pid
    if isinstance(pid_opt, Some):
        try:
            os.kill(pid_opt.unwrap(), 9)
        except ProcessLookupError:
            pass
        time.sleep(0.3)

    # Clean up socket
    import pathlib
    socket = pathlib.Path(state.config.socket_path)
    if socket.is_socket():
        socket.unlink(missing_ok=True)

    return Ok(replace(state, daemon_pid=Nothing))


def daemon_is_running(state: HarnessState) -> bool:
    """Check if daemon is running."""
    return client.ping(state.config)


def start(state: HarnessState, file: str = "") -> Result[HarnessState, HarnessError]:
    """Start editor in configured mode. Returns new state."""
    if state.config.mode == "daemon":
        return _start_daemon_only(state, file)
    if state.config.mode == "daemon-tmux":
        return _start_daemon_tmux(state, file)
    if state.config.mode == "direct":
        return _start_direct(state, file)
    return _start_tmux(state, file)


def stop(state: HarnessState) -> Result[HarnessState, HarnessError]:
    """Stop the editor. Returns new state."""
    if state.config.mode in ("daemon", "daemon-tmux"):
        return _stop_daemon_tmux(state)
    if state.config.mode == "direct":
        return _stop_direct(state)
    return _stop_tmux(state)


def restart(state: HarnessState, file: str = "") -> Result[HarnessState, HarnessError]:
    """Stop and restart the editor."""
    stop_result = stop(state)
    current = stop_result.unwrap_or(state)
    time.sleep(1)
    return start(current, file)


# ---------------------------------------------------------------------------
# Mode-specific start/stop
# ---------------------------------------------------------------------------

def _wait_for_tui_content(config: HarnessConfig, window: str,
                           timeout: float = 10.0) -> Result[None, HarnessError]:
    """Poll tmux pane until TUI content appears (for legacy tmux mode)."""
    elapsed = 0.0
    interval = 0.3
    markers = ("NORMAL", "INSERT", "VISUAL", "~", "Lisp")

    while elapsed < timeout:
        output = queries.capture_output(config, window)
        if output.is_ok():
            text = output.unwrap()
            if any(m in text for m in markers):
                return Ok(None)
        time.sleep(interval)
        elapsed += interval

    return Err(HarnessError("Timeout waiting for TUI content in tmux pane"))


def _open_file_via_client(config: HarnessConfig, filepath: str) -> None:
    """Open a file via tmaxclient (uses JSON-RPC open, not eval)."""
    try:
        subprocess.run(
            [config.client_cmd, filepath],
            capture_output=True, text=True, timeout=5,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass


def _start_daemon_only(state: HarnessState, file: str) -> Result[HarnessState, HarnessError]:
    """daemon mode: start daemon + open file. No tmux, no TUI."""
    state_result = start_daemon(state)
    if state_result.is_err():
        return state_result
    state = state_result.unwrap()

    # Open file if specified
    if file:
        filepath = f"{state.config.project_root}/{file}"
        _open_file_via_client(state.config, filepath)

    return Ok(state)


def _wait_for_tui_ready(config: HarnessConfig, window: str,
                         timeout: float = 10.0) -> Result[None, HarnessError]:
    """Poll until daemon responds and the tmux pane is rendering the TUI."""
    elapsed = 0.0
    interval = 0.3
    tui_markers = ("NORMAL", "INSERT", "VISUAL", "~", "Lisp")
    last_command = "?"
    last_output = ""
    last_status: dict | None = None

    while elapsed < timeout:
        if not client.ping(config):
            time.sleep(interval)
            elapsed += interval
            continue

        status_result = client.status(config)
        if status_result.is_ok():
            last_status = status_result.unwrap()

        command_result = session.get_pane_command(config, window)
        if command_result.is_ok():
            last_command = command_result.unwrap()

        output = queries.capture_output(config, window)
        if output.is_ok():
            text = output.unwrap()
            last_output = text[-500:]
            has_tui_output = any(m in text for m in tui_markers)
            has_ready_frame = False
            if isinstance(last_status, dict):
                frames = last_status.get("frames", [])
                if isinstance(frames, list):
                    has_ready_frame = any(
                        isinstance(frame, dict)
                        and frame.get("clientType") == "tui"
                        and frame.get("ready") is True
                        and bool(frame.get("firstRenderAt"))
                        and frame.get("rawModeReady") is True
                        and int(frame.get("renderCount") or 0) >= 1
                        for frame in frames
                    )

            if last_command not in ("sh", "bash", "zsh", "fish") and has_ready_frame and has_tui_output:
                return Ok(None)

        time.sleep(interval)
        elapsed += interval

    detail = f"last pane command: {last_command}"
    if last_status is not None:
        detail = f"{detail}; status: {json.dumps(last_status, separators=(',', ':'))}"
    if last_output.strip():
        detail = f"{detail}; last output: {last_output.strip()}"
    return Err(HarnessError("Timeout waiting for TUI renderer", Some(detail)))


def _start_daemon_tmux(state: HarnessState, file: str) -> Result[HarnessState, HarnessError]:
    """daemon-tmux: start daemon + TUI client in tmux window."""
    # Start daemon
    state_result = start_daemon(state)
    if state_result.is_err():
        return state_result
    state = state_result.unwrap()

    # Open file if specified (use client CLI open, not eval)
    if file:
        filepath = f"{state.config.project_root}/{file}"
        _open_file_via_client(state.config, filepath)

    # Create test window and run the TUI as the pane command. This avoids
    # racing an interactive shell prompt with typed `cd` / launch commands.
    window_result = session.create_window_with_command(
        state.config,
        state.config.test_window,
        state.config.tui_cmd,
        state.config.project_root,
    )
    if window_result.is_err():
        return Err(HarnessError(
            "Failed to create test window",
            Some(window_result.unwrap_err().message),
        ))
    session.select_window(state.config, state.config.test_window)

    # Wait for TUI to start (or crash). After TUI crashes, its frame is
    # deleted on disconnect. Mode changes via eval won't be overwritten.
    ready_result = _wait_for_tui_ready(state.config, state.config.test_window)
    if ready_result.is_err():
        return Err(HarnessError(
            "TUI client failed to start",
            Some(ready_result.unwrap_err().message),
        ))

    # Get editor PID
    pid_result = session.get_pane_pid(state.config, state.config.test_window)

    return Ok(replace(
        state,
        editor_pid=pid_result.map(lambda p: Some(p)).unwrap_or(Nothing),
        active_window=Some(state.config.test_window),
    ))


def _start_direct(state: HarnessState, file: str) -> Result[HarnessState, HarnessError]:
    """direct mode: start editor process directly."""
    cmd = f"bun run src/main.tsx --dev"
    if file:
        cmd = f"{cmd} {file}"

    output_file = f"{state.config.test_dir}/direct-editor.log"
    status_file = f"{state.config.test_dir}/direct-editor.status"

    try:
        proc = subprocess.Popen(
            ["bash", "-lc", cmd],
            cwd=state.config.project_root,
            stdout=open(output_file, "w"),
            stderr=subprocess.STDOUT,
        )
    except FileNotFoundError:
        return Err(HarnessError("bash not found"))

    time.sleep(state.config.startup_wait)

    return Ok(replace(state, editor_pid=Some(proc.pid)))


def _start_tmux(state: HarnessState, file: str) -> Result[HarnessState, HarnessError]:
    """Legacy tmux mode: start editor directly in tmux window."""
    cmd = "bun run src/main.tsx --dev"
    if file:
        cmd = f"{cmd} {file}"

    window_result = session.create_window(state.config, state.config.test_window)
    if window_result.is_err():
        return Err(HarnessError(
            "Failed to create test window",
            Some(window_result.unwrap_err().message),
        ))
    session.select_window(state.config, state.config.test_window)

    inp.send_command(state.config, state.config.test_window, f"cd {state.config.project_root}")
    inp.send_command(state.config, state.config.test_window, cmd)

    # Wait for editor to render (check for NORMAL mode indicator in tmux pane)
    tui_ready = _wait_for_tui_content(state.config, state.config.test_window)
    if tui_ready.is_err():
        return Err(HarnessError(
            "Editor failed to start in tmux",
            Some(tui_ready.unwrap_err().message),
        ))

    pid_result = session.get_pane_pid(state.config, state.config.test_window)

    return Ok(replace(
        state,
        editor_pid=pid_result.map(lambda p: Some(p)).unwrap_or(Nothing),
        active_window=Some(state.config.test_window),
    ))


def _stop_daemon_tmux(state: HarnessState) -> Result[HarnessState, HarnessError]:
    """Stop daemon-tmux mode."""
    window = state.active_window.unwrap_or("")

    # Kill test window
    if window:
        session.kill_window(state.config, window)

    # Stop daemon
    return stop_daemon(replace(state, editor_pid=Nothing))


def _stop_direct(state: HarnessState) -> Result[HarnessState, HarnessError]:
    """Stop direct mode."""
    pid_opt = state.editor_pid
    if isinstance(pid_opt, Some):
        try:
            os.kill(pid_opt.unwrap(), 15)
        except ProcessLookupError:
            pass
    return Ok(replace(state, editor_pid=Nothing))


def _stop_tmux(state: HarnessState) -> Result[HarnessState, HarnessError]:
    """Stop legacy tmux mode."""
    window = state.active_window.unwrap_or("")
    if window:
        inp.send_vim_command(state.config, window, "q")
        time.sleep(1)
        session.kill_window(state.config, window)
    return Ok(replace(state, editor_pid=Nothing))
