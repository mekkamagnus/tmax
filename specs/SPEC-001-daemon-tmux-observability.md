# Feature: Daemon/Tmux Observability

## Feature Description
Add structured observability for the daemon/client/TUI workflow so the Python UI harness can verify daemon-tmux readiness through explicit daemon state instead of inferring too much from tmux screen capture. The feature exposes connected clients, TUI frames, readiness milestones, render activity, frame/editor sync metadata, and recent client errors through JSON-RPC and `tmaxclient` commands.

This makes `daemon` mode the reliable path for editor logic tests and makes `daemon-tmux` a strict renderer test mode: the harness should know whether a real TUI client connected, created a frame, rendered at least once, entered raw mode, and continues polling state.

## User Story
As an AI test harness operator
I want structured daemon observability for TUI clients and frames
So that renderer tests can wait for real readiness, diagnose startup failures, and avoid brittle tmux screen-scraping for non-renderer state.

## Problem Statement
`daemon-tmux` currently has limited observability. The harness can start a daemon, create a tmux window, launch the TUI, and scrape screen output, but it cannot directly ask the daemon whether:

- a TUI client is connected
- a frame was created for that client
- the first render completed
- raw mode was enabled
- render polling is active
- daemon-side eval state and frame state are synchronized
- the client recorded startup/runtime errors

This gap caused concrete failures:

- tmux command launch looked successful while the TUI had not actually started
- readiness checks could pass based only on daemon ping
- TUI render polling could overwrite daemon eval changes
- failures had poor diagnostics: pane output, daemon state, and frame state had to be inspected manually

## Solution Statement
Introduce a structured observability layer in the daemon protocol and wire it through `tmaxclient` and the Python harness.

The daemon will track client metadata, frame metadata, readiness milestones, render counts, last request timestamps, last render timestamps, last sync direction, and recent errors. The TUI client will identify itself as a TUI client and report lifecycle events such as `started`, `first-render`, `raw-mode-ready`, `render`, and `error`. `tmaxclient` will expose these via `--status`, `--clients`, and `--frames` commands. The Python harness will use these structured endpoints for daemon-tmux readiness and diagnostics, while tmux capture remains the final renderer-surface assertion.

## Relevant Files
Use these files to implement the feature:

- `src/server/server.ts` - Main JSON-RPC server; add observability state, client metadata, lifecycle event handling, status endpoints, and frame sync diagnostics.
- `src/editor/remote-editor.ts` - Remote TUI client RPC wrapper; pass client identity when connecting and expose frame/client ids to the TUI client.
- `src/client/tui-client.ts` - TUI renderer; report readiness milestones, render counts, raw-mode readiness, terminal dimensions, and runtime errors.
- `bin/tmaxclient` - CLI client; add `--status`, `--clients`, `--frames`, and optionally `--json` output for harness consumption.
- `src/server/serialize.ts` - Existing editor state serializer; reuse for frame/editor snapshots in status responses where appropriate.
- `src/core/types.ts` - Existing `Frame` and `EditorState` types; add protocol-facing observability types only if useful to avoid untyped `any` objects.
- `test/ui/tmax_harness/client.py` - Python wrapper around `tmaxclient`; add structured status/client/frame query functions.
- `test/ui/tmax_harness/editor.py` - Daemon-tmux lifecycle; replace readiness polling with daemon status checks plus tmux renderer verification.
- `test/ui/tmax_harness/assertions.py` - Add assertions for TUI client connected, ready, render count advanced, and no daemon/client errors.
- `test/ui/tmax_harness/types.py` - Add frozen dataclasses for status/client/frame payloads if parsing in Python rather than using raw dicts.
- `test/ui/tests/01_startup.py` - Use new readiness assertions in startup coverage.
- `test/ui/tests/02_basic_editing.py` - Assert daemon eval changes are reflected in TUI frame status while renderer is connected.
- `test/ui/tests/03_mode_switching.py` - Assert frame mode and global editor mode stay synchronized through daemon operations.
- `rules/ui-testing.md` - Document daemon-only vs daemon-tmux responsibilities and the new observability-first readiness workflow.

### New Files
- `src/server/observability.ts` - Optional helper module for immutable observability records, event updates, and status shaping if `server.ts` becomes too large.
- `test/unit/server-observability.test.ts` - Unit/integration tests for status payloads, client identity, frame readiness, and sync diagnostics.
- `test/ui/tests/04_daemon_tmux_observability.py` - End-to-end daemon-tmux test focused on TUI readiness, render counts, and diagnostic payloads.

## Implementation Plan
### Phase 1: Foundation
Define the daemon observability data model and protocol shape. Track server start time, connected clients, client type, frame ownership, frame readiness, render counts, request counts, last request/render timestamps, last sync direction, and recent errors. Add structured JSON-RPC methods without changing existing `ping`, `eval`, `open`, `keypress`, or `render-state` behavior.

### Phase 2: Core Implementation
Teach the TUI client and `RemoteEditor` to identify as `clientType: "tui"` and report readiness events. Add daemon request handlers for status and lifecycle events. Add `tmaxclient` CLI flags that return human-readable output by default and JSON output for harness use.

