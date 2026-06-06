# Bug: Frame sync race in `handleRenderState` overwrites daemon editor state

## Bug Description
Test 16 (`16_buffer_completion.py`) fails on 3 assertions: buffer switch via `C-x b`, `C-g` cancel, and M-x rendering. The root cause is a race condition between two concurrent daemon operations:

1. The test sends keys via `--key` (no `frameId`) which mutates the daemon editor directly, then calls `syncEditorToAllFrames()` to push state to frames.
2. The TUI client polls `render-state` periodically with its `frameId`. Each poll calls `handleRenderState()` which calls `syncFrameToEditor(frame)` — copying the frame's **stale** state back onto the editor, undoing the buffer switch.

The frame's state lags behind the editor because it was last synced before the key was processed. When the TUI polls `render-state` between a `--key` mutation and the frame being updated, the stale frame overwrites the fresh editor state.

## Problem Statement
`handleRenderState()` unconditionally syncs frame → editor before returning state. This is wrong: `render-state` is a **read** operation. It should reflect the editor's current state, not mutate it. The sync-to-editor logic already exists in `handleKeypress()` (which is the correct place for it), so the sync in `handleRenderState` is both redundant and destructive.

## Solution Statement
Remove the `syncFrameToEditor(frame)` call from `handleRenderState()`. Instead, sync editor → frame (the forward direction) before returning state so the frame snapshot stays fresh. This makes `render-state` a pure read + forward-sync rather than a backward sync that clobbers editor state.

## Steps to Reproduce
1. Start daemon + TUI client in tmux (`mode_override: "daemon-tmux"`)
2. Create buffers: `(buffer-create "alpha-notes")` `(buffer-create "beta-log")`
3. Send `C-x b` via `--key` (no frameId)
4. Type buffer name and press Enter
5. Check `(buffer-current)` — expected `alpha-notes`, actual `completion-test.txt` (stale state wins)
6. The TUI's periodic `render-state` poll with `frameId` clobbers the editor between steps 3–5

## Root Cause Analysis
In `src/server/server.ts:859-865`:
```typescript
private async handleRenderState(params: any): Promise<any> {
    if (params?.frameId) {
      const frame = this.getFrame(params.frameId);
      this.syncFrameToEditor(frame);  // BUG: copies stale frame → editor
    }
    return editorStateToJson(this.editor.getEditorState());
}
```

`syncFrameToEditor` (line 199) overwrites the editor's `currentBuffer`, `mode`, `cursorPosition`, `minibufferState`, etc. with the frame's snapshot. When `--key` operates without a `frameId` (line 842), it mutates the editor directly and syncs to all frames. But if the TUI's render-state poll arrives before the frame gets updated, it copies stale frame state back to the editor, undoing the mutation.

## Relevant Files

- `src/server/server.ts` — Contains `handleRenderState()` (line 859) with the bug, `handleKeypress()` (line 825) for reference, and `syncFrameToEditor()` / `syncEditorToFrame()` sync helpers
- `test/ui/tests/16_buffer_completion.py` — The failing test that reproduces the race condition

## Step by Step Tasks

### Fix `handleRenderState` to sync editor → frame instead of frame → editor

**User Story**: As a test harness developer, I want `render-state` to be a read-only operation so that concurrent key operations are not clobbered by stale frame state.

- In `handleRenderState()`, replace `syncFrameToEditor(frame)` with `syncEditorToFrame(frame)` — this pushes the editor's current (fresh) state to the frame snapshot before serializing
- Remove the `syncFrameToEditor` call entirely; `render-state` should not mutate the editor

**Acceptance Criteria**:
- [ ] `handleRenderState` no longer calls `syncFrameToEditor`
- [ ] `handleRenderState` syncs editor → frame (forward direction) when a frameId is provided
- [ ] Test 16 passes all assertions
- [ ] All other UI tests (01–15) continue to pass
- [ ] All daemon tests continue to pass

### Run validation suite

**User Story**: As a developer, I want confidence that the fix resolves the bug without regressions.

- Run the full UI test suite
- Run the full daemon test suite
- Run typecheck

**Acceptance Criteria**:
- [ ] `bun run test:ui` — 16/16 tests pass
- [ ] `bun run test:daemon` — 11/11 tests pass
- [ ] `bun run typecheck` — zero errors

## Validation Commands
```bash
bun run test:ui        # All 16 UI tests must pass
bun run test:daemon    # All 11 daemon tests must pass
bun run typecheck      # Zero type errors
```

## Notes
- The `syncFrameToEditor` call in `handleKeypress` (line 836) is correct and must remain — when a keypress comes with a `frameId`, we want to sync that frame's state to the editor before processing the key, so the key operates on the frame's view of the world.
- The fix is a one-line change: swap `syncFrameToEditor(frame)` for `syncEditorToFrame(frame)` in `handleRenderState`.
