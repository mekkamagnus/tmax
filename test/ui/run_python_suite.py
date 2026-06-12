#!/usr/bin/env python3
"""Functional suite runner — executes Python UI tests with cleanup between each."""

import os
import sys
import subprocess
import shutil
import time
import uuid

ROOT = os.path.dirname(os.path.abspath(__file__))
TESTS_DIR = os.path.join(ROOT, "tests")

# Daemon-only workflow tests
DAEMON_TESTS = [
    "01_startup.py",
    "02_basic_editing.py",
    "03_mode_switching.py",
    "05_command_mode.py",
    "06_navigation.py",
    "07_visual_mode.py",
    "08_buffers_files.py",
    "09_undo_yank_delete.py",
    "11_search_replace.py",
    "12_daily_drivers.py",
    "13_modes.py",
    "17_count_prefix.py",
    "18_text_objects.py",
    "19_yank_ring.py",
    "20_macro_recording.py",
    "21_window_splitting.py",
    "22_config_loading.py",
    "23_indentation.py",
    "24_module_loading.py",
]

# Daemon-tmux renderer tests
DAEMON_TMUX_TESTS = [
    "04_daemon_tmux_observability.py",
    "10_renderer_layout.py",
    "14_vim_input.py",
    "15_daily_driver_rendering.py",
    "16_buffer_completion.py",
]


def cleanup_run(run_id: str) -> None:
    """Clean only resources carrying this runner-generated test id."""
    socket_path = os.path.join("/tmp/tmax-ui-tests", run_id, "server")
    client_cmd = os.path.join(os.path.dirname(os.path.dirname(ROOT)), "bin", "tmaxclient")
    try:
        subprocess.run(
            [client_cmd, "--socket", socket_path, "--eval", "(editor-quit)"],
            capture_output=True, text=True, timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    # Wait for daemon to fully stop responding
    for _ in range(15):  # up to 3 seconds
        try:
            result = subprocess.run(
                [client_cmd, "--socket", socket_path, "--eval", "(+ 1 1)"],
                capture_output=True, text=True, timeout=2,
            )
            if result.returncode != 0:
                break
        except (FileNotFoundError, subprocess.TimeoutExpired, ConnectionRefusedError, OSError):
            break
        time.sleep(0.2)
    try:
        subprocess.run(
            ["tmux", "kill-session", "-t", f"tmax-ui-{run_id}"],
            capture_output=True, text=True, timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    shutil.rmtree(os.path.join("/tmp/tmax-ui-tests", run_id), ignore_errors=True)


def run_test(filepath: str, env: dict | None = None) -> tuple[bool, str]:
    """Run a single test file. Returns (passed, output)."""
    run_env = os.environ.copy()
    run_id = f"{os.getpid()}-{uuid.uuid4().hex[:10]}"
    run_root = os.path.join("/tmp/tmax-ui-tests", run_id)
    run_env["TMAX_UI_RUN_ID"] = run_id
    run_env["HOME"] = os.path.join(run_root, "home")
    run_env["TMAX_WORKSPACE_DIR"] = os.path.join(run_root, "home", ".config", "tmax", "workspaces")
    if env:
        run_env.update(env)
    os.makedirs(run_env["HOME"], exist_ok=True)

    # Clear cached Python modules between tests
    cache_dir = os.path.join(ROOT, "tmax_harness", "__pycache__")
    if os.path.isdir(cache_dir):
        import shutil
        shutil.rmtree(cache_dir, ignore_errors=True)

    try:
        proc = subprocess.run(
            [sys.executable, filepath],
            capture_output=True, text=True, timeout=120,
            cwd=ROOT,
            env=run_env,
        )
        output = proc.stdout
        if proc.stderr:
            output += "\n" + proc.stderr
        return proc.returncode == 0, output
    except subprocess.TimeoutExpired:
        return False, "TIMEOUT after 120s"
    finally:
        cleanup_run(run_id)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    run_daemon = mode in ("all", "daemon")
    run_tmux = mode in ("all", "daemon-tmux")

    total = 0
    passed = 0
    failed_tests: list[str] = []

    if run_daemon:
        print("\n=== Daemon Mode Tests ===\n")
        for name in DAEMON_TESTS:
            path = os.path.join(TESTS_DIR, name)
            if not os.path.isfile(path):
                print(f"  SKIP {name} (not found)")
                continue
            total += 1
            ok, output = run_test(path)
            if ok:
                passed += 1
                print(f"  PASS {name}")
            else:
                failed_tests.append(name)
                print(f"  FAIL {name}")
                # Show last 5 lines of output for context
                lines = output.strip().splitlines()
                for line in lines[-5:]:
                    print(f"       {line}")

    if run_tmux:
        print("\n=== Daemon-Tmux Mode Tests ===\n")
        for name in DAEMON_TMUX_TESTS:
            path = os.path.join(TESTS_DIR, name)
            if not os.path.isfile(path):
                print(f"  SKIP {name} (not found)")
                continue
            total += 1
            env = {"TMAX_UI_TEST_MODE": "daemon-tmux"}
            ok, output = run_test(path, env)
            if ok:
                passed += 1
                print(f"  PASS {name}")
            else:
                failed_tests.append(name)
                print(f"  FAIL {name}")
                lines = output.strip().splitlines()
                for line in lines[-5:]:
                    print(f"       {line}")

    print(f"\n{'='*40}")
    print(f"Total: {total}  Passed: {passed}  Failed: {len(failed_tests)}")
    if failed_tests:
        print(f"Failed: {', '.join(failed_tests)}")
    print(f"{'='*40}")

    sys.exit(1 if failed_tests else 0)


if __name__ == "__main__":
    main()
