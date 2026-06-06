"""Pure tmaxclient wrapper — every function returns Result."""

from __future__ import annotations

import json
import subprocess
from typing import Any, Tuple

from .types import (
    HarnessConfig, HarnessError, Result, Ok, Err,
    Option, Some, Nothing, parse_value,
)


def _run_client(config: HarnessConfig, *args: str) -> Result[str, HarnessError]:
    """Run tmaxclient with given args, return Result of stdout."""
    cmd = [config.client_cmd, "--socket", config.socket_path, *args]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=10,
        )
        if proc.returncode != 0:
            stderr = proc.stderr.strip() if proc.stderr else ""
            return Err(HarnessError(
                f"tmaxclient exited {proc.returncode}",
                Some(stderr) if stderr else Nothing,
            ))
        return Ok(proc.stdout.rstrip("\r\n"))
    except FileNotFoundError:
        return Err(HarnessError(
            f"tmaxclient not found: {config.client_cmd}",
        ))
    except subprocess.TimeoutExpired:
        return Err(HarnessError("tmaxclient timed out"))


def eval_expr(config: HarnessConfig, expr: str) -> Result[str, HarnessError]:
    """Evaluate a T-Lisp expression via the daemon."""
    return _run_client(config, "--eval", expr)


def ping(config: HarnessConfig) -> bool:
    """Check if the daemon is reachable."""
    try:
        proc = subprocess.run(
            [config.client_cmd, "--socket", config.socket_path, "--ping"],
            capture_output=True, text=True, timeout=5,
        )
        return proc.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def get_mode(config: HarnessConfig) -> Result[str, HarnessError]:
    """Get editor mode via daemon. Returns uppercase mode string."""
    result = eval_expr(config, "(editor-mode)")
    if result.is_err():
        return result  # type: ignore[return-value]
    raw = result.unwrap()
    if not raw:
        return Err(HarnessError("Empty mode response"))
    mode = raw.strip().strip('"').upper()
    return Ok(mode)


def get_buffer_text(config: HarnessConfig) -> Result[str, HarnessError]:
    """Get buffer text via daemon."""
    return eval_expr(config, "(buffer-text)")


def get_cursor_position(config: HarnessConfig) -> Result[Tuple[int, int], HarnessError]:
    """Get cursor [line, col] via daemon."""
    result = eval_expr(config, "(cursor-position)")
    if result.is_err():
        return result  # type: ignore[return-value]
    val = parse_value(result.unwrap())
    if isinstance(val, list) and len(val) == 2:
        return Ok((int(val[0]), int(val[1])))
    return Err(HarnessError(
        f"Unexpected cursor position: {result.unwrap()}",
    ))


def get_buffer_name(config: HarnessConfig) -> Result[str, HarnessError]:
    """Get current buffer name via daemon."""
    return eval_expr(config, "(buffer-current)")


def get_buffer_list(config: HarnessConfig) -> Result[list[str], HarnessError]:
    """Get list of buffer names via daemon."""
    result = eval_expr(config, "(buffer-list)")
    if result.is_err():
        return result  # type: ignore[return-value]
    val = parse_value(result.unwrap())
    if isinstance(val, list):
        return Ok([str(v) for v in val])
    return Ok([str(val)] if val is not None else [])


def buffer_contains(config: HarnessConfig, pattern: str) -> Result[bool, HarnessError]:
    """Check if buffer text contains pattern."""
    result = get_buffer_text(config)
    if result.is_err():
        return result  # type: ignore[return-value]
    return Ok(pattern in result.unwrap())


def status(config: HarnessConfig) -> Result[dict[str, Any], HarnessError]:
    """Get structured daemon status."""
    result = _run_client(config, "--status", "--json")
    if result.is_err():
        return result  # type: ignore[return-value]
    try:
        parsed = json.loads(result.unwrap())
    except json.JSONDecodeError as e:
        return Err(HarnessError(
            "Failed to parse daemon status JSON",
            Some(str(e)),
        ))
    if isinstance(parsed, dict):
        return Ok(parsed)
    return Err(HarnessError("Daemon status response was not an object"))


def clients(config: HarnessConfig) -> Result[list[dict[str, Any]], HarnessError]:
    """Get connected daemon clients."""
    result = _run_client(config, "--clients", "--json")
    if result.is_err():
        return result  # type: ignore[return-value]
    try:
        parsed = json.loads(result.unwrap())
    except json.JSONDecodeError as e:
        return Err(HarnessError(
            "Failed to parse daemon clients JSON",
            Some(str(e)),
        ))
    if isinstance(parsed, list):
        return Ok([item for item in parsed if isinstance(item, dict)])
    return Err(HarnessError("Daemon clients response was not a list"))


def frames(config: HarnessConfig) -> Result[list[dict[str, Any]], HarnessError]:
    """Get connected daemon frames."""
    result = _run_client(config, "--frames", "--json")
    if result.is_err():
        return result  # type: ignore[return-value]
    try:
        parsed = json.loads(result.unwrap())
    except json.JSONDecodeError as e:
        return Err(HarnessError(
            "Failed to parse daemon frames JSON",
            Some(str(e)),
        ))
    if isinstance(parsed, list):
        return Ok([item for item in parsed if isinstance(item, dict)])
    return Err(HarnessError("Daemon frames response was not a list"))


def send_key(config: HarnessConfig, key: str) -> Result[dict[str, Any], HarnessError]:
    """Send a single keypress via tmaxclient --key. Returns parsed JSON state."""
    result = _run_client(config, "--key", key)
    if result.is_err():
        return result  # type: ignore[return-value]
    try:
        parsed = json.loads(result.unwrap())
    except json.JSONDecodeError:
        # Non-JSON response is fine (e.g. just a string), return minimal state
        return Ok({"raw": result.unwrap()})
    if isinstance(parsed, dict):
        return Ok(parsed)
    return Ok({"raw": result.unwrap()})


def stop_daemon(config: HarnessConfig) -> Result[str, HarnessError]:
    """Stop the daemon via the shutdown RPC method."""
    return _run_client(config, "--stop")
