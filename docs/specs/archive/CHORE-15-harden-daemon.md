# Chore: Harden Daemon

## Chore Description

The daemon/client workflow currently works for the common `tmax` launcher path, but several daemon ownership and protocol edge cases can still produce silent failures or incorrect frame behavior.

The main hardening problem is same-socket daemon ownership. The `bin/tmax` launcher pings before starting a daemon, but `src/server/server.ts` itself unconditionally removes the socket path before `listen()`. A direct `bun src/server/server.ts`, `bun run daemon`, `tmax --daemon`, custom `TMAX_SOCKET`, or concurrent startup race can leave two daemon processes running for the same intended socket. The later daemon becomes reachable; the earlier daemon stays alive but is orphaned from the socket path.

This chore hardens the daemon so a socket path has one clear owner, stale socket files are cleaned only after proving no live daemon owns them, startup readiness is deterministic, request framing handles fragmented JSON-RPC messages, and frame render-state calls return the requested frame state instead of leaking global editor state.

## Relevant Files

Use these files to resolve the chore:

- `src/server/server.ts` - Owns daemon startup, socket binding, shutdown, request parsing, frame state sync, and JSON-RPC methods. This is the primary hardening target.
- `bin/tmax` - Unified launcher. Needs to cooperate with daemon ownership semantics and report startup failures clearly instead of relying only on ping loops.
- `bin/tmaxclient` - One-shot JSON-RPC client. Useful for validating shutdown, ping, status, socket targeting, and request/response timeout behavior.
- `src/editor/remote-editor.ts` - Persistent TUI-side RPC client. Needs robust pending-request cleanup on socket close/error and should continue to buffer newline-delimited responses.
- `src/client/tui-client.ts` - Persistent terminal frame client. Relevant for frame lifecycle behavior when daemon shutdown or socket replacement happens.
- `rules/daemon-client.md` - Project rule file for daemon/client behavior. It currently has stale lifecycle wording and must match the final shutdown/socket semantics.
- `adr/058-frame-based-daemon-client.md` - Documents the frame sync compromise and known active-frame tradeoffs.
- `adr/062-daemon-client-cli-improvements.md` - Documents previous daemon CLI lifecycle fixes that this chore builds on.
- `test/unit/server-client.test.ts` - Existing isolated socket startup test.
- `test/unit/server-observability.test.ts` - Existing frame/status tests. Currently includes coverage that exposes frame state leakage.
- `test/ui/tmax_harness/config.py` - Uses isolated test socket paths and should continue to work after socket ownership changes.

### New Files

- `test/unit/server-daemon-hardening.test.ts` - Focused daemon hardening tests for duplicate same-socket startup, stale socket cleanup, startup readiness, fragmented request parsing, and shutdown socket cleanup.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Confirm Current Failure Modes

- Reproduce same-socket duplicate daemon behavior on a temporary socket path, not the user's default daemon socket.
- Reproduce the existing frame render-state failure with `bun test test/unit/server-observability.test.ts`.
- Record the observed behavior in test names and assertions before changing implementation.
- Verify the worktree is clean or identify unrelated user changes before editing.

### Add Daemon Socket Ownership Primitives

- Replace shell-based `mkdir -p` and `rm -f` calls in `src/server/server.ts` with filesystem APIs.
- Add a socket ownership guard that runs before binding:
  - If the socket path exists and a ping/status request succeeds, fail startup with a clear "daemon already running" error.
  - If the socket path exists but connect fails with stale-socket errors, remove only that stale socket file.
  - If another process is in startup before the socket exists, prevent a race with an atomic exclusive lock file or lock directory beside the socket path.
- Lock acquisition MUST be atomic. Do not implement lock ownership with a normal read-then-write sequence. Use an exclusive filesystem primitive such as `openSync(lockPath, "wx")` or `mkdirSync(lockDir)` so two concurrent daemon starts cannot both acquire ownership.
- If the atomic acquire fails because the lock already exists, read the lock metadata, determine whether it is stale, remove it only when stale, then retry the atomic acquire.
- Store enough lock metadata to debug failures: pid, socket path, start timestamp, and project cwd.
- Track lock ownership explicitly in the daemon, for example with `ownsLock`. Set it only after the atomic lock acquire succeeds.
- Release the lock on graceful shutdown, SIGINT, and SIGTERM.
- Treat stale locks conservatively: only remove a lock when its recorded process is not alive or when the lock is clearly invalid.

