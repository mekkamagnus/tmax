# Bug: TUI client freezes and can't quit when the daemon socket drops

## Bug Description
When the daemon socket drops (e.g. `tmax --stop`, crash, restart), the TUI client
**freezes permanently**:
- `RemoteEditor.connect()` close/error handlers only rejected in-flight requests;
  they never nulled `this.socket` and never reconnected. So `sendRequest` kept
  writing to the destroyed socket and waited the full **30s** `REQUEST_TIMEOUT`
  per call. Every keystroke hung.
- The 200ms render-poll swallowed its `refreshState` failure ("ignore, will show
  on next keypress") with no visible feedback.
- Quit keys (`q`/Escape) round-trip a `keypress` RPC that never returns, so the
  user could not exit — a frozen, unquittable screen.

## Problem Statement
A daemon drop must be recoverable in-editor: show a visible disconnect banner
(from cached state) and let the user quit cleanly, instead of a hard hang.

## Solution Statement
1. **`RemoteEditor`** (`src/editor/remote-editor.ts`) — on socket `close`/`error`,
   **null `this.socket`** (identity-guarded so a stale socket can't clobber a
   newer connection) so subsequent `sendRequest` calls fail FAST via the existing
   `!this.socket` guard (no 30s wait). Expose `get isConnected`.
2. **`tui-client.ts`** — track a `disconnected` flag. The render-poll detects
   `!remote.isConnected` and renders a **disconnect banner from cached state**
   (no round-trip). When disconnected, `q`/Escape **quit locally**
   (`cleanup()` + `process.exit(0)`) without round-tripping; other keys are
   ignored. A keypress that hits the dead socket before the poll notices also
   flips the flag.

Codex review (APPROVE-WITH-CONCERNS) honored: identity-guard the close/error
callbacks (done) so a stale socket cannot null a newer connection. **Automatic
reconnect is out of scope** (codex: "no criterion requires retrying /
re-registering via connect-frame / refreshing state") — the deliverable is
graceful disconnect + local quit, not transparent reconnect.

## Steps to Reproduce
```bash
# terminal 1: daemon + TUI
tmax
# terminal 2: kill the daemon
tmax --stop
# terminal 1: the TUI freezes; q / Escape do nothing for 30s+ per key
```

## Root Cause Analysis
`connect()`'s `close`/`error` handlers called `rejectAllPending` but left
`this.socket` pointing at the dead socket; `sendRequest` only checks `!this.socket`
(line 138), which stayed non-null, so it wrote to a destroyed socket and relied on
the 30s timeout. The TUI's poll and key path both assumed the RPC would eventually
return, so a dropped daemon = indefinite freeze.

## Relevant Files
- `src/editor/remote-editor.ts` — null `this.socket` on close/error (identity-guarded); `isConnected` getter.
- `src/client/tui-client.ts` — `disconnected` flag; disconnect banner; local quit on q/Esc; key-catch detection.
- `test/unit/remote-editor.test.ts` — fail-fast test (socket close ⇒ `isConnected` false + `sendRequest` rejects in <1.5s, not 30s).

## Step by Step Tasks
### Task 1 — fail-fast socket nulling
**AC**: `RemoteEditor.connect()` close/error null `this.socket` (identity-guarded); `isConnected` reflects it.
### Task 2 — TUI disconnect banner + local quit
**AC**: the poll renders a disconnect banner from cached state when `!isConnected`; `q`/Escape exit locally when disconnected.
### Task 3 — regression test
**AC**: a mock-server socket-close test asserts `isConnected`→false and a subsequent `sendRequest` rejects in <1.5s (no 30s hang).
### Task 4 — Validate
typecheck clean + tests green + verify-gate PASS.

## Validation Commands
- `bun run typecheck:src && bun run typecheck:test`
- `bun test test/unit/remote-editor.test.ts` — green incl. the fail-fast test.
- (empirical, optional) daemon + TUI, `tmax --stop`, observe banner + `q` quits.

## Notes
- Out of scope: automatic reconnect / frame re-registration / clearing the banner (graceful disconnect + local quit is the deliverable).
- `cleanup()` on local quit still attempts `sendEvent("shutdown")` — guarded by `.catch(() => undefined)` so it no-ops on the dead socket.
