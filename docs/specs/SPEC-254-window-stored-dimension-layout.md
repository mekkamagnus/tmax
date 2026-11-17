# Bug Fix: resize (C-w +/-/</>) and balance-windows (C-w =) Are Visually Inert — Layout Ignores Stored Dimensions (#259)

## Goal

`window-resize-height`/`window-resize-width`/`window-balance` must change the **rendered** geometry: panes tile the available space honoring their stored relative sizes, with #258's separator gaps, and a resize visibly moves the separator.

GitHub issue: #259 (window-management, priority:medium)

## Problem Statement

`computeLayout` distributed space evenly and never read `Window.height`/`Window.width`; the renderers consume only the computed cells. So resize/balance mutated stored dims that nothing rendered (live repro: `(window-resize-height 10)` moved `(window-height 0)` 42→52 while the separator row stayed at 19). SPEC-084's DoD asserted the stored value, not user-visible behavior. Compounding seed: `split-window` gave the new window `floor(dim/2)` but left the origin's stored dim at full size, so stored sizes summed past the terminal even before any resize.

## Solution

1. **`computeLayout` honors stored dims** (`src/frontend/render/window-layout.ts`): a `fitStoredSizes` helper scales the stored sizes **proportionally** to fill the available space exactly (a flat single-axis layout can only honor *relative* sizes), clamps each pane to its minimum (3 rows / 10 cols, mirroring the resize ops), keeps every pane ≤ available−(n−1)·min, and gives the rounding remainder to the last pane (clamping overshoot is taken back from the panes, newest first). Windows without a stored size default to an even share; degenerate space (below n minimums) falls back to even distribution. Separator rows/columns stay reserved (#258).
2. **`split-window` divides the pane**: the origin window's stored dimension shrinks to its half (`dim − new`, minimum-clamped), so stored sizes conserve the pre-split total instead of over-subscribing.
3. **Side effect (intended)**: stored dims now approximate the rendered cell sizes, dissolving ADR-0277's stored-height approximation caveat — `switchWindow`'s leave-save clamps with the stored height, which now matches the rendered pane (the #258 focus-sync tests' expected clamp changed 39→50 accordingly, from creation-time 22 to the halved 11).
4. `window-balance` is unchanged: it equalizes stored dims, and equal stored dims render as an even split through the same fit.

Out of scope: mixed-axis layout tree (#260), directional navigation bindings (#261), split minimum guards beyond the existing floor clamps (#263), per-window buffer liveness.

## Completion Criteria

1. A fresh split renders even panes and the origin's stored dimension halves (22→11 on a 24-row terminal; cells 11 + separator + 12) — verified by `test/unit/window-stored-dims.test.ts` ("a fresh split renders even panes (origin dimension halves too)").
2. `(window-resize-height 10)` moves the rendered separator row (11→15 on the 24-row fixture; cells 15/8 summing to the 23 available rows) — the issue's live repro, verified by `test/unit/window-stored-dims.test.ts` ("window-resize-height moves the rendered separator (the live repro)").
3. `(window-balance)` returns the rendered layout to even — verified by `test/unit/window-stored-dims.test.ts` ("balance-windows returns the rendered layout to even").
4. Resizes respect the pane minimum (3 rows) in both stored and rendered geometry, and the rendered panes always tile the available space exactly — verified by `test/unit/window-stored-dims.test.ts` ("resize respects the pane minimum in the rendered layout") and the sum assertions throughout.
5. Vertical splits honor stored widths the same way (separator column moves with the relative widths) — verified by `test/unit/window-stored-dims.test.ts` ("vertical splits honor stored widths").
6. No regressions: `test/unit/window-viewport.test.ts` (#258 — expectations updated 39→50 per Solution item 3, with comment), `window-splitting`, `window-resizing`, `window-focus-rebind`, `window-record-sync`, and the full unit gate pass; `bun run typecheck:src` + `typecheck:test` are clean.
