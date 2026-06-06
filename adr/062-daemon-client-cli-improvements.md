# Daemon/Client CLI Improvements

## Status

Accepted

## Context

The `bin/tmax` launcher and `bin/tmaxclient` CLI had several operational gaps:

1. **`tmax --stop`** killed the daemon by sending `(editor-quit)` T-Lisp, which was unreliable — it could fail silently, leaving a zombie daemon and stale socket. There was no fallback to SIGTERM.
2. **`tmaxclient`** lacked direct key/command injection — the only way to send input was through a connected TUI frame. Debugging required launching a full TUI.
3. **Daemon startup** from outside the project root would fail because the launcher didn't `cd` to the project directory before starting the background daemon process.

## Decision

1. **Graceful shutdown with fallback** — `tmax --stop` sends a `shutdown` JSON-RPC request first, waits 1 second, then falls back to SIGTERM via `lsof` on the socket, then cleans up the socket file.
2. **`tmaxclient --key` / `--keys`** — Send individual keypresses or key sequences to the active frame. Supports `<Escape>`, `<Enter>`, `<Space>` notation for special keys. Enables daemon-first debugging without a TUI.
3. **`tmaxclient --command`** — Execute an M-x command by name against the active frame.
4. **`tmaxclient --diagnostics` / `--last-error` / `--backtrace`** — Query T-Lisp diagnostic state from the running daemon.
5. **`tmaxclient --stop`** — Uses the `shutdown` RPC instead of evaluating T-Lisp.
6. **Daemon CWD fix** — `ensure_daemon()` in `bin/tmax` now does `(cd "$PROJECT_DIR" && bun "$DAEMON" ...)`, and `--daemon` mode does `cd "$PROJECT_DIR" && exec bun "$DAEMON"`.

## Consequences

- Daemon stop is reliable: first ask nicely, then force.
- Keys and commands can be injected programmatically, enabling scriptable testing and debugging.
- Daemon starts correctly from any directory (partial fix — the editor source code still had CWD-dependent paths until ADR 063).
