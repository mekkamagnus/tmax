# Chore: Harden Daemon Start/Stop Workflow

## Chore Description

The daemon start/stop lifecycle has four bugs that cause silent failures, and the UI test harness uses `tmux send-keys` instead of driving the editor as a user would through `tmaxclient --key`:

1. **`--stop` does not actually stop the daemon.** It sends `(editor-quit)` via `--eval`, which returns `EDITOR_QUIT_SIGNAL` as a Left from the T-Lisp evaluator. But `handleEval()` in `server.ts` does NOT catch this signal — it treats it as a normal evaluation error, returns a JSON-RPC error response, and the server keeps running. The fallback `rm -f "$SOCKET"` only removes the socket file, not the process.

2. **`--daemon` does not ensure project-root cwd.** The `ensure_daemon()` function in `bin/tmax` now cds correctly, but the `--daemon` direct path (`exec bun "$DAEMON"`) does NOT cd first. If launched from any other directory, relative binding paths like `src/tlisp/core/bindings/*.tlisp` fail to load and the daemon falls back to minimal bindings with no real key handling.

3. **Daemon startup errors are swallowed.** Both `ensure_daemon()` and `--daemon` redirect stderr to `/dev/null`. If the daemon crashes during startup (e.g., binding load failures, port conflicts), the caller sees "Daemon started" via `wait_for_daemon` ping success, but the daemon is running in a degraded state.

4. **No harness-friendly `--key` quit path for TUI client.** The harness (Claude/tmax-pilot) needs to be able to send `--key q` to exit the TUI client through the daemon, the same way a human would press `q` in normal mode. Currently the quit signal only flows through the TUI client's own stdin → keypress → frame path. When `tmaxclient --key q` sends a keypress without a frameId, the daemon processes it but the TUI client never sees the `quitSignal`.

5. **UI test harness uses `tmux send-keys` instead of `--key`.** Per the PRD (US-0.8.3 AI Agent Control), agents should test the client as a user — sending keys through the daemon's JSON-RPC protocol, not injecting keystrokes into tmux panes. The harness should use `tmaxclient --key` to drive the editor, making it a true agent-as-user test. This means the harness no longer needs tmux for key input, only for TUI rendering verification.

## Relevant Files

- `bin/tmax` — Bash launcher. Contains `ensure_daemon()`, `--stop`, `--daemon` paths. All cwd/stop bugs originate here.
- `src/server/server.ts` — JSON-RPC server. `handleEval()` does not handle `EDITOR_QUIT_SIGNAL`. Needs a dedicated `shutdown` method exposed via JSON-RPC so `--stop` works reliably. `handleKeypress` without frameId needs to sync all frames and propagate `quitSignal` to frame owners.
- `bin/tmaxclient` — Client CLI. Needs `--stop` flag that calls `shutdown` JSON-RPC method. `--key` responses need to include `quitSignal` when applicable.
- `src/editor/api/bindings-ops.ts` — `editor-quit` returns `Either.left({message: 'EDITOR_QUIT_SIGNAL'})`. This is fine for the TUI keypress path (where `handleKey` catches it), but broken for the `eval` RPC path.
- `test/ui/tmax_harness/input.py` — **REWRITE**. Currently sends keys via `tmux send-keys`. Must be rewritten to use `tmaxclient --key` via JSON-RPC. Remove all tmux key-sending functions. Add key translation from harness notation to `tmaxclient --key` notation (e.g., `"Escape"` → `\x1b`, `"Enter"` → `\r`, `"Space"` → `" "`).
- `test/ui/tmax_harness/client.py` — Already wraps `tmaxclient` for queries. Add `send_key()` function that calls `tmaxclient --key <key>` and returns the response state.
- `test/ui/tmax_harness/editor.py` — `stop_daemon()` currently uses `eval_expr("(editor-quit)")` which is broken. Update to use the new `--stop` path. `_stop_tmux()` uses `send_vim_command` which goes through tmux — update to use `--key`.
- `test/ui/tmax_harness/session.py` — Still needed for `daemon-tmux` mode (creating/killing tmux windows for TUI rendering verification), but no longer used for key input.
- `test/ui/tmax_harness/config.py` — Config unchanged, but `key_delay` now applies to `--key` round-trip time instead of tmux send-keys delay.

### New Files

