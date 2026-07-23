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
| `render-state` (with frameId) | Return frame's own state (read-only, no sync) |
| `client-event` | Lifecycle events (resize, focus, etc.) |

When a key arrives with a `frameId`, the daemon syncs that frame's state to the editor first (so the key operates on the frame's view), then syncs back after processing. This ensures each frame has independent cursor position and buffer focus.

## Critical Invariant: Sync Direction

- **`render-state`** is a READ operation. It returns the frame's own state directly — no sync to or from the editor. Never mutate editor state during render-state.
- **`keypress` with frameId** syncs frame→editor before, editor→frame after. This is correct — the key needs the frame's view.
- **`keypress` without frameId** operates directly on editor, then syncs editor→all frames.

## Socket Ownership

Each socket path has exactly one owner. The daemon acquires ownership before binding:

1. If the socket file exists and a live daemon responds to a ping, startup rejects with "Daemon already running".
2. If the socket file exists but no daemon responds, it is a stale socket — safe to remove.
3. A lock file (`{socket}.lock`) prevents startup races between concurrent `tmax` invocations.
4. The lock records the owner's pid, socket path, start timestamp, and cwd for diagnostics.
5. Stale locks (process no longer alive) are removed automatically.
6. On graceful shutdown, the daemon removes both the socket file and the lock.
7. Multiple daemon instances are supported only through distinct socket paths (`TMAX_SOCKET`), never by stealing the same socket.

## Socket Protocol

- Default socket: `/tmp/tmax-{uid}/server` (override with `TMAX_SOCKET` env or `--socket` flag)
- Protocol: JSON-RPC 2.0 over Unix domain socket, newline-delimited framing.
- **Server side**: Each connection maintains an input buffer. Requests are parsed line-by-line. Fragmented requests (split across `data` events) are accumulated until the newline arrives. Malformed JSON lines return a `-32700` parse error.
- **Client side**: Always accumulate responses into a newline-delimited buffer before parsing — never assume a single `data` event contains a complete response.
- The daemon sends `{"jsonrpc":"2.0",...}\n` — one JSON object per line.

### Protocol versioning

The wire protocol is a **versioned, negotiated contract** (SPEC-070 / RFC-025 #1). The single source of truth is `PROTOCOL_VERSION` (currently `1`) in `src/server/rpc/types.ts` — never hardcode the version; import the constant.

- **Request field:** every JSON-RPC request carries an optional top-level `protocolVersion: number` (sibling to `jsonrpc`). Clients SHOULD stamp `protocolVersion: PROTOCOL_VERSION` on every request. All in-repo clients do: `RemoteEditor.sendRequest`, `bin/tmaxclient`, and `tmax-use/src/client.ts`.
- **Negotiation:** the daemon refuses a client whose declared `protocolVersion` does not match, with a machine-readable error **before** dispatch:
  - code `-32600` (Invalid Request family),
  - `error.data.kind === "protocol_mismatch"`, with `client` (the declared version), `server` (the daemon's version), and a non-empty `guidance` string (stop/restart the daemon).
  - The gate is one pure helper, `validateProtocolVersion` in `src/server/rpc/router.ts`, called both in `routeRequest` (step 1b) and at the top of the `connect-frame` branch in `server.ts` (the handshake bypasses `routeRequest`).
- **Transition (`ENFORCE_PROTOCOL_VERSION`):** a DECLARED-but-wrong version is always refused. While the flag is `false`, a client that OMITS `protocolVersion` is tolerated (protects an old client binary across a binary swap); flipping to `true` next release refuses the omission too. To enforce: set one constant.
- **Advertisement:** the daemon exposes its version in the `status` result (`protocolVersion`) and in the `connect-frame` success result, so `--status`/diagnostics and clients can detect a skew programmatically.

## T-Lisp Evaluation Scope

`interpreter.execute(code)` uses the global environment by default. Module exports (functions defined inside `defmodule` blocks) are resolved via `resolveUniqueExport` in the evaluator's symbol lookup. This means:

- TypeScript primitives (`defineRaw`) are always accessible
- Module exports from loaded modules are accessible by their public name
- Ambiguous names (exported from multiple modules) produce an error — use qualified names (`module/function`)

## Lifecycle

1. `tmax` starts daemon if not running (`ensure_daemon`), capturing startup logs for diagnostics
2. Daemon acquires socket ownership (lock + ping probe), creates socket, loads init.tlisp, enters event loop
3. `start()` resolves only after `listen()` succeeds — callers can connect immediately
4. Clients connect, perform operations, disconnect
5. `tmax --stop` sends a `shutdown` RPC, then verifies the socket is removed
6. Shutdown is idempotent — socket and lock are cleaned up once

## When Adding New JSON-RPC Methods

1. Add a `case` in the server's `processRequest` switch
2. Add the corresponding CLI flag in `tmaxclient` if users need it
3. Document the method in the table above
4. Consider whether it needs a `frameId` parameter (frame-scoped vs stateless)