### Phase 3: Integration
Update the Python harness to use daemon status for daemon-tmux readiness. The harness should wait for a TUI frame with `ready: true`, `firstRenderAt` set, `rawModeReady: true`, and `renderCount >= 1`, then use tmux capture only to validate that the renderer output is visible. Update tests and docs to make daemon-only the default logic-test mode and daemon-tmux the strict renderer-test mode.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Define Observability Payloads
- Add a protocol shape for server status responses.
- Include top-level fields: `daemonReady`, `uptimeMs`, `socketPath`, `clientCount`, `frameCount`, `activeFrameId`, `editor`, `clients`, `frames`, `recentErrors`.
- Include editor snapshot fields: `mode`, `currentFilename`, `bufferName`, `cursorPosition`, `statusMessage`.
- Include client fields: `id`, `clientType`, `connectedAt`, `lastRequestAt`, `requestCount`, `lastError`, `frameId`.
- Include frame fields: `id`, `clientId`, `clientType`, `ready`, `mode`, `currentFilename`, `cursorPosition`, `lastRenderAt`, `firstRenderAt`, `renderCount`, `rawModeReady`, `terminalSize`, `lastSyncDirection`, `lastSyncAt`, `lastError`.

### Step 2: Track Server Start Time and Recent Errors
- Add `startedAt` to `TmaxServer`.
- Add a bounded `recentErrors` list with timestamps, source, message, and optional frame/client id.
- Record JSON-RPC processing errors, client socket errors, and lifecycle event errors.

### Step 3: Track Client Identity
- Extend `connect-frame` params to accept `clientType`, `clientName`, and optional metadata.
- Default unidentified JSON-RPC clients to `clientType: "cli"`.
- Track `tmaxclient --eval` style requests separately from TUI frame clients where possible.
- Update `ClientConnection` metadata in `src/server/server.ts`.

### Step 4: Track Frame Ownership and Sync Diagnostics
- Associate each frame with its owning client id and client type.
- Track `lastSyncDirection` as `"frame-to-editor"` or `"editor-to-frame"`.
- Track `lastSyncAt` on every sync.
- Ensure daemon-originated mutations still call `syncEditorToAllFrames()` so TUI frame state follows daemon eval/open/insert changes.

### Step 5: Add Lifecycle Event RPC
- Add a JSON-RPC method such as `client-event`.
- Support events: `tui-started`, `first-render`, `raw-mode-ready`, `render`, `resize`, `error`, `shutdown`.
- Update client/frame observability records from these events.
- Return `{ ok: true }` for successful event recording.

### Step 6: Add Status RPC Methods
- Add JSON-RPC `status` returning the full structured payload.
- Add JSON-RPC `clients` returning client records.
- Add JSON-RPC `frames` returning frame records.
- Keep existing `ping` lightweight and backward compatible.
- Update the existing `server-info` command to either call the new status builder or return a compatible subset with correct uptime.

### Step 7: Update RemoteEditor Client Identity
- Change `RemoteEditor.start()` to call `connect-frame` with `{ clientType: "tui", clientName: "tmax-tui" }`.
- Store and expose both `clientId` and `frameId` if returned by the daemon.
- Add a `sendEvent()` helper for lifecycle events.

### Step 8: Update TUI Readiness Reporting
- In `src/client/tui-client.ts`, send `tui-started` after frame creation and initial state load.
- Send `first-render` immediately after the first successful render.
- Enable raw mode before reporting `raw-mode-ready`.
- Send `render` events on initial render and poll-driven renders, including terminal dimensions.
- Wrap startup and render errors so `error` events reach the daemon before process exit when possible.

### Step 9: Update tmaxclient CLI
- Add `--status`, `--clients`, and `--frames`.
- Add `--json` to print raw JSON for status-like commands.
- Keep existing plain output readable for humans.
- Ensure status commands exit non-zero on daemon errors and zero on successful responses.

### Step 10: Update Python Client Wrapper
- Add `status(config)`, `clients(config)`, and `frames(config)` functions in `test/ui/tmax_harness/client.py`.
- Parse JSON output through `json.loads`.
- Return `Result[dict, HarnessError]` or frozen dataclasses if added to `types.py`.
- Preserve existing `eval_expr` and `ping` behavior.

### Step 11: Update Daemon-Tmux Readiness
- In `test/ui/tmax_harness/editor.py`, wait for daemon `status` to show at least one TUI frame for the test client.
- Require `ready: true`, `firstRenderAt`, `rawModeReady: true`, and `renderCount >= 1`.
- Verify the pane command is the TUI client process.
- Capture tmux pane output only after daemon readiness is satisfied.
- On failure, include status JSON, pane command, pane output, daemon recent errors, and frame/client errors in the `HarnessError.details`.

### Step 12: Add Observability Assertions
- Add `assert_tui_connected`.
- Add `assert_tui_ready`.
- Add `assert_render_count_at_least`.
- Add `assert_no_client_errors`.
- Add `assert_frame_editor_sync`.
- Use these assertions in startup and mode-switching tests.

