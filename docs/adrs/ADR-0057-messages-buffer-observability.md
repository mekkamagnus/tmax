# ADR 057: *Messages* Buffer for Editor Observability

**Date**: 2026-06-02
**Status**: Accepted

## Context

The daemon/client architecture (ADR-018) enables AI agents to control tmax remotely via `tmax-pilot`, but there was no way to observe what the editor is doing. Status messages appear on screen and disappear. When an AI agent sends a keypress and gets "Unbound key" back, it has no context about what happened before or why.

Emacs solves this with its `*Messages*` buffer — a persistent log of all editor events. We needed the same capability for:

1. AI agent observability — agents can query `--messages` to see what happened
2. User debugging — users can switch to `*Messages*` buffer to review history
3. T-Lisp access — `(message "...")` and `(messages-buffer)` provide programmatic access

The design needed to work for both the TUI (direct Editor) and daemon (TmaxServer) paths without duplicating logging logic.

## Decision

1. Add a `messages: string[]` array and `logMessage(msg)` method to the Editor class. Each call appends a `[HH:MM:SS] msg` line and updates the `*Messages*` buffer (a regular FunctionalTextBuffer).

2. Hook `logMessage` into all mode handlers (normal, insert, visual, command, mx) at every point where `statusMessage` is set — unbound keys, command errors, count prefix changes, completion results.

3. Expose two T-Lisp functions:
   - `(message "text")` — sets statusMessage AND logs to messages (mirrors Emacs `message`)
   - `(messages-buffer)` — returns the `*Messages*` buffer content

4. Expose a `messages` query on the daemon RPC — `tmaxclient --messages` prints the log.

5. Thread `logMessage` through the `TlispEditorState` interface so T-Lisp API functions can also log.

## Consequences

### Positive

- AI agents get full visibility into editor events via a single RPC call
- Users can review editor history by switching to `*Messages*` buffer
- T-Lisp functions can emit structured log entries programmatically
- Daemon logs server-level events (startup, file opens) alongside editor events
- Minimal performance impact — appending to an array and recreating a buffer

### Negative

- Unbounded memory growth — the messages array is never trimmed. For long-running daemon sessions this could grow large. A future max-size limit with pruning may be needed.
- Recreating the `*Messages*` buffer via `FunctionalTextBufferImpl.create()` on every log call is O(n) in message count. Acceptable for now but could be optimized with buffer.append.

### Neutral

- The `logMessage` callback pattern (threaded through TlispEditorState) adds one more property to the state interface, but keeps logging decoupled from handler implementation.
