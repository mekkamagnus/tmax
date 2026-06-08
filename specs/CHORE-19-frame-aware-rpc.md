# Chore: Frame-Aware RPC Methods

## Chore Description
Make all mutating RPC methods in the daemon frame-aware by applying the sync-frame-to-editor → execute → sync-editor-to-frame pattern that `handleKeypress` already uses correctly. Currently only `handleKeypress` properly syncs per-frame state. `handleEval`, `handleInsert`, `handleOpen`, and `handleCommand` either broadcast to all frames indiscriminately or ignore frame state entirely, causing `--eval`, `--command`, and `--insert` to operate on the wrong buffer when a frame is active.

This is a long-term architectural fix: every RPC method that mutates editor state will respect frame-local buffers, cursors, and modes.

## Relevant Files

- `src/server/server.ts` — All RPC handlers live here. Contains `syncFrameToEditor`, `syncEditorToFrame`, `syncEditorToAllFrames`, `handleEval`, `handleInsert`, `handleOpen`, `handleCommand`, `handleKeypress`, `resolveFrame`. This is the only file that needs source changes.
- `bin/tmaxclient` — Already supports `--frame FRAME_ID` for `--key`, `--keys`, `--command`. Needs to pass `frameId` for `--eval`, `--insert`, `--script` too.
- `test/unit/ast-ops.test.ts` — Existing test that will validate AST operations work through the frame path.
- `test/unit/daemon-capture-parity.test.ts` — Existing daemon test that exercises `connect-frame` + `capture`.

## Step by Step Tasks

### Add `resolveFrameOrUndefined` helper to server.ts
- The existing `resolveFrame` throws if no frame exists. For methods that should work both with and without frames (like `eval`), add a non-throwing variant that returns `Frame | undefined`.
- This lets methods gracefully fall back to global editor state when no frame is active.

### Make `handleEval` frame-aware
- Currently: runs T-Lisp on the global editor, then broadcasts to all frames.
- Fix: if a frame is available (via `params.frameId` or `activeFrameId`), use the sync pattern:
  ```
  syncFrameToEditor(frame)
  result = interpreter.execute(code)
  syncEditorToFrame(frame)
  ```
- If no frame, keep the current global behavior + `syncEditorToAllFrames()`.
- Pass `frameId` from tmaxclient when `--frame` or `--eval` is used on an active frame.

### Make `handleInsert` frame-aware
- Same pattern as handleEval: sync frame → execute insert → sync back.
- If no frame, keep global behavior.

### Make `handleOpen` frame-aware
- When a frame exists, after creating the buffer and setting state, also update the frame's `currentBuffer` and `currentFilename` via `syncEditorToFrame`.
- Then call `syncEditorToAllFrames()` to propagate to other frames too.

### Make `handleCommand` frame-aware
- Currently does zero frame sync.
- Apply the same sync pattern: sync frame → execute command → sync back.
- If no frame, keep current behavior.

### Make `handleCapture` use `resolveFrame` consistently
- Already partially frame-aware (uses `frameToEditorState`), but clean up to use `resolveFrameOrUndefined` for consistency.

### Wire `--eval` and `--insert` to pass frameId in tmaxclient
- In `bin/tmaxclient`, when `--eval` or `--insert` is called and `frameTarget` is set (or an active frame exists), include `frameId` in the RPC params.
- For `--eval` without explicit `--frame`, the daemon will use `activeFrameId` automatically.

### Validate
- Run typecheck
- Run full test suite
- Live test: `tmax --eval '(buffer-text)'` returns the frame's buffer, not `*scratch*`
- Live test: `tmax --eval '(ast-node-kind)'` returns a node type instead of null

## Validation Commands
- `bun run typecheck` — Zero type errors
- `bun test` — All tests pass, zero failures
- `bun src/main.tsx --daemon &` then `bun src/client/tui-client.ts src/tlisp/core/completion/minibuffer.tlisp` then `bun bin/tmaxclient --eval '(buffer-text)'` — Returns frame's buffer content, not empty
- `bun bin/tmaxclient --eval '(ast-node-kind)'` — Returns a symbol instead of null
- `bun bin/tmaxclient --capture` — Still works correctly with frame-aware capture

## Notes
- The key principle: **read frame → execute on editor → write back to frame**. This is exactly what `handleKeypress` already does.
- `syncEditorToAllFrames()` should only be used when there's no specific frame (global operations). When a frame is targeted, use the per-frame sync to avoid clobbering other frames' state.
- The `--frame` flag in tmaxclient already works for `--key`, `--keys`, `--command`. This chore extends it to `--eval` and `--insert`.
- Backward compatibility: when no frame is connected (daemon-only mode), all methods fall back to the global editor state. No behavior change for that path.