### Step 13: Add Unit Tests
- Create `test/unit/server-observability.test.ts`.
- Test that `status` returns daemon metadata with no clients.
- Test that `connect-frame` registers a TUI client/frame.
- Test that lifecycle events update readiness and render counts.
- Test that daemon eval mutations sync editor state to frames.
- Test that recent errors are bounded and included in status.

### Step 14: Add Daemon-Tmux Integration Test
- Create `test/ui/tests/04_daemon_tmux_observability.py`.
- Start in `TMAX_UI_TEST_MODE=daemon-tmux`.
- Assert TUI connected and ready via daemon status.
- Assert tmux pane renders visible editor output.
- Perform a daemon eval mode change and assert both global editor state and frame state reflect it.
- Assert render count advances after a state change.

### Step 15: Update Documentation
- Update `rules/ui-testing.md` to document the observability-first daemon-tmux lifecycle.
- Document that daemon-only tests use client/daemon workflow and daemon-tmux tests add renderer verification.
- Document recommended failure artifacts: status JSON, frame list, recent errors, pane command, pane capture.
- Update README client command list with `tmaxclient --status`, `--clients`, `--frames`, and `--json` if appropriate.

### Step 16: Run Validation Commands
- Run every command listed in the Validation Commands section.
- Fix all failures before marking the feature complete.

## Testing Strategy
### Unit Tests
- Verify status payload shape and stable field names.
- Verify server uptime is monotonic and non-negative.
- Verify client identity defaults for CLI requests and explicit identity for TUI frames.
- Verify lifecycle events mutate the intended frame/client record.
- Verify `render-state` and daemon eval/open/insert preserve editor/frame synchronization.
- Verify recent errors are recorded and bounded.

### Integration Tests
- Run daemon-only Python tests to confirm logic tests do not require tmux.
- Run daemon-tmux Python tests to confirm the TUI client becomes explicitly ready.
- Use `tmaxclient --status --json` during a live daemon-tmux test to verify connected TUI frame metadata.
- Confirm tmux capture is used only after daemon status reports renderer readiness.

### Edge Cases
- TUI process exits before raw mode readiness.
- TUI connects but never renders.
- TUI renders once but then stops polling.
- Multiple TUI frames connect simultaneously.
- CLI eval client connects while a TUI frame is active.
- Frame disconnects while status is requested.
- Daemon eval changes mode while TUI render polling is active.
- tmux window exists but pane command is a shell rather than TUI.
- Status command is requested with no clients connected.

## Acceptance Criteria
- `tmaxclient --status --json` returns structured daemon, client, frame, editor, and error metadata.
- `tmaxclient --clients --json` returns connected clients with client type and request metadata.
- `tmaxclient --frames --json` returns frame readiness, render, mode, cursor, buffer, and sync metadata.
- TUI clients identify as `clientType: "tui"` and report first render and raw-mode readiness.
- Daemon-tmux harness startup waits for daemon-reported TUI readiness before running test actions.
- Daemon-tmux harness failures include status JSON, recent errors, pane command, and pane capture.
- Daemon-only Python tests continue to pass without tmux.
- Daemon-tmux Python tests pass with a real TUI renderer running in tmux.
- Existing `--ping`, `--eval`, `--server-info`, file open, and TUI workflows remain backward compatible.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun test test/unit/server-observability.test.ts` - Run observability unit tests
- `bun test test/unit/test-tlisp-testing-framework.test.ts` - Verify T-Lisp testing framework still passes
- `cd test/ui && uv run python tests/01_startup.py` - Run daemon-only startup test
- `cd test/ui && uv run python tests/02_basic_editing.py` - Run daemon-only editing test
- `cd test/ui && uv run python tests/03_mode_switching.py` - Run daemon-only mode test
- `cd test/ui && TMAX_UI_TEST_MODE=daemon-tmux uv run python tests/01_startup.py` - Run daemon-tmux startup readiness test
- `cd test/ui && TMAX_UI_TEST_MODE=daemon-tmux uv run python tests/02_basic_editing.py` - Run daemon-tmux editing test
- `cd test/ui && TMAX_UI_TEST_MODE=daemon-tmux uv run python tests/03_mode_switching.py` - Run daemon-tmux mode sync test
- `cd test/ui && TMAX_UI_TEST_MODE=daemon-tmux uv run python tests/04_daemon_tmux_observability.py` - Run daemon-tmux observability integration test
- `bin/tmax --daemon & sleep 2; bin/tmaxclient --status --json; bin/tmaxclient --clients --json; bin/tmaxclient --frames --json; bin/tmax --stop` - Verify CLI status commands against a live daemon

## Notes
No new dependency is required. The implementation should use the existing JSON-RPC protocol, Bun runtime, Python stdlib JSON parsing, and current `uv run` harness execution.

Do not use daemon-tmux status endpoints as a replacement for visual renderer assertions. The daemon should prove that a TUI client is connected and ready; tmux capture should still prove that the renderer surface is actually visible.
