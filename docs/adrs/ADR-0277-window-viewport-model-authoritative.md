# ADR-0277: Model Cursor Is Authoritative for the Focused Pane's Viewport

## Status

Accepted

## Context

Issue #258: after `C-w s` (split) + `G` (go to last line), both panes kept rendering the top of the file and the cursor was invisible in every pane. Root cause: two sources of truth for the viewport, synced one-way only.

- `Window.viewportTop` was written once at window creation (split snapshot in `window-ops.ts`, first-window init in `editor.ts`). Scrolling moves only the model cursor (`state.cursorPosition`) — nothing wrote the effective viewport back to the focused window's record.
- The multi-window render path (`buffer-lines.ts`) read the frozen `win.viewportTop` for every pane, while the single-window path used the self-healing `getVisibleViewportTop(state, height)` which clamps the viewport around the model cursor.
- A geometry flaw compounded the symptom: `computeLayout` gave pane i's last row the same screen row as pane i+1's separator, so a cursor clamped to the pane's final row was overdrawn and stayed invisible even with a correct viewport.

## Decision

1. **The model is authoritative for the focused pane.** In the multi-window render path, the focused cell computes its viewport with `getVisibleViewportTop(state, cell.height)` and the model `viewportLeft` — identical semantics to the single-window path. Unfocused panes render from their own window record (frozen while unfocused, matching vim/emacs behavior).
2. **Single shared viewport clamp.** `getVisibleViewportTop` moved to `src/core/viewport.ts` (pure function over `EditorState`); `buffer-lines.ts` re-exports it so existing importers (assam, tui-client, capture-frame, tests) are unchanged. The editor now uses the same function — no duplicated clamp math.
3. **Focus switch syncs the viewport both ways.** `setCurrentWindowIndex` routes through `Editor.switchWindow(index)`, which persists the leaving window's effective viewport (clamped with the pane's stored height) and `viewportLeft` into its record, then restores the target window's `viewportTop`/`viewportLeft` into the model. Without the save-on-leave, a scrolled pane snapped back to its creation-time scroll position the moment it lost focus. Switching to the already-focused window is a full no-op — restoring the record's creation-time viewport would spuriously reset the model's scroll (visible to model-state readers like `(viewport-top)` even though the render path self-heals).
4. **Separators get their own rows/columns.** `computeLayout` reserves one row (horizontal splits) or column (vertical splits) between panes so separators never overdraw pane content.
5. **Cell placement is ANSI-aware and honors `cell.x`.** The verify-gate's vertical-split probe exposed two latent placement bugs the reserved separator column made visible: the multi-window render loop wrote every cell's row at column 0 (so a vertical pane 1 clobbered pane 0) and spliced raw JS string indices into ANSI-bearing rows (truncating mid-escape). Cell rows now compose by visual column with the shared width primitives (`sliceToVisualWidth` / `padAnsiToWidth` / `sliceFromVisualOffset`), and the separator overlay overwrites by visual column the same way.

Deliberately out of scope: per-window buffer/cursor rebind on focus switch (#262 — the model cursor still belongs to the leaving window after a switch until #262 lands), stored-dimension layout honoring (#259), layout tree (#260).

## Consequences

- Split panes scroll: the focused pane keeps the cursor visible; the cursor line renders on a content row, never under a separator.
- Unfocused panes hold their scroll position across focus round-trips instead of snapping back.
- `getVisibleViewportTop` has one definition; renderers and the editor cannot drift apart (the one-way sync drift was the bug).
- Pane geometry changes: n panes now occupy n content rows/cols + (n−1) separator rows/cols (previously separators stole a row from the pane above). Any code assuming panes tile the terminal with no gaps must use `computeLayout`'s cell rects.
- Vertical splits actually render side by side now: pane content is placed at its cell origin instead of every pane overwriting column 0, and rows keep exact visual width (no ANSI-truncated tails).
- After switching panes, the model cursor still reflects the leaving window's position until #262 rebinds buffer/cursor on focus switch; the entering pane renders around that cursor via the same self-healing clamp, which is consistent (if imperfect) until #262 lands.
- The saved viewport uses the leaving window's **stored** `height` (creation-time value), which can differ from the rendered cell height `computeLayout` assigns (e.g. 22 vs 11). The saved record is therefore an approximation — masked in practice because re-focusing a pane re-clamps through the same self-healing clamp. Exact fidelity arrives with #259's stored-dimension layout.

## Related

- [SPEC-251](../specs/SPEC-251-window-viewport-sync.md), issue #258
- #262 (focus switch must rebind buffer/cursor — consumes `switchWindow` as its natural insertion point), #259 (layout ignores stored dimensions), #260 (layout tree)
