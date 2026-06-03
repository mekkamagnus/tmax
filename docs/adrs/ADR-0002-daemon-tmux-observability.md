# ADR 0002: Daemon/Tmux Observability and Strict Renderer Testing

**Date**: 2026-06-02
**Status**: Accepted

## Context

tmax now has two distinct test surfaces:

1. **Editor logic** — buffers, modes, file operations, T-Lisp evaluation, and daemon state.
2. **TUI rendering** — whether a real terminal client connects, renders, enters raw mode, and stays visually correct in tmux.

The earlier UI harness blurred those surfaces. `daemon-tmux` tests started a daemon, opened a tmux window, launched the TUI by typing shell commands into the pane, and then used a mix of `tmaxclient --eval` queries and tmux screen scraping. This caused several failure modes:

- tmux windows could open while the TUI command had not actually launched
- quit/control keys could be sent before the TUI was ready
- readiness could pass based only on daemon ping, not renderer readiness
- TUI frame refresh could overwrite daemon-side eval changes
- failure output lacked structured daemon/client/frame diagnostics

The architecture already points toward an Emacs-style split: daemon/client state is authoritative for editor logic, while tmux should verify the terminal renderer itself.

## Decision

### 1. Use daemon-only mode for editor logic tests

The Python harness defaults to `daemon` mode for logic tests. These tests start the daemon and use `tmaxclient`/JSON-RPC/T-Lisp APIs for operations and assertions.

This avoids tmux dependency for tests that do not need a renderer.

### 2. Reserve daemon-tmux mode for renderer tests

`daemon-tmux` is now strict renderer mode. It must prove that:

- the daemon is running
- a TUI client connected
- a frame was created
- the TUI completed first render
- raw mode is ready
- render count is nonzero
- the tmux pane shows rendered editor output

If those conditions are not met, the harness fails instead of silently falling back to daemon-only behavior.

### 3. Start TUI panes directly instead of typing shell commands

The harness creates the tmux test window with the TUI command as the pane command:

```bash
tmux new-window -c <project-root> <tui-command>
```

It no longer types `cd`, launch commands, or quit keys into an interactive shell during startup/cleanup.

### 4. Add daemon observability endpoints

The daemon exposes structured JSON-RPC observability:

- `status`
- `clients`
- `frames`
- `client-event`

`tmaxclient` exposes these as:

```bash
tmaxclient --status --json
tmaxclient --clients --json
tmaxclient --frames --json
```

The status payload includes daemon readiness, uptime, socket path, editor snapshot, connected clients, connected frames, readiness milestones, render counts, frame/editor sync metadata, and recent errors.

### 5. Make TUI clients report lifecycle events

The TUI client identifies itself as `clientType: "tui"` and reports:

- `tui-started`
- `first-render`
- `raw-mode-ready`
- `render`
- `resize`
- `error`
- `shutdown`

The daemon records these events against the owning client/frame.

### 6. Treat daemon state as authoritative for daemon-originated mutations

Daemon-side `open`, `eval`, and `insert` operations sync editor state back to connected frames. Passive `render-state` requests pull editor state into the frame instead of pushing stale frame state into the editor.

This prevents TUI render polling from undoing `tmaxclient --eval` changes.

## Consequences

### Positive

- Logic tests are faster and simpler because they use daemon-only mode by default.
- Renderer tests are stricter: `daemon-tmux` must prove a real TUI client is connected and ready.
- Harness failures now have structured diagnostics: status JSON, client/frame state, recent errors, pane command, and tmux capture.
- The AI harness no longer needs to infer daemon/client readiness from screen text.
- Frame/editor synchronization is explicit and observable.
- The new observability endpoints are useful outside tests for debugging live daemon/client sessions.

### Negative

- The daemon now owns additional observability state: client records, frame records, lifecycle events, render counts, and recent errors.
- TUI clients must report lifecycle events correctly; missing events can make daemon-tmux tests fail even if the renderer appears usable.
- `daemon-tmux` tests are intentionally more brittle than daemon-only tests because they validate real terminal rendering.

### Neutral

- tmux remains part of renderer testing only; it is not required for daemon-only editor logic tests.
- Existing `ping`, `eval`, file open, and TUI workflows remain backward compatible.
- The observability endpoints are protocol additions rather than replacements for existing JSON-RPC methods.

## Implementation

- Spec: [SPEC-001-daemon-tmux-observability](../../specs/SPEC-001-daemon-tmux-observability.md)
- Server implementation: `src/server/server.ts`
- TUI lifecycle reporting: `src/client/tui-client.ts`, `src/editor/remote-editor.ts`
- CLI status commands: `bin/tmaxclient`
- Python harness integration: `test/ui/tmax_harness/`
- Unit tests: `test/unit/server-observability.test.ts`
- UI integration test: `test/ui/tests/04_daemon_tmux_observability.py`

## Validation

- `bun test test/unit/server-observability.test.ts` — 5/5 pass
- `bun test test/unit/test-tlisp-testing-framework.test.ts` — 10/10 pass
- daemon-only Python UI suite — 15/15 assertions pass
- daemon-tmux Python UI suite — 34/34 assertions pass
- full current Python UI suite — 49/49 assertions pass