### Make Server Startup Await Actual Readiness

- Change `TmaxServer.start()` so its returned promise resolves only after `server.listen()` has succeeded and `isRunning` is true.
- Reject `start()` on listen errors instead of calling `process.exit()` inside the class.
- Keep process exit behavior only in the `import.meta.main` entrypoint.
- Ensure tests can instantiate `TmaxServer` without process-level exits on expected duplicate-start errors.

### Clean Up Socket And Lock On Shutdown

- Make `shutdown()` idempotent so repeated shutdown calls do not throw or schedule duplicate exits.
- Close all client sockets, close the server, then remove the daemon-owned socket path and lock file.
- Only unlink paths that this daemon owns. Do not remove a socket path if ownership was never acquired.
- Remove the lock only when this process owns it and the current lock metadata still matches this process id and socket path. A duplicate or failed server instance must never be able to delete a live daemon's lock.
- Track socket ownership and lock ownership separately. A server can fail after acquiring a lock but before binding a socket; cleanup must handle that partial-start case without deleting another process's later lock.
- Keep `bin/tmax --stop` fallback behavior, but prefer server-side cleanup so direct `tmaxclient --stop` and direct RPC shutdown also leave no stale socket.

### Harden Launcher Startup Behavior

- Update `bin/tmax` so `ensure_daemon()` handles three outcomes distinctly: already running, started successfully, and failed to start.
- Avoid swallowing all daemon startup diagnostics. Capture daemon startup output to a temporary log and print a short tail when startup fails.
- Make concurrent `tmax file.txt` launches safe: one should win daemon startup, the other should wait for the live daemon rather than starting a second daemon.
- Keep the project-root `cd` behavior for both background start and `--daemon`.

### Replace Server Request Parsing With Per-Connection Framing

- Replace `parseMultipleRequests(data)` usage with a per-connection input buffer.
- Use the documented newline-delimited JSON-RPC framing: one complete JSON object per line.
- Preserve support for multiple complete requests in a single data event.
- Add explicit handling for malformed complete JSON lines that returns a JSON-RPC parse error with the relevant request id when possible.
- Do not silently drop fragmented requests. A request split across multiple `data` events must be processed once the newline arrives.

### Fix Frame Render-State Serialization

- Fix `handleRenderState({ frameId })` so it returns the requested frame's state, not the daemon's global editor state.
- Preserve the invariant from `rules/daemon-client.md`: `render-state` is read-oriented and must not sync frame state back into the editor.
- Add or reuse a helper that converts a `Frame` plus shared editor data into an `EditorState` suitable for `editorStateToJson`.
- Preserve shared display metadata when building the frame render state. At minimum, copy `windows`, `currentWindowIndex`, `tabs`, `currentTabIndex`, and any renderer-visible shared metadata such as `highlightSpans`, `searchMatches`, and `bufferModified` from `this.editor.getState()`.
- Do not return a synthetic frame state that omits windows or tabs. A connected TUI frame must still render split windows and tab bars after daemon-side commands such as `(split-window "horizontal")` or `(tab-new "name")`.
- Ensure connected frames can have independent minibuffer sessions, modes, cursor positions, and current buffers.
- Keep daemon-side mutations such as `eval`, `open`, `insert`, and no-frame `keypress` syncing editor state to all frames as currently documented, unless a later spec changes CLI targeting semantics.

### Harden Client Error Handling

- In `RemoteEditor`, reject all pending requests when the socket closes or errors.
- Add a request timeout for persistent TUI RPC calls so a dead daemon does not leave unresolved promises forever.
- Keep response buffering newline-based, matching the daemon framing.
- In `bin/tmaxclient`, ensure request timeouts and socket errors close the connection cleanly and return nonzero exits for failed commands.

