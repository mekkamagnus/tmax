# Feature: Emacs-style Daemon/Client Parity

## Feature Description
Adjust the tmax daemon/client architecture to match the Emacs `emacs --daemon` / `emacsclient` workflow. Currently the daemon has a single global `EditorState` shared by all clients — meaning multiple TUI clients fight over one cursor/viewport/mode. This spec introduces a **Frame** abstraction (like Emacs frames) where each TUI client gets its own viewport state while sharing buffers and the T-Lisp interpreter. It also unifies the CLI entry point so `tmax` behaves like `emacs` — one binary that starts the daemon, creates frames, or evaluates expressions.

## User Story
As a tmax user
I want `tmax file.txt` to "just work" (auto-start daemon if needed, open a terminal frame showing my file)
So that the workflow matches muscle memory from Emacs and feels like a production editor

## Problem Statement
Four gaps vs Emacs:

1. **No per-frame state.** Daemon has one global `EditorState`. Two TUI clients corrupt each other's cursor/viewport/mode.
2. **`tmaxclient file.txt` doesn't reach a frame.** It loads a file into the daemon but no TUI sees it.
3. **No auto-daemon-start.** Users must manually run `bun src/server/server.ts` before using any client command.
4. **Scattered entry points.** `bun src/server/server.ts`, `bun src/client/tui-client.ts`, `bin/tmaxclient`, `bin/tmax` — no single unified `tmax` command.

## Solution Statement

### Frame abstraction
Introduce a `Frame` type in the daemon: each connected TUI client gets a `Frame` with its own `cursorPosition`, `viewportTop`, `mode`, `commandLine`, `mxCommand`, `currentFilename`, `currentBuffer` reference. Frames share the `buffers` Map, `T-Lisp interpreter`, `config`, and `*Messages*` log.

### Unified `tmax` CLI
Make `bin/tmax` the single entry point (currently exists but only launches `src/main.tsx`). Add subcommands:
- `tmax` (no args) — auto-start daemon if needed, then open a TUI frame
- `tmax file.txt` — auto-start daemon, open TUI frame with file
- `tmax --daemon` — start daemon only (no frame)
- `tmax -t` — open a new terminal frame (same as no-args when daemon running)
- `tmax -e '(expr)'` — evaluate T-Lisp (like `emacsclient -e`)
- `tmax --stop` — stop the daemon

### Frame-aware RPC
The `keypress` and `render-state` methods accept an optional `frameId`. If provided, the daemon operates on that frame's state. If omitted (CLI tools like `--eval`, `--insert`), the daemon uses the last-active frame or a headless default.

## Relevant Files

- `src/server/server.ts` — Add Frame class, frame-scoped RPC handlers, auto-daemon helpers
- `src/server/serialize.ts` — Serialize frame-specific state
- `src/client/tui-client.ts` — Send `frameId` with keypress/render-state, receive frame on connect
- `src/editor/remote-editor.ts` — Include `frameId` in requests
- `bin/tmax` — Rewrite as unified CLI dispatcher (bash script)
- `bin/tmaxclient` — Keep as low-level RPC tool (power users), add `frameId` support
- `src/core/types.ts` — Add `Frame` interface

### New Files
- None (all changes to existing files)

## Implementation Plan

### Phase 1: Frame type and daemon state
Define the `Frame` interface. Refactor `TmaxServer` to hold a `Map<string, Frame>` instead of a single `EditorState`. Each frame has its own cursor/viewport/mode but shares buffers and interpreter.

### Phase 2: Frame-aware RPC
Update `keypress`, `render-state` to be frame-scoped. Add `connect-frame` method that registers a new frame and returns its `frameId`. Update `open`, `insert`, `eval` to target the last-active frame when no `frameId` is given.

### Phase 3: Unified `tmax` CLI
Rewrite `bin/tmax` as a bash script that auto-starts daemon (background, no tmux requirement), then launches TUI client. Support `--daemon`, `-e`, `--stop` flags.

### Phase 4: TUI client frame registration
Update `tui-client.ts` and `remote-editor.ts` to register as a frame on connect, include `frameId` in all requests.

## Step by Step Tasks

### Add Frame interface to types

**User Story**: As the daemon, I need a Frame type to track per-client viewport state.

- In `src/core/types.ts`, add `Frame` interface:
  ```typescript
  export interface Frame {
    id: string;
    cursorPosition: Position;
    viewportTop: number;
    mode: EditorState["mode"];
    commandLine: string;
    mxCommand: string;
    currentFilename?: string;
    currentBuffer?: FunctionalTextBuffer;
    statusMessage: string;
    cursorFocus: 'buffer' | 'command';
    lastActivity: Date;
  }
  ```
- The daemon's `TmaxServer` holds `frames: Map<string, Frame>` alongside the shared `editor` (buffers + interpreter + config + messages)

**Acceptance Criteria**:
- [ ] `Frame` type defined with all per-viewport fields
- [ ] Shared resources (buffers, interpreter, config) stay on `Editor`

### Refactor TmaxServer to use frames

**User Story**: As the daemon, I need to manage multiple independent frame states.

- Add `frames: Map<string, Frame>` to `TmaxServer`
- Add `activeFrameId: string | null` tracking the last-interacted frame
- Add `createFrame()` method — creates a new Frame with default state, returns frameId
- Add `getFrame(id: string): Frame` — returns frame or throws
- Add `deleteFrame(id: string)` — cleanup on disconnect
- Modify `handleConnection` — when a client connects, if the client sends a `connect-frame` request, create a new frame
- Modify `handleKeypress` — accept `frameId` param, operate on that frame's state, update `activeFrameId`
- Modify `render-state` — return state for the given frame
- For CLI operations (`open`, `insert`, `eval`, `query`) without a frameId — use `activeFrameId` or a default "headless" frame

