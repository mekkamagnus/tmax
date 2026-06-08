# Frame-Aware RPC Methods

## Status

Accepted

## Context

The daemon supports multiple clients connecting as "frames" (Emacs-style), each with its own buffer, cursor, and mode state. Only `handleKeypress` properly synced frame-local state before executing — it followed the pattern: sync frame to editor, execute, sync editor back to frame. All other mutating RPC methods (`handleEval`, `handleInsert`, `handleOpen`, `handleCommand`) either broadcast to all frames indiscriminately or ignored frame state entirely. This caused `--eval`, `--insert`, and `--command` to operate on the wrong buffer when a frame was active.

## Decision

Apply the three-step sync pattern to all mutating RPC methods:

1. **`resolveFrameOptional`** — Non-throwing variant of `resolveFrame` that returns `Frame | undefined`, letting methods gracefully fall back to global editor state when no frame is active.

2. **Frame-aware handlers** — Each handler checks for a frame (via `params.frameId` or `activeFrameId`). If found: `syncFrameToEditor(frame)` → execute → `syncEditorToFrame(frame)`. If not found: execute on global state → `syncEditorToAllFrames()`.

3. **Client-side `frameId` passthrough** — `tmaxclient` passes `frameId` for `--eval`, `--insert`, `--insert-stdin` when `--frame` is specified (already worked for `--key`, `--keys`, `--command`).

Backward compatible: when no frame is connected (daemon-only mode), all methods fall back to global editor state with no behavior change.

## Consequences

- `--eval '(buffer-text)'` now returns the frame's buffer content, not the global `*scratch*`.
- `--insert` and `--command` target the correct frame-local buffer.
- Every future mutating RPC method should follow the same sync pattern.
- `syncEditorToAllFrames()` is only used when there's no specific frame — per-frame sync avoids clobbering other frames' state.