- `.claude/skills/tmax-daemon/scripts/start_daemon.py` — Deterministic daemon starter using `uv run python`. Checks cwd, verifies project root, starts daemon, waits for socket, validates health (ping + status + binding load check), returns structured result.
- `.claude/skills/tmax-daemon/scripts/stop_daemon.py` — Deterministic daemon stopper. Calls `shutdown` RPC method, waits for socket removal, falls back to SIGTERM, validates process is gone, returns structured result.
- `.claude/skills/tmax-daemon/SKILL.md` — Skill definition for the daemon lifecycle management.

## Step by Step Tasks

### Add a `shutdown` JSON-RPC method to server.ts

- Add `case 'shutdown'` to the `processRequest` switch that calls `this.shutdown()` and returns `{ success: true }`.
- This gives a clean, dedicated RPC method for stopping the daemon — no T-Lisp evaluation, no error-path abuse.

### Fix `handleEval` to propagate EDITOR_QUIT_SIGNAL

- In `handleEval()`, when the T-Lisp result is Left with message `EDITOR_QUIT_SIGNAL`, catch it and call `this.shutdown()`.
- Return `{ quitSignal: true }` so callers (like `--key` via eval) can detect it.

### Add `--stop` flag to `bin/tmaxclient`

- Add `--stop` flag that sends `{ method: 'shutdown' }` via JSON-RPC.
- Print "Daemon stopped" on success, "Daemon not running" on connection failure.
- Exit 0 on success, exit 1 if not running.

### Fix `--stop` in `bin/tmax` to use the client's `--stop`

- Replace `"$CLIENT" --eval '(editor-quit)'` with `"$CLIENT" --stop`.
- After stop, verify with `is_running`. If still alive after 2 seconds, find PID from socket and SIGTERM it.
- Print clear status messages: "Stopping daemon...", "Daemon stopped", "Daemon not running", "Warning: daemon did not stop, sending SIGTERM".

### Fix `--daemon` direct path to cd to project root

- Change `exec bun "$DAEMON"` to use a subshell with cd: `cd "$PROJECT_DIR" && exec bun "$DAEMON"`.

### Make `handleKeypress` propagate quitSignal to all frame owners

- When `handleKeypress` catches `EDITOR_QUIT_SIGNAL` without a frameId, call `this.syncEditorToAllFrames()` before returning the `{ quitSignal: true }` response.
- This ensures that when `tmaxclient --key q` triggers a quit, the response includes `quitSignal: true` so the caller knows the daemon is shutting down.
- The TUI client's polling loop will naturally detect the daemon shutdown when its next render-state call fails.

### Add `send_key` to `test/ui/tmax_harness/client.py`

- Add a `send_key(config, key)` function that:
  - Translates harness key names to raw key characters: `"Escape"` → `"\x1b"`, `"Enter"` → `"\r"`, `"Space"` → `" "`, `"Backspace"` → `"\x7f"`, `"Tab"` → `"\t"`, control keys like `"C-f"` → the actual control character, etc.
  - Calls `_run_client(config, "--key", translated_key, "--json")` to send via `tmaxclient --key` with structured JSON response (per PRD US-0.9.8)
  - Parses the JSON response into a dict with frame mode, cursor position, buffer name, status message, and any diagnostics
  - Returns `Result[dict, HarnessError]` with the parsed response or error
- This is the single point of key-sending for the entire harness.

### Rewrite `test/ui/tmax_harness/input.py` to use `--key` instead of tmux

- Remove all tmux `send-keys` functions: `_send_raw`, `send_key`, `send_keys`, `send_command`, `send_text`, `send_enter`, `send_escape`, `send_vim_command`.
- Remove `translate_key` and `escape_literal_key` (tmux-specific).
- Add `translate_key_for_daemon(key: str) -> str` that maps harness key notation to the raw character that `tmaxclient --key` expects:
  - `"Escape"` → `"\x1b"`
  - `"Enter"` → `"\r"`
  - `"Space"` → `" "`
  - `"Backspace"` → `"\x7f"`
  - `"Tab"` → `"\t"`
  - `"C-f"` → `"\x06"` (control character)
  - All other single chars pass through as-is
- Add new functions that delegate to `client.send_key`:
  - `send_key(config, key)` — send single key via daemon
  - `send_keys(config, *keys)` — send sequence of keys
  - `send_enter(config)` — shortcut for Enter
  - `send_escape(config)` — shortcut for Escape
  - `send_text(config, text)` — send each character individually
  - `send_vim_command(config, cmd)` — send `:`, then cmd chars, then Enter
- The `window` parameter is removed from all functions. Keys go through the daemon, not to a tmux pane.
- The `config.key_delay` still applies as a sleep between keys for timing stability.

