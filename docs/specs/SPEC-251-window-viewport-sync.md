# Bug Fix: Split Panes Render From a Frozen Viewport — Cursor Invisible in All Panes (#258)

## Goal

Split panes must render from a live viewport: the focused pane follows the model cursor with the same self-healing semantics as the single-window path, and a pane's view survives focus switches instead of snapping back to its creation-time scroll position.

GitHub issue: #258 (window-management, priority:high)

## Problem Statement

Two sources of truth for the viewport, synced one-way only:

- `Window.viewportTop` is written once at window creation (split snapshot in `src/editor/api/window-ops.ts`, first-window init in `src/editor/editor.ts`). Scrolling only moves the model cursor; nothing writes the effective viewport back to the window record.
- The multi-window render path (`src/frontend/render/buffer-lines.ts`) reads `win.viewportTop` for every cell, while the single-window path uses the self-healing `getVisibleViewportTop(state, height)` which clamps the viewport around the cursor. So after `C-w s` + `G`, both panes still show the top of the file and the cursor is off-screen everywhere.

A secondary geometry flaw compounds the symptom: `computeLayout` overlaps pane content with separator rows/columns (pane i's last row is cell i+1's separator), so a cursor clamped to the pane's last row is overdrawn by the separator and remains invisible.

## Solution

1. **Single source of truth**: move `getVisibleViewportTop` to `src/core/viewport.ts` (pure, layering-clean); `buffer-lines.ts` re-exports it for existing importers.
2. **Render path**: in the multi-window branch, the focused cell uses `getVisibleViewportTop(state, cell.height)` and the model `viewportLeft` (identical semantics to the single-window path); unfocused cells keep rendering from their own window record.
3. **Focus switch sync**: `setCurrentWindowIndex` now routes through `Editor.switchWindow(index)`, which (a) persists the leaving window's effective viewport (`getVisibleViewportTop` with the pane's stored height) and `viewportLeft` into its record, and (b) restores the target window's `viewportTop`/`viewportLeft` into the model. Switching to the already-focused window is a full no-op (restoring the record's creation-time viewport would spuriously reset the model's scroll). Buffer/cursor rebinding on focus switch is a separate issue (#262) and is deliberately not touched here.
4. **Separator reservation**: `computeLayout` reserves one row/column between panes so separators occupy their own gap and never overdraw pane content.
5. **ANSI-aware cell placement** (found by the verify-gate: the reserved separator column exposed two latent placement bugs in the multi-window render loop): cell rows are now placed at `cell.x` with exact visual width (`sliceToVisualWidth`/`padAnsiToWidth`/`sliceFromVisualOffset` composition), and the separator overlay overwrites by visual column — the previous code wrote every cell at column 0 (so vertical pane 1 clobbered pane 0) and spliced raw JS indices into ANSI-bearing rows (truncating mid-escape).

Out of scope: per-window buffer/cursor rebind on focus switch (#262), stored-dimension layout honoring resize/balance (#259), layout tree (#260).

## Completion Criteria

1. With two stacked panes on a 61-line buffer and the cursor on the last line, the focused pane renders lines around the cursor (the cursor is visible on a content row, not overdrawn by a separator), verified by `test/unit/window-viewport.test.ts` ("focused pane scrolls to keep the cursor visible").
2. The unfocused pane continues to render from its own `Window.viewportTop` record and does not scroll with the model cursor, verified by `test/unit/window-viewport.test.ts` ("unfocused pane renders from its own window record").
3. After moving the cursor deep into the buffer and switching focus (`window-next`), the leaving window's record holds the effective (clamped) viewport, verified by `test/unit/window-viewport.test.ts` ("switching focus records the effective viewport in the leaving window").
4. Switching back (`window-prev`) restores the target window's viewport into the model state, verified by `test/unit/window-viewport.test.ts` ("switching back restores the target window's viewport into the model"). A same-window focus switch must not disturb the model viewport ("same-window focus switch is a no-op — model viewport preserved").
5. Separators no longer overlap pane content: with n horizontal panes (verified for n=2 and n=3), each separator occupies its own terminal row, pane cells do not include it, and the `─` separator glyph is actually drawn on that row; with vertical splits, the reserved separator column (`│` at the boundary column of every row) separates the panes' content, which renders from its own origins (`cell.x`) — verified by the separator assertions in `test/unit/window-viewport.test.ts`.
6. All pre-existing window/viewport behavior is preserved: `test/unit/window-splitting.test.ts`, `test/unit/window-resizing.test.ts`, `test/unit/viewport-scroll-wrap.test.ts`, and `test/unit/capture-frame.test.ts` pass, and `bun run typecheck:src` is clean.
