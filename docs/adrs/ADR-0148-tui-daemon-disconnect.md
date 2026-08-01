# ADR-0148 — TUI survives a daemon socket drop with a visible banner + local quit (#54)
## Status: Accepted
## Context
When the daemon socket dropped (`tmax --stop`, crash, restart), the TUI froze
permanently: `RemoteEditor.connect()`'s `close`/`error` handlers only rejected
in-flight requests and left `this.socket` pointing at the dead socket, so
`sendRequest` kept writing to it and waited the full **30s** `REQUEST_TIMEOUT`
per call. The render-poll swallowed the failure with no feedback, and `q`/
Escape round-tripped a `keypress` RPC that never returned — a frozen,
unquittable screen.

## Decision
1. **`RemoteEditor`** — `connect()` now nulls `this.socket` on `close`/`error`
   via an identity-guarded `onLost` closure (`if (this.socket === socket)
   this.socket = null`), so a stale socket cannot clobber a newer connection and
   later `sendRequest` calls fail FAST via the existing `!this.socket` guard.
   New `isConnected` getter.
2. **`tui-client.ts`** — a `disconnected` flag. The 200ms render-poll renders a
   **disconnect banner from cached state** (no round-trip) when `!isConnected`.
   When disconnected, `q`/Escape **quit locally** (`cleanup()` + `process.exit(0)`),
   not via RPC; other keys are ignored. A keypress that hits the dead socket
   before the poll notices also flips the flag.

## Consequences
- A daemon drop is recoverable in-editor: a banner appears (within the 200ms
  poll cycle) and the user exits cleanly. Verified empirically (tmux: banner
  shown, `q` exits) + by a mock-server unit test (`isConnected`→false, next
  `sendRequest` rejects in ~240ms, not 30s).
- No regression to the connected path (24/24 client/server/remote tests pass).
- **Automatic reconnect is out of scope** (codex: no criterion requires it) —
  the deliverable is graceful disconnect + local quit, not transparent reconnect.
  A future reconnect path would need to reset `disconnected` and re-`connect`/
  re-register a frame.

Spec: [BUG-36](../specs/BUG-36-tui-daemon-disconnect.md). Issue: #54.
Verify-gate: PASS.
