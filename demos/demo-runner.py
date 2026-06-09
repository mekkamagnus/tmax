#!/usr/bin/env python3
"""demo-runner.py — Execute tmax demo playbooks.

Reads a YAML playbook, ensures the daemon and TUI frame are running,
and executes each step with visual pacing so the user can watch the
demo unfold in their tmux session.

Usage:
    python3 demos/demo-runner.py demos/messages.yaml
    python3 demos/demo-runner.py demos/editing.yaml --speed 2
    python3 demos/demo-runner.py demos/tlisp.yaml --dry-run
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile
import time
import yaml

SESSION = "tmax"
DAEMON_WINDOW = "tmax-daemon"
TUI_WINDOW = "tui"


def resolve_project_dir():
    """Resolve project root from this script's location (demos/)."""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def run_cmd(cmd, timeout=10):
    """Run a command, return (stdout, returncode)."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout.strip(), result.returncode
    except subprocess.TimeoutExpired:
        return "", 1


# ── Daemon lifecycle ──────────────────────────────────────────────────


def is_daemon_running(client):
    out, rc = run_cmd(f"{client} --ping")
    return rc == 0


def ensure_daemon(project_dir, force_restart=False):
    """Start the tmax daemon in tmux if not already running."""
    client = os.path.join(project_dir, "bin", "tmaxclient")

    if force_restart and is_daemon_running(client):
        print("  Stopping existing daemon for fresh start...")
        run_cmd(f"{client} --stop")
        time.sleep(1)

    if is_daemon_running(client):
        print("✓ Daemon already running")
        return True

    # Verify tmux session exists.
    out, rc = run_cmd(f"tmux has-session -t {SESSION} 2>/dev/null")
    if rc != 0:
        print(f"FAIL: tmux session '{SESSION}' not found. Create it first: tmux new -s tmax", file=sys.stderr)
        return False

    # Ensure daemon window exists.
    out, _ = run_cmd(f"tmux list-windows -t {SESSION} -F '#{{window_name}}' 2>/dev/null")
    if DAEMON_WINDOW not in out.splitlines():
        run_cmd(f"tmux new-window -t {SESSION} -n {DAEMON_WINDOW} -c {project_dir}")

    # Respawn pane with fresh daemon process.
    run_cmd(
        f'tmux respawn-pane -t {SESSION}:{DAEMON_WINDOW} -k '
        f'"cd {project_dir} && bun src/server/server.ts" 2>/dev/null'
    )

    # Wait for daemon to accept connections (up to 10 seconds).
    for _ in range(20):
        if is_daemon_running(client):
            print("✓ Daemon started")
            return True
        time.sleep(0.5)

    print("FAIL: Daemon did not start within 10 seconds", file=sys.stderr)
    return False


# ── TUI lifecycle ─────────────────────────────────────────────────────


def has_tui_frame(client):
    """Check if a TUI frame is connected to the daemon."""
    out, rc = run_cmd(f"{client} --frames")
    if rc != 0 or not out:
        return False
    # --frames outputs "No connected frames" when none exist.
    # A connected frame shows JSON with "frame-" prefix entries.
    out_lower = out.lower()
    if "no connected" in out_lower:
        return False
    return "frame-" in out_lower or "[" in out


def ensure_tui(project_dir, no_tui=False):
    """Ensure a TUI frame is connected. Start TUI client if needed."""
    if no_tui:
        print("  (skipping TUI — text-only mode)")
        return True

    client = os.path.join(project_dir, "bin", "tmaxclient")

    if has_tui_frame(client):
        print("✓ TUI frame already connected")
        return True

    # Ensure tui window exists.
    out, _ = run_cmd(f"tmux list-windows -t {SESSION} -F '#{{window_name}}' 2>/dev/null")
    if TUI_WINDOW not in out.splitlines():
        run_cmd(f"tmux new-window -t {SESSION} -n {TUI_WINDOW} -c {project_dir}")

    # Start TUI client.
    run_cmd(
        f'tmux respawn-pane -t {SESSION}:{TUI_WINDOW} -k '
        f'"cd {project_dir} && bun src/client/tui-client.ts" 2>/dev/null'
    )

    # Wait for frame to register (up to 10 seconds).
    for _ in range(20):
        if has_tui_frame(client):
            print("✓ TUI frame connected")
            return True
        time.sleep(0.5)

    print("WARN: TUI frame did not appear within 10 seconds", file=sys.stderr)
    return False


# ── Variable templating ───────────────────────────────────────────────


def template(text, variables):
    """Replace ${VAR} placeholders in text from variables dict."""
    if not isinstance(text, str):
        return text
    for key, val in variables.items():
        text = text.replace(f"${{{key}}}", str(val))
    return text


# ── Step execution ────────────────────────────────────────────────────


def execute_step(step, client, variables, speed, dry_run=False):
    """Execute a single playbook step. Returns True on success."""
    action = step.get("action")
    narrate = step.get("narrate")
    pause_duration = step.get("pause", 0.5) * speed
    expect_error = step.get("expect_error", False)
    section = step.get("section")

    # Print section header if present.
    if section:
        print(f"\n── {section} ──")

    # Print narration.
    if narrate:
        print(f"  → {narrate}")

    if dry_run:
        print(f"    [dry-run] action={action}")
        return True

    # Dispatch on action type.
    error_occurred = False

    if action == "setup_file":
        name = template(step["name"], variables)
        content = template(step.get("content", ""), variables)
        path = f"/tmp/tmax-demo-{name}"
        with open(path, "w") as f:
            f.write(content)
        var_name = step.get("var")
        if var_name:
            variables[var_name] = path
        print(f"    created: {path}")

    elif action == "open":
        filepath = template(step["file"], variables)
        out, rc = run_cmd(f"{client} {filepath}")
        if rc != 0:
            error_occurred = True
            if not expect_error:
                print(f"    error: {out}")

    elif action == "eval":
        expr = template(step["expr"], variables)
        # Use single quotes to protect T-Lisp expressions from shell expansion.
        # Escape any single quotes within the expression.
        escaped = expr.replace("'", "'\\''")
        out, rc = run_cmd(f"{client} --eval '{escaped}'")
        if rc != 0:
            error_occurred = True
            if not expect_error:
                print(f"    error: {out}")
        else:
            # Print result for visibility (first line only).
            first_line = out.split("\n")[0] if out else ""
            if first_line:
                print(f"    → {first_line}")

    elif action == "key":
        key = template(step["key"], variables)
        out, rc = run_cmd(f"{client} --key {subprocess.list2cmdline([key])}")
        if rc != 0:
            error_occurred = True

    elif action == "keys":
        sequence = template(step["keys"], variables)
        out, rc = run_cmd(f"{client} --keys {subprocess.list2cmdline([sequence])}")
        if rc != 0:
            error_occurred = True

    elif action == "insert":
        text = template(step["text"], variables)
        out, rc = run_cmd(f"{client} --insert {subprocess.list2cmdline([text])}")
        if rc != 0:
            error_occurred = True

    elif action == "command":
        name = template(step["name"], variables)
        out, rc = run_cmd(f"{client} --command {subprocess.list2cmdline([name])}")
        if rc != 0:
            error_occurred = True

    elif action == "capture":
        out, rc = run_cmd(f"{client} --capture", timeout=5)
        if rc == 0 and out:
            for line in out.splitlines()[:5]:
                print(f"    {line}")
            if len(out.splitlines()) > 5:
                print(f"    ... ({len(out.splitlines())} lines total)")

    elif action == "pause":
        pause_duration = step.get("duration", 1.0) * speed

    elif action == "cleanup":
        for path in variables.values():
            if isinstance(path, str) and path.startswith("/tmp/tmax-demo-"):
                try:
                    os.remove(path)
                except OSError:
                    pass
        print("    cleaned up temp files")

    else:
        print(f"    WARN: unknown action '{action}'", file=sys.stderr)

    # Handle expected vs unexpected errors.
    if error_occurred and expect_error:
        print("    (expected error)")
    elif error_occurred and not expect_error:
        return False

    # Pause after the action for visual pacing.
    # Enforce minimum 0.1s between commands to avoid overwhelming the daemon.
    time.sleep(max(pause_duration, 0.1))

    return True


# ── Main ──────────────────────────────────────────────────────────────


def run_playbook(playbook_path, speed=1.0, no_tui=False, dry_run=False, verify=False):
    """Load and execute a playbook."""
    with open(playbook_path) as f:
        playbook = yaml.safe_load(f)

    name = playbook.get("name", os.path.basename(playbook_path))
    description = playbook.get("description", "")
    global_speed = playbook.get("speed", 1.0)
    speed *= global_speed
    verify_highlight = verify or playbook.get("verify_highlight", False)

    print(f"━━━ tmax Demo: {name} ━━━")
    if description:
        print(f"  {description}")
    print()

    project_dir = resolve_project_dir()
    client = os.path.join(project_dir, "bin", "tmaxclient")

    if not dry_run:
        # Force daemon restart in speed-0 or verify mode to pick up code changes.
        force_restart = speed == 0 or verify
        if not ensure_daemon(project_dir, force_restart=force_restart):
            return False
        if not ensure_tui(project_dir, no_tui=no_tui):
            print("  (continuing without TUI frame)")

    variables = {}

    # Run setup steps.
    for step in playbook.get("setup", []):
        if not execute_step(step, client, variables, speed, dry_run):
            print(f"FAIL: setup step failed", file=sys.stderr)
            return False

    # Run main steps.
    for step in playbook.get("steps", []):
        if not execute_step(step, client, variables, speed, dry_run):
            step_desc = step.get("narrate") or step.get("action", "?")
            print(f"FAIL: step failed: {step_desc}", file=sys.stderr)
            return False

    # Cleanup.
    if playbook.get("cleanup", False):
        cleanup_step = {"action": "cleanup"}
        execute_step(cleanup_step, client, variables, speed, dry_run)

    # Verify syntax highlighting if requested.
    if verify_highlight and not dry_run:
        out, rc = run_cmd(f"{client} --capture", timeout=5)
        if rc != 0 or not out:
            print("FAIL: Could not capture screen for verify", file=sys.stderr)
            return False
        has_24bit = "\x1b[38;2;" in out or "\x1b[48;2;" in out
        if not has_24bit:
            print("FAIL: No syntax highlighting detected in rendered output", file=sys.stderr)
            return False
        print("✓ Syntax highlighting verified in rendered output")

    print("\n━━━ Demo complete ━━━")
    return True


def main():
    parser = argparse.ArgumentParser(description="Run a tmax demo playbook")
    parser.add_argument("playbook", help="Path to YAML playbook file")
    parser.add_argument("--speed", type=float, default=1.0, help="Speed multiplier for pauses (default: 1.0)")
    parser.add_argument("--no-tui", action="store_true", help="Skip TUI frame startup (text-only mode)")
    parser.add_argument("--dry-run", action="store_true", help="Print steps without executing")
    parser.add_argument("--verify", action="store_true", help="Verify ANSI highlighting in rendered output after demo")
    args = parser.parse_args()

    if not os.path.exists(args.playbook):
        print(f"FAIL: playbook not found: {args.playbook}", file=sys.stderr)
        sys.exit(1)

    success = run_playbook(args.playbook, speed=args.speed, no_tui=args.no_tui, dry_run=args.dry_run, verify=args.verify)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
