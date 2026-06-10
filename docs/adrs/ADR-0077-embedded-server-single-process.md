# Embed Socket Server in Single-Process Launch

## Status

Accepted

## Context

The default `tmax file.txt` invocation spawned a background daemon process and then exec'd a separate TUI client. This matched the Emacs daemon model (ADR-0018, ADR-0058) but added friction for the common case: users had to know about `--daemon`, `--stop`, and `tmaxclient` to get started, and the background process leaked across shells.

At the same time, the daemon's value — instant file opening, AI agent control via JSON-RPC, multi-frame editing — required the socket server to exist. The question was whether the socket had to be a separate process, or whether a single foreground process could host both the editor and the socket.

## Decision

Embed the socket server inside the foreground Steep frontend process when launched without `--daemon`.

Concretely:

1. `TmaxServer` constructor accepts an optional external `Editor` instance.
2. `start()` is split into `startEditor()` (loads bindings + init) and `startSocket()` (opens the Unix socket listener). When the editor is provided externally, only `startSocket()` runs.
3. `main.tsx` boots Steep, then starts the embedded socket server alongside it. If the socket path is already in use (another daemon running), the embedded server degrades gracefully — the editor still runs, the socket just doesn't open.
4. `bin/tmax` default path simplifies to a single `exec bun src/main.tsx` instead of background-spawn + TUI-client-exec.
5. Explicit `--daemon`, `--stop`, `-e`, `--capture` paths are unchanged — they still go through the dedicated server process.

The single foreground process now serves both roles: interactive editor and JSON-RPC endpoint.

## Consequences

- **One process model.** New users get `tmax file.txt` with no daemon concepts to learn. AI agent clients still work because the socket is live.
- **Graceful coexistence.** If a real daemon is already running, the embedded server defers — the foreground process runs without its own socket. This means both modes can coexist on the same machine without port conflicts.
- **Socket lifecycle matches process lifecycle.** When the user closes the editor, the socket goes away. No orphaned daemons to clean up with `--stop`.
- **Tradeoff: no instant startup from a warm daemon in single-process mode.** Each invocation pays the Bun startup cost. Users who want instant startup can still run `--daemon` explicitly.
- **`TmaxServer.start()` is now a composed API**, not a monolithic boot path. Future embeddings (e.g., inside a React Native or web frontend) can reuse `startSocket()` against their own editor.
