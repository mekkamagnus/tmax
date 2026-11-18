# Enhancement: Window-Management Hygiene Batch (#263)

## Goal

Six small window-management cleanups from the 2026-11-17 review, landed together with the window work they support: unique window IDs, a correct arity message, symmetric introspection (`window-width`, richer `window-list`), split minimums, a terminology docstring, and the unfocused `cursorColumn` pass-through.

GitHub issue: #263 (window-management, enhancement, priority:low)

## Problem Statement

- `id: window-${Date.now()}` collides for same-millisecond splits (macros, scripted eval) — and the render path keys panes by ID (`windows.find(w => w.id === cell.windowId)`).
- `window-balance`'s arity error says "balance-windows takes no arguments" (copy-paste from the alias).
- `window-height` exists but `window-width` does not; `window-list` exposes only `(window id line col)` — no bufferName or dimensions, which is what layout debugging needs.
- `split-window` would halve below the resize minimums (3 rows / 10 cols), producing over-subscribed stored sizes.
- `split-window`'s docstring doesn't warn about the Emacs-inherited inversion (`horizontal` = stacked, `vertical` = side-by-side).
- Unfocused panes render with `cursorColumn: 0` instead of their stored column.

## Solution

1. **Monotonic IDs**: an Editor-owned sequence (`window-1`, `window-2`, …) passed to `createWindowOps` as a minting callback — unique per editor instance by construction. **Restore-safe** (verify-gate round 1): workspace restore re-creates persisted IDs verbatim into the live editor, so `applyWorkspace` advances the sequence past the max numeric suffix among restored IDs — a post-restore split can never mint a duplicate of a restored pane (the exact collision class this issue set out to kill; the deterministic scheme made the vector possible where `Date.now()` could not collide cross-session).
2. **Arity message** names `window-balance`.
3. **`window-width <index>`** added (mirror of `window-height`); **`window-list`** rows widened to `(window id bufferName cursorLine cursorColumn height width)`.
4. **Split minimums enforced at split**: `split-window` throws when the divided dimension is below `2 × MIN` (3 rows / 10 cols — vim's refuse-to-split behavior; clamping instead would produce two over-subscribed half-panes). The post-split origin clamps become unnecessary (the guard guarantees both halves ≥ MIN) and are removed.
5. **Terminology docstring** on `split-window` pointing at the unambiguous `split-window-below`/`split-window-right` aliases.
6. **Unfocused `cursorColumn`** passes through `win.cursorColumn` (cosmetic symmetry — unfocused cursors never render; the render internals gate on `isCurrentLine` either way).

## Completion Criteria

1. Four same-millisecond splits produce five distinct window IDs — verified by `test/unit/window-hygiene.test.ts` ("rapid splits produce unique window IDs (no Date.now collisions)").
2. `(window-balance 1)` errors naming `window-balance`, not the alias — verified by `test/unit/window-hygiene.test.ts` ("window-balance arity error names the primitive, not the alias").
3. `(window-width i)` reads stored widths (and errors on a missing index); `(window-list)` rows carry `(window id bufferName cursorLine cursorColumn height width)` — verified by `test/unit/window-hygiene.test.ts` ("window-width reads a window's stored width", "window-list exposes bufferName and dimensions").
4. Splitting a pane below twice the pane minimum fails with "too small to split" and leaves the window count unchanged — verified by `test/unit/window-hygiene.test.ts` ("split-window refuses to halve below the pane minimum").
5. No regressions: all window suites (direction, focus-rebind, viewport, record-sync, stored-dims, splitting, resizing, cw-window-chords) and the full unit gate pass (observed to terminal summary, exit 0); `bun run typecheck:src` + `typecheck:test` are clean. The docstring and cursorColumn pass-through are code-review items (no behavioral test — unfocused cursors never render).
6. Restoring a workspace whose panes carry `window-N` IDs and then splitting produces four distinct IDs (no duplicate of a restored pane) — verified by `test/unit/window-hygiene.test.ts` ("a post-restore split cannot mint a duplicate of a restored ID").