### Update `test/ui/tmax_harness/editor.py` for `--key` and `--stop`

- Update `stop_daemon()` to use `_run_client(config, "--stop")` instead of `eval_expr("(editor-quit)")` + `os.kill(pid, 9)`.
- Update `_stop_tmux()` to use `send_key(config, ":")`, `send_text(config, "q")`, `send_enter(config)` instead of `send_vim_command` through tmux.
- Remove tmux key-sending from `_start_tmux()` (the `inp.send_command` calls for `cd` and launch). Use `session.create_window_with_command()` instead, similar to `_start_daemon_tmux()`.

### Update all test files that use `inp.send_key(config, window, ...)`

- Remove the `window` parameter from all `send_key` / `send_keys` calls.
- Affected files: `test/ui/tests/14_vim_input.py`, `test/ui/tests/15_daily_driver_rendering.py`, `test/ui/tests/16_buffer_completion.py`, `test/ui/tmax_harness/operations.py`.
- In `operations.py`, remove `window` from all function signatures and delegate calls.

### Create `tmax-daemon` skill with Python scripts

- Create `.claude/skills/tmax-daemon/SKILL.md` defining the skill.
- Create `.claude/skills/tmax-daemon/scripts/start_daemon.py`:
  - Verify cwd is tmax project root (check for `src/server/server.ts`)
  - If daemon already running, ping and return status
  - Start daemon via `bun src/server/server.ts` in a subprocess
  - Wait for socket file to appear (poll every 0.2s, timeout 10s)
  - Validate with ping
  - Validate with status — check `recentErrors` count, print warning if > 0
  - Print structured output: "DAEMON_START OK" or "DAEMON_START FAILED: <reason>"
  - Exit 0 on success, exit 1 on failure
- Create `.claude/skills/tmax-daemon/scripts/stop_daemon.py`:
  - Send `shutdown` RPC method via socket
  - Wait for socket file to disappear (poll every 0.2s, timeout 5s)
  - If socket still exists, find PID from `lsof` and SIGTERM
  - Wait for process to exit (poll every 0.2s, timeout 5s)
  - If still alive, SIGKILL
  - Print structured output: "DAEMON_STOP OK" or "DAEMON_STOP FAILED: <reason>"
  - Exit 0 on success, exit 1 on failure

## Validation Commands

- `bun run typecheck:src` — Typecheck all source files
- `bun run test:daemon` — Run daemon integration tests (11/11 must pass)
- `uv run .claude/skills/tmax-daemon/scripts/stop_daemon.py && sleep 1 && uv run .claude/skills/tmax-daemon/scripts/start_daemon.py` — Stop any running daemon, then start fresh and verify health
- `uv run .claude/skills/tmax-daemon/scripts/stop_daemon.py` — Stop daemon, verify it actually stopped
- `bun run bin/tmaxclient --ping` — Verify daemon is not running after stop (should fail with exit 1)
- `uv run .claude/skills/tmax-daemon/scripts/start_daemon.py` — Start daemon, verify bindings loaded
- `bun run bin/tmaxclient --key i && bun run bin/tmaxclient --key '<Escape>' && bun run bin/tmaxclient --key q` — Test --key quit path (should return quitSignal and daemon should stop)
- `uv run .claude/skills/tmax-daemon/scripts/stop_daemon.py` — Clean stop after tests
- `cd test/ui && uv run pytest tests/14_vim_input.py -v` — Verify UI tests pass with new `--key` based input
- `cd test/ui && uv run pytest -v` — Full UI test suite passes with zero regressions

## Notes

The root cause of the earlier failure: `--stop` sends `(editor-quit)` via `--eval`, which goes through `handleEval()`. The T-Lisp evaluator returns `Either.left({message: 'EDITOR_QUIT_SIGNAL'})`, which `handleEval` wraps in a thrown error. `processRequest` catches it and returns a JSON-RPC error. The server never calls `shutdown()`. The daemon stays alive but the socket file gets removed, so subsequent connection attempts fail silently.

The harness rewrite follows the PRD's "Agent as User" standard: agents test the editor the same way a user does — by sending keys through the daemon, not by injecting keystrokes into terminal panes. This makes the harness mode-agnostic: `daemon` mode sends keys via `--key` with no tmux needed, while `daemon-tmux` mode uses the same `--key` for input and tmux only for TUI rendering verification.

The Python scripts use only stdlib (socket, json, subprocess, os, signal, time) — no third-party packages needed. `uv run` is used for consistent Python execution.
