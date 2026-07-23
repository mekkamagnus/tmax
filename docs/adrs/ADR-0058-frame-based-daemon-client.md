# ADR 058: Frame-Based Daemon/Client Architecture

**Date**: 2026-06-02
**Status**: Accepted

## Context

The original daemon/client design (ADR-018) had a single global Editor state. When multiple TUI clients connected, they all saw and mutated the same cursor position, viewport, and mode. If client A moved the cursor, client B's screen would jump on next refresh. This made multi-client workflows impractical.

Emacs solves this with frames — each graphical frame (window) has its own viewport, cursor position, and mode line, while sharing the underlying buffers, interpreter, and configuration. We needed the same abstraction for tmax to support:

1. Multiple terminal sessions editing different parts of the same file
2. One user in insert mode while another navigates in normal mode
3. Each client maintaining independent viewport scroll positions

The Editor class was designed as a single-instance object with mutable global state. Restructuring it to support multiple concurrent viewports would be a massive refactor.

## Decision

1. Define a `Frame` interface in `src/core/types.ts` that captures per-client state:
   ```
   Frame { id, cursorPosition, viewportTop, mode, commandLine, mxCommand,
           currentFilename, currentBuffer, statusMessage, cursorFocus, lastActivity }
   ```

2. Keep the Editor as a single shared instance in the daemon. Add a `frames: Map<string, Frame>` to TmaxServer.

3. Use a **sync pattern** instead of restructuring Editor:
   - `syncFrameToEditor(frame)` — copies frame's viewport/cursor/mode into Editor before an operation
   - `syncEditorToFrame(frame)` — copies Editor state back to frame after the operation
   
   This avoids changing the Editor class internals while giving each client independent state.

4. RemoteEditor registers as a frame on connect via a `connect-frame` RPC. It receives a `frameId` and includes it with every subsequent request (keypress, render-state).

5. The unified `bin/tmax` CLI handles the full lifecycle:
   - `tmax` — auto-start daemon if needed, then connect as TUI client
   - `tmax file.txt` — open file in daemon, connect as TUI client
   - `tmax --daemon` — start daemon only (no TUI)
   - `tmax -e '(expr)'` — evaluate T-Lisp expression on the daemon
   - `tmax --stop` — gracefully stop the daemon

6. On client disconnect, the frame is deleted. If it was the active frame, another frame is promoted to active.

## Consequences

### Positive

- Multiple TUI clients can work simultaneously with independent viewports
- The sync pattern avoids restructuring the entire Editor class — minimal code changes
- Emacs users get familiar daemon/client workflow (emacs --daemon / emacsclient)
- Single `tmax` binary handles all modes — no separate daemon/client scripts needed
- Shared buffers and interpreter mean low memory overhead per additional client

### Negative

- The sync pattern is a compromise — it means only one frame can be actively executing commands at a time (no true parallelism). Two clients sending rapid keypresses would see each other's state bleed through.
- Frame state is copied on every operation (two object spreads per keypress). For typical typing speeds this is negligible, but automated tools sending rapid commands could hit contention.
- The `activeFrameId` concept introduces a "primary client" notion that isn't well-defined in the protocol. If multiple clients connect simultaneously, the last one to send a keypress becomes active.

### Neutral

- The `Frame` interface lives in `src/core/types.ts` alongside `EditorState`, making the distinction between shared state (buffers, config) and per-client state (cursor, viewport) explicit.
- Socket path uses `/tmp/tmax-${UID}/server` — follows Emacs convention but should ideally use `XDG_RUNTIME_DIR` (noted as future improvement).

## Amendment — Wire-protocol versioning (SPEC-070, 2026-07-23)

The daemon/client wire protocol is now a **versioned, negotiated contract** (per [SPEC-070](../specs/SPEC-070-daemon-client-protocol-versioning.md) / [RFC-025](../rfcs/RFC-025-daemon-client-protocol-hardening.md) change #1), preempting the silent daemon/client version-skew regression herdr hit and retrofitted late.

- `PROTOCOL_VERSION` (currently `1`) and the `ENFORCE_PROTOCOL_VERSION` transition gate live in `src/server/rpc/types.ts` as the single source of truth. Clients declare `protocolVersion` as a top-level field on every JSON-RPC request envelope (sibling to `jsonrpc`), consistent with the existing per-request `jsonrpc === '2.0'` check.
- The daemon refuses a mismatched client with a machine-readable `protocol_mismatch` error in the `-32600` (Invalid Request) family before dispatch: `error.data = { kind: "protocol_mismatch", client, server, guidance }`. This is enforced in one pure helper (`validateProtocolVersion`) called in **two** places — inside `routeRequest` (step 1b) and at the top of the `connect-frame` branch in `server.ts` (the handshake bypasses `routeRequest`, so it must be gated separately through the same helper).
- **Transition policy:** a DECLARED-but-wrong version is always refused; a client that OMITS `protocolVersion` is tolerated while `ENFORCE_PROTOCOL_VERSION === false` (protects an old client binary against a new daemon across a binary swap), then refused once the flag flips to `true`. To enforce next release, set that one constant — no other code changes.
- The daemon advertises its version: the `status` result and the `connect-frame` success result both carry `protocolVersion`, so `--status`/diagnostics and clients can detect a skew programmatically.

This owns the live wire protocol; the historical `### Protocol` section of [ADR-0018](ADR-0018-basic-server-client-infrastructure.md) now cross-references this amendment.
