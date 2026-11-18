# Enhancement: Window Layout Tree — Mixed-Axis Splits (#260)

## Goal

Splits nest: `split-window` divides the **focused pane's frame**, so a vertical split of a top pane produces two columns *within that row* while the bottom pane keeps full width. Layout geometry comes from a persisted binary split tree.

GitHub issue: #260 (window-management, enhancement)

## Problem Statement

`windows` was a flat array and `computeLayout` picked one global axis (`windows.some(w => w.splitType === "vertical")`) — one vertical pane re-flowed every pane into columns. The issue's live repro: `C-w s` then `C-w v` produced three side-by-side columns instead of a split top row. `Window.row`/`col` existed but nothing set or read them.

## Solution

1. **`LayoutNode` binary split tree** (`core/contracts/editor.ts`): leaves reference windows by ID; split nodes carry `axis` + `ratio` (the first child's share of the divided extent) + two children. JSON-serializable. Lives on the model (`windowLayout`, `SetWindowLayout` update) and persists in `WorkspaceData.layout`.
2. **Tree layout** (`core/window-layout.ts`): `divideRect` is the single division-math source — one separator row/column per split node (#258 semantics generalized to nesting), floor-first ratio split, both children clamped to the pane minimums (3/10). `computeLayout(windows, W, H, tree?)` uses the tree when present; **without a tree the flat single-axis path applies unchanged** (legacy workspaces, direct unit calls). `renderSeparators` draws each split node's own boundary when a tree is present (nested panes are not adjacency-inferable).
3. **The flat `windows` array stays the leaf registry** — records, focus index, the #262 rebind seam, rotate, and close semantics are untouched. Cell-math (guards, introspection, navigation) reads `computeLayout(...)` with the *real* tree (never a fabricated one — fabricated geometry could diverge from the flat render path); `flatTree` materializes **only on the first split** of a tree-less state, with even ratios (i/(i+1)) so the materialized tree renders identically to the flat layout.
4. **Ops**: `split-window` grows the tree at the focused leaf (cell-based minimum guard); `window-close` prunes the leaf and collapses single-child splits (the sibling takes the parent's frame); `delete-other-windows` collapses to one leaf; `window-balance` resets every ratio to 0.5; `window-resize-height/-width` adjust the nearest enclosing same-axis split's ratio — **side-aware** (a pane under `second` shrinks the ratio to grow) — clamped to the minimums, then stored dims sync from cells; `window-height/-width/list` read authoritative cells. Single-window (bare-leaf tree) and tree-less states keep the legacy stored-dim resize path.
5. **Persistence**: `serializeWorkspace` carries `model.windowLayout`; `workspaceToData` writes `layout`; `dataToWorkspace` restores it; `applyWorkspace` prunes restored leaves that no longer resolve. Stored `Window.height/width` remain on the contract as an informational cache synced from cells after layout-affecting ops.
6. **`switchWindow`'s viewport clamp uses the cell height** (authoritative) with stored dims as fallback.

## Completion Criteria

1. The live repro: `C-w s` then `C-w v` nests — the top frame holds two side-by-side columns (column separator between them, equal heights), the bottom pane keeps the full 80 columns and 12 rows — verified by `test/unit/window-tree.test.ts` ("the live repro: C-w s then C-w v nests inside the focused pane", "rendered: the bottom pane spans the full width under two columns").
2. Closing a pane collapses its sibling into the freed frame (the surviving top pane re-expands to full width) — verified by `test/unit/window-tree.test.ts` ("closing a pane collapses its sibling into the freed frame").
3. Resize and balance operate on tree ratios with the side-aware sign (growing a pane under `second` shrinks the ratio); the minimum clamp holds — verified by `test/unit/window-tree.test.ts` ("resize and balance operate on tree ratios") and the reworked `window-resizing`/`window-stored-dims`/`vim-dispatch` expectations (cell semantics: the pair always tiles the content extent exactly).
4. The tree (structure + resized ratios) persists across a workspace save/load round-trip — verified by `test/unit/window-tree.test.ts` ("the tree persists across a workspace save/load round-trip").
5. Directional navigation crosses nested frames (`right` within the top row, then `down` to the full-width bottom pane) — verified by `test/unit/window-tree.test.ts` ("directional navigation crosses the nested frames").
6. No regressions: all eleven prior window suites (viewport, direction, focus-rebind, record-sync, stored-dims, splitting, resizing, hygiene, cw-chords, workspace-special-restore, vim-dispatch) and the full unit gate pass (observed to terminal summary, exit 0); `bun run typecheck:src` + `typecheck:test` are clean.

## Out of scope

Frame-relative fractions for daemon/client size authority (the tree stores ratios — already terminal-size-independent; per-client rendering uses each frontend's own size), per-tab window configurations (one global layout shared by tabs — unchanged), `C-w H/J/K/L` move-window (now implementable on the tree but a separate concern), terminal-resize re-fit beyond existing ratio math.
