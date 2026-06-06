---
scope: bin/**/*, src/server/**/*
---

# Daemon/Client Rules

Applies to `bin/tmax`, `bin/tmaxclient`, `src/server/`, and any code that communicates with the daemon.

## Architecture

tmax uses an Emacs-style daemon/client split:

- **Daemon** (`src/server/server.ts`) — long-lived process owning the editor state, T-Lisp interpreter, and buffer pool. Communicates via JSON-RPC 2.0 over a Unix domain socket.
- **tmaxclient** (`bin/tmaxclient`) — thin CLI that sends JSON-RPC requests to the daemon. One-shot process: connect, send, print result, exit.
- **TUI client** (`src/client/tui-client.ts`) — persistent process that renders the editor in a terminal. Connects as a "frame" and polls `render-state` for display updates.
- **tmax** (`bin/tmax`) — unified entry point. Auto-starts daemon, routes user intent to the right client mode.

## The Two Communication Paths

All external interaction with the editor goes through the daemon's JSON-RPC handler. There are two distinct paths, and they behave differently:

### Path 1: Stateless operations (no frameId)

These operate directly on the daemon's editor state:

| CLI flag | JSON-RPC method | What it does |
|----------|-----------------|--------------|
| `--eval EXPR` | `eval` | Evaluate T-Lisp expression, return result |
| `--key KEY` | `keypress` (no frameId) | Send key to editor, sync all frames after |
| `--insert TEXT` | `insert` | Insert text at cursor |
| `--command CMD` | `command` | Execute editor command by name |
| `--ping` | `ping` | Health check |
| `--stop` | `shutdown` | Graceful shutdown |
| `--status` | `status` | Query daemon state |
| `--list-buffers` | `list-buffers` | List all buffers |
| `--kill-buffer NAME` | `kill-buffer` | Kill a buffer |
| `filename` | `open` | Open file in editor |

Stateless keypresses (`--key` without `--frame`) mutate the editor directly, then call `syncEditorToAllFrames()` to push state to all connected TUI frames.

### Path 2: Frame-scoped operations (with frameId)

TUI clients connect as frames and maintain their own state snapshot:

| JSON-RPC method | What it does |
|-----------------|--------------|
| `connect-frame` | Register a new TUI frame |
| `keypress` (with frameId) | Sync frame→editor, handle key, sync editor→frame |
| `render-state` (with frameId) | Sync editor→frame, return current state |
| `client-event` | Lifecycle events (resize, focus, etc.) |

When a key arrives with a `frameId`, the daemon syncs that frame's state to the editor first (so the key operates on the frame's view), then syncs back after processing. This ensures each frame has independent cursor position and buffer focus.

## Critical Invariant: Sync Direction

- **`render-state`** is a READ operation. It syncs editor→frame (forward direction only). Never sync frame→editor in render-state — that clobbers editor state with stale frame snapshots (see BUG-02).
- **`keypress` with frameId** syncs frame→editor before, editor→frame after. This is correct — the key needs the frame's view.
- **`keypress` without frameId** operates directly on editor, then syncs editor→all frames.

## Socket Protocol

- Default socket: `/tmp/tmax-{uid}/server` (override with `TMAX_SOCKET` env or `--socket` flag)
- Protocol: JSON-RPC 2.0 over Unix domain socket (TCP-style framing with `\n` delimiters)
- **TCP response buffering**: Large responses may arrive across multiple `data` events. Always accumulate into a buffer before parsing — never assume a single `data` event contains a complete response.
- The daemon sends `{"jsonrpc":"2.0",...}\n` — one JSON object per line.

## T-Lisp Evaluation Scope

`interpreter.execute(code)` uses the global environment by default. Module exports (functions defined inside `defmodule` blocks) are resolved via `resolveUniqueExport` in the evaluator's symbol lookup. This means:

- TypeScript primitives (`defineRaw`) are always accessible
- Module exports from loaded modules are accessible by their public name
- Ambiguous names (exported from multiple modules) produce an error — use qualified names (`module/function`)

## Lifecycle

1. `tmax` starts daemon if not running (`ensure_daemon`)
2. Daemon creates socket, loads init.tlisp, enters event loop
3. Clients connect, perform operations, disconnect
4. `tmax --stop` sends `(editor-quit)` via `--eval`, then verifies shutdown

## When Adding New JSON-RPC Methods

1. Add a `case` in the server's `handleRpcRequest` switch
2. Add the corresponding CLI flag in `tmaxclient` if users need it
3. Document the method in the table above
4. Consider whether it needs a `frameId` parameter (frame-scoped vs stateless)
