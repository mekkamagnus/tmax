"""Pure config detection and HarnessConfig construction."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from .types import HarnessConfig, Option, Some, Nothing


def detect_session() -> Option[str]:
    """Detect active tmux session. Works from child processes."""
    # Method 1: inside a tmux pane
    tmux_env = os.environ.get("TMUX")
    if tmux_env and shutil.which("tmux"):
        try:
            r = subprocess.run(
                ["tmux", "display-message", "-p", "#S"],
                capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0 and r.stdout.strip():
                return Some(r.stdout.strip())
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

    # Method 2: find attached session from tmux server
    if shutil.which("tmux"):
        try:
            r = subprocess.run(
                ["tmux", "list-sessions", "-F",
                 "#{?session_attached,#{session_name},}"],
                capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0:
                for line in r.stdout.strip().splitlines():
                    line = line.strip()
                    if line:
                        return Some(line)
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

    return Nothing


def detect_mode(session: Option[str]) -> str:
    """Choose test mode based on available session and tools.

    Modes:
      daemon       — daemon only, no tmux. Fast, reliable, for logic tests.
      daemon-tmux  — daemon + TUI in tmux. For TUI renderer tests.
      direct       — no daemon, no tmux. Fallback.
    """
    mode = os.environ.get("TMAX_UI_TEST_MODE", "auto")
    if mode != "auto":
        return mode
    # Default: daemon-only mode. No tmux needed for editor logic tests.
    if shutil.which("bun"):
        return "daemon"
    return "direct"


def load_config(overrides: dict | None = None) -> HarnessConfig:
    """Build a frozen HarnessConfig from env vars + detection."""
    overrides = overrides or {}

    session = detect_session()
    mode = overrides.get("mode_override", detect_mode(session))

    project_root = str(Path(__file__).resolve().parents[3])
    test_dir = overrides.get("test_dir", os.environ.get("TMAX_TEST_DIR", "/tmp/tmax-ui-tests"))

    uid = os.getuid()
    socket_path = f"/tmp/tmax-{uid}/server"

    bun_bin = shutil.which("bun") or "bun"
    client_cmd = overrides.get("client_cmd", os.environ.get("TMAX_CLIENT_CMD", str(Path(project_root) / "bin" / "tmaxclient")))
    daemon_cmd = overrides.get("daemon_cmd", os.environ.get("TMAX_DAEMON_CMD", f"{bun_bin} {project_root}/src/server/server.ts"))
    tui_cmd = overrides.get("tui_cmd", os.environ.get("TMAX_TUI_CMD", f"{bun_bin} {project_root}/src/client/tui-client.ts"))

    session_name = overrides.get("session_name",
        os.environ.get("TMAX_SESSION",
            session.unwrap_or("tmax-ui-tests")))
    test_window = overrides.get("test_window",
        os.environ.get("TMAX_TEST_WINDOW", "test-editor"))

    key_delay = float(overrides.get("key_delay", os.environ.get("TMAX_KEY_DELAY", "0.1")))
    operation_delay = float(overrides.get("operation_delay", os.environ.get("TMAX_OPERATION_DELAY", "0.5")))
    startup_wait = float(overrides.get("startup_wait", os.environ.get("TMAX_STARTUP_WAIT", "3")))
    default_timeout = int(overrides.get("default_timeout", os.environ.get("TMAX_DEFAULT_TIMEOUT", "10")))
    capture_lines = int(overrides.get("capture_lines", os.environ.get("TMAX_CAPTURE_LINES", "100")))

    # Ensure test dir exists
    Path(test_dir).mkdir(parents=True, exist_ok=True)

    return HarnessConfig(
        project_root=project_root,
        test_dir=test_dir,
        socket_path=socket_path,
        client_cmd=client_cmd,
        daemon_cmd=daemon_cmd,
        tui_cmd=tui_cmd,
        session_name=session_name,
        test_window=test_window,
        mode=mode,
        key_delay=key_delay,
        operation_delay=operation_delay,
        startup_wait=startup_wait,
        default_timeout=default_timeout,
        capture_lines=capture_lines,
    )