### Add Focused Regression Tests

- Add `test/unit/server-daemon-hardening.test.ts`.
- Test that starting a second `TmaxServer` on the same socket rejects and does not steal the first daemon's socket.
- Test atomic lock acquisition directly or via concurrent daemon starts. The test must fail if lock acquisition is implemented as a normal read-then-write sequence.
- Test that a stale socket file is removed and the daemon can start.
- Test that a stale lock is removed only when the recorded process is gone.
- Test that a duplicate or failed server instance cannot remove a live daemon's lock during shutdown.
- Test that a fragmented JSON-RPC request split across two writes receives one correct response.
- Test that two JSON-RPC requests in one write each receive a response.
- Test that shutdown removes the socket and lock owned by the daemon.
- Update the existing frame independence test so it passes by checking `render-state` returns each frame's independent minibuffer view.
- Add a frame render metadata regression test:
  - Connect a frame.
  - Run `(split-window "horizontal")`.
  - Call `render-state` for that frame and assert `windows.length` is `2`.
  - Run `(tab-new "review-tab")` or another cheap tab command.
  - Call `render-state` and assert the returned `tabs` include the new tab.

### Update Documentation And Rules

- Update `rules/daemon-client.md` lifecycle wording so `tmax --stop` documents the `shutdown` RPC path, not `(editor-quit)` via eval.
- Document the socket ownership behavior: default socket path, live-daemon detection, stale socket cleanup, and lock semantics.
- Note that multiple daemon instances are supported only through distinct socket paths or names, not by stealing the same socket.

### Run Validation Commands

- Execute every command listed in the Validation Commands section.
- Fix every failure before reporting the chore implementation complete.
- If any daemon process is started during validation, stop it and verify no test socket or lock remains.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `bun run typecheck:src` - Typecheck all source files.
- `bun run typecheck:test` - Typecheck all test files.
- `bun run typecheck` - Run the full TypeScript typecheck required by project learnings.
- `bun test test/unit/server-client.test.ts test/unit/server-observability.test.ts test/unit/server-daemon-hardening.test.ts` - Run focused daemon, frame, and hardening unit tests.
- `bun run test:daemon` - Run daemon integration tests through the UI harness.
- `bash -lc 'tmpdir=$(mktemp -d /tmp/tmax-daemon-hardening.XXXXXX); socket="$tmpdir/server"; TMAX_SOCKET="$socket" bin/tmax --daemon >"$tmpdir/one.log" 2>&1 & pid=$!; for i in $(seq 1 50); do bin/tmaxclient -s "$socket" --ping >/dev/null 2>&1 && break; sleep 0.1; done; TMAX_SOCKET="$socket" bin/tmax --daemon >"$tmpdir/two.log" 2>&1 && second=0 || second=$?; bin/tmaxclient -s "$socket" --ping >/dev/null; bin/tmaxclient -s "$socket" --stop >/dev/null || true; wait "$pid" 2>/dev/null || true; test "$second" -ne 0; test ! -S "$socket"; rm -rf "$tmpdir"'` - Manually validate duplicate direct daemon startup fails without stealing the first daemon socket.

## Notes

- The current duplicate-daemon behavior was confirmed on an isolated temporary socket: two direct daemon PIDs remained alive, and the later daemon became reachable at the socket path.
- The existing focused daemon test run had one relevant failure: `frames keep independent opaque minibuffer sessions and views` returned the second frame's minibuffer prompt for the first frame after `render-state`.
- A code review of an initial CHORE-15 implementation found that a non-atomic lock file is not enough. The implementation must use an exclusive filesystem operation for lock acquisition.
- The same review found that a frame render-state helper can accidentally drop shared `windows` and `tabs`. Preserve renderer-visible shared metadata while keeping frame-local mode, cursor, minibuffer, and current buffer state independent.
- Prefer a conservative socket ownership design over convenience. It is acceptable for a same-socket duplicate daemon start to fail loudly; it is not acceptable to orphan an existing live daemon silently.
- Keep distinct-socket multi-daemon workflows available through `TMAX_SOCKET` or `--socket`.