**Acceptance Criteria**:
- [ ] `createFrame()` returns a new frame with independent state
- [ ] Keypresses on different frames don't interfere
- [ ] CLI tools without frameId target the active frame

### Update serialize for frame-scoped state

**User Story**: As the wire protocol, I need to serialize per-frame state.

- Update `editorStateToJson` to accept either a full `EditorState` or construct one from a `Frame` + shared buffers
- Add `frameToEditorState(frame: Frame, buffers: Map, config: EditorConfig): EditorState` helper
- Keep `jsonToEditorState` unchanged (client doesn't need to know about frames)

**Acceptance Criteria**:
- [ ] `render-state` with `frameId` returns correct per-frame state
- [ ] Buffer content is shared across frames

### Update RemoteEditor to register as a frame

**User Story**: As a TUI client, I need to register as a frame and include frameId in requests.

- In `remote-editor.ts`, add `frameId: string` property
- In `start()`, send `connect-frame` request, store returned `frameId`
- In `handleKey()`, include `frameId` in keypress params
- In `refreshState()`, include `frameId` in render-state params

**Acceptance Criteria**:
- [ ] TUI client gets a unique frameId on connect
- [ ] All requests include frameId
- [ ] Multiple TUI clients get different frameIds

### Update tui-client.ts for frame support

**User Story**: As the TUI, I want to work with the new frame-aware protocol seamlessly.

- No changes needed in `tui-client.ts` itself — `RemoteEditor` handles frameId internally
- The TUI client continues to call `remote.handleKey(key)` and `remote.refreshState()` as before

**Acceptance Criteria**:
- [ ] TUI client works with frame-aware `RemoteEditor` without code changes

### Rewrite bin/tmax as unified CLI

**User Story**: As a user, I want `tmax file.txt` to just work — auto-start daemon, open TUI frame with my file.

- Rewrite `bin/tmax` (bash script) to support:
  - `tmax` — ensure daemon running, then exec TUI client
  - `tmax file.txt` — ensure daemon running, open file, then exec TUI client
  - `tmax --daemon` — start daemon only, exit
  - `tmax -e '(expr)'` — eval via tmaxclient (like emacsclient -e)
  - `tmax --stop` — stop daemon
  - `tmax --help` — show usage
- Auto-daemon logic:
  1. Ping socket `/tmp/tmax-$UID/server`
  2. If no response, start `bun src/server/server.ts` in background
  3. Wait for ping to succeed (up to 5 seconds)
  4. Proceed with requested action
- Keep `bin/tmaxclient` as a low-level tool (like raw emacsclient)

**Acceptance Criteria**:
- [ ] `tmax file.txt` starts daemon if needed, opens TUI with file
- [ ] `tmax --daemon` starts daemon only
- [ ] `tmax -e '(buffer-text)'` evaluates and prints result
- [ ] `tmax --stop` stops daemon gracefully

### Test multi-frame with tmax-pilot

**User Story**: As a developer, I want to verify multiple frames work independently.

- Start daemon, open two TUI frames, verify independent navigation
- Use `tmaxclient --eval` to modify buffer, verify both frames see the change
- Run full test suite to verify zero regressions

**Acceptance Criteria**:
- [ ] Two TUI frames can navigate different files independently
- [ ] Buffer changes from one frame are visible in the other
- [ ] Test suite passes with zero regressions

## Testing Strategy

### Unit Tests
- Test `createFrame()` creates independent state
- Test frame-scoped keypresses don't affect other frames
- Test shared buffer visibility across frames
- Test `activeFrameId` fallback for CLI operations

### Integration Tests
- Test full workflow: start daemon → connect TUI → open file → edit → save
- Test multi-frame: two TUI clients with independent navigation
- Test auto-daemon: `tmax file.txt` when daemon not running

### Edge Cases
- Frame disconnect — daemon cleans up frame, other frames unaffected
- No frames connected — CLI operations target headless default
- Daemon restart — all frames reconnect with new frameIds
- Very large files — shared buffer doesn't duplicate content per frame

## Acceptance Criteria
- `tmax file.txt` auto-starts daemon and opens TUI frame with file
- `tmax --daemon` starts headless daemon
- `tmax -e '(expr)'` evaluates T-Lisp without opening a frame
- Multiple `tmax` instances get independent frames (different cursors/viewports)
- Buffer edits in one frame are visible in all frames via shared buffer map
- `tmaxclient` remains functional as low-level tool
- `bun test` passes with zero regressions

## Validation Commands
- `bun test` — zero regressions
- `tmax --daemon && sleep 2 && tmax -e '(buffer-text)'` — daemon starts, eval works
- `tmax --stop` — daemon stops
- `tmax /tmp/test-frame.txt` — auto-starts daemon, opens TUI with file
- From another terminal: `tmax -e '(buffer-line-count)'` — shows line count from active frame

## Notes
- This is the largest refactor since the daemon was created. Consider implementing in a branch.
- The Frame type is intentionally a subset of EditorState — only viewport-local fields.
- Shared state (buffers, interpreter, config, messages) stays on the Editor instance.
- `bin/tmaxclient` keeps working as-is for tmax-pilot — it doesn't need frame awareness since it targets the active frame.
- Future enhancement: `tmaxclient -t` to create a new frame from within an existing session (like `emacsclient -t` from within Emacs).
