# Bug Fix: Switching Pane Focus Does Not Rebind the Current Buffer — Edits Land in the OTHER Pane's Buffer (#262)

## Goal

Switching window focus must rebind the editor's editing context to the focused pane: the model's current buffer, filename, cursor, and viewport all come from the entering window's record, and the leaving window's context is persisted to its record first. Typing while a pane is focused must always edit the buffer that pane displays.

GitHub issue: #262 (window-management, priority:high)

## Problem Statement

`window-next`/`window-prev` only changed `currentWindowIndex`. Buffer, cursor, and viewport sync was one-way model → window record (`setCurrentBuffer` context method, `setCursorLine`/`setCursorColumn`, `switchBufferSilent` — all mutate the *focused* window's record). Nothing restored window → model on focus change, so after focusing a pane the model still held the *previous* pane's buffer: keystrokes edited the unfocused pane's buffer, and the focused pane (which renders `state.currentBuffer`) displayed the typed text live, making it look like a normal in-place edit. Data-loss-adjacent: the user's text can end up on screen nowhere (visible in the issue repro).

#258 landed `Editor.switchWindow(index)` as the focus-switch seam (viewport persist/restore) and ADR-0277 named it the insertion point for this fix.

## Solution

Extend `Editor.switchWindow` to a full context rebind:

1. **Persist on leave**: the leaving window's record receives the model's current editing context — `buffer` + `bufferName` (via `findBufferName`), `cursorLine`/`cursorColumn` from `model.cursorPosition` — alongside the #258 viewport persist (`getVisibleViewportTop` with the stored pane height, `viewportLeft`).
2. **Restore on entry**: the model receives the target window's record — `SetCurrentBuffer(target.buffer)`, `SetCurrentFilename` from `bufferMetadata` for the target's `bufferName`, `SetCursorPosition` (clamped to the target buffer's line count, guarding the #127 out-of-bounds-insert class), then `SetCurrentWindowIndex` + the #258 viewport restores.
3. Semantics deliberately match `buffer-switch` (buffer + filename metadata; no major-mode re-derivation, no recency touch — both are also skipped by `switchBufferSilent`), except the cursor is *restored from the window record* (per-window cursor memory, vim/emacs `window-point` style) rather than reset to (0,0).
4. Same-window re-switch stays a no-op, refined to be buffer-aware: a same-index call no-ops only when the model already edits the target window's buffer (single-pane `window-next`), so a same-index call after `window-close` (a different window in the slot) still rebinds (#258's guard could not distinguish the two).
5. `window-close` always rebinds: after removing the focused window, the model adopts the surviving window that occupies the closed slot (or the last one) — closing a focused non-last window previously left the model editing the *closed* window's buffer (same #262 class; found by the verify-gate). The leave-save is skipped when the occupant of the leaving index is a different pane whose record must keep its own context.
6. **The record-sync invariant is closed** (verify-gate round 2): the rebind's correctness requires every model-buffer mutation to rebind the focused window record. Two paths violated it and now comply — (a) the tab-switch buffer callback (`createTabOps` `switchToBuffer`) syncs the focused record's `buffer`/`bufferName` like the `setCurrentBuffer` context method does, so a tab switch survives focus round-trips instead of being silently undone; (b) `delete-other-windows` absorbs the model's live cursor/viewport/buffer into the surviving window's record before the switch port restores from it, so collapsing to one pane keeps the model cursor where the user is instead of snapping to the record's last-saved position.

Out of scope: per-buffer major-mode activation on switch (matches current `buffer-switch` behavior), buffer-name display vs full-path lookup (issue "bonus" — separate concern), #259 (stored dimensions), #260 (layout tree), #261 (directional navigation).

## Completion Criteria

1. With two stacked panes where the focused bottom pane shows buffer `two` (cursor moved into it) and the top pane shows buffer `one`, `(window-next)` rebinds the model: `currentBuffer` is `one`'s buffer, the status-visible buffer name is `one`, and the cursor is the top window's saved position — verified by `test/unit/window-focus-rebind.test.ts` ("switching focus rebinds the model to the target window's buffer and cursor").
2. Edits after the switch land in the focused pane's buffer: inserting after `(window-next)` mutates `one`, and `two` is unchanged — verified by `test/unit/window-focus-rebind.test.ts` ("edits land in the focused pane's buffer").
3. The leaving window's context is persisted: after switching away from `two`, its record holds `bufferName` `two` and the moved cursor — verified by `test/unit/window-focus-rebind.test.ts` ("the leaving window's buffer binding and cursor are persisted").
4. Switching back restores `two` as the model buffer with its saved cursor — verified by `test/unit/window-focus-rebind.test.ts` ("switching back restores the target window's buffer and cursor").
5. A restored cursor is clamped to the target buffer's line count — a cursor saved on the buffer's last line restores exactly in-bounds and the next insert succeeds (no "Line N out of bounds") — verified by `test/unit/window-focus-rebind.test.ts` ("restored cursor is clamped to the target buffer").
6. All pre-existing behavior is preserved: `test/unit/window-viewport.test.ts` (7 tests, #258), `test/unit/window-splitting.test.ts`, `test/unit/window-resizing.test.ts`, and the full unit gate pass; `bun run typecheck:src` + `typecheck:test` are clean. Pre-existing ops keep their user-visible behavior across the rebind: `delete-other-windows` keeps the model cursor at the user's position ("delete-other-windows keeps the model cursor (kept record absorbed)") and a tab switch survives a focus round-trip ("a tab switch survives a focus round-trip"), both in `test/unit/window-focus-rebind.test.ts`.
7. Closing the focused pane rebinds the model to the surviving window: after `(window-close)` on a focused pane bound to buffer `two` with the survivor showing `one`, the model edits `one` and subsequent inserts land in `one` — verified by `test/unit/window-focus-rebind.test.ts` ("closing the focused pane rebinds the model to the survivor").
