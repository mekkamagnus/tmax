# ADR-0284: Binary Split Tree Owns Window Geometry

## Status

Accepted

## Context

Issue #260: the flat `windows` array plus `computeLayout`'s single global axis (`windows.some(w => w.splitType === "vertical")`) made mixed-axis layouts unrepresentable — one vertical split re-flowed every pane into columns (`C-w s` + `C-w v` → three columns instead of a split top row). The issue asked for a tree (or ring-of-axes) model, size authority in daemon/client mode, and the per-tab question to be resolved.

## Decision

1. **A `LayoutNode` binary split tree owns geometry; the flat array stays the leaf registry.** Leaves reference windows by ID; splits carry `axis` + `ratio` (first child's share) + children. Records, focus index, the #262 rebind seam, rotate, and close semantics all keep operating on the flat array — the tree is purely geometric, which contained the blast radius of this change to layout math and five window ops.
2. **`divideRect` is the single division source**: one separator per split node (#258 generalized to nesting), floor-first ratio split, minimum clamps (3/10). Layout, rect annotation (resize walks), separator drawing, and `flatTree` materialization all share it.
3. **Trees are never fabricated for cell math.** Guards, introspection, and navigation pass the real tree (or none → the unchanged flat path); a fabricated tree could render differently than the flat path it stands in for. `flatTree` (even i/(i+1) ratios) materializes only at the first split of a tree-less state, rendering identically to the flat layout it replaces.
4. **Resize is ratio-based and side-aware**: the nearest enclosing same-axis split adjusts by `delta/content`, sign flipped for panes under `second` (the ratio is the first child's share); minimum clamps hold. Stored `Window.height/width` become an informational cache synced from cells — the #259 stored-dim authority is superseded (as that issue anticipated), and the affected test expectations moved to cell semantics (pairs tile the content extent exactly).
5. **Persistence**: the tree serializes in `WorkspaceData.layout` and restores pruned; ratios are terminal-size-independent, which also addresses the issue's daemon/client size-authority question (each frontend lays the same ratios out at its own size).
6. Per-tab window configurations remain one global layout (unchanged — a separate decision if ever needed).

## Consequences

- Mixed-axis layouts work: splits nest inside the focused pane's frame; closes collapse siblings into the freed frame; balance equalizes recursively.
- `computeLayout`/`renderSeparators` accept an optional tree; every legacy caller (and every pre-#260 persisted workspace) behaves identically without one.
- Nested separators are drawn from the tree (adjacency inference cannot see nested boundaries).
- The #261 directional navigation composes with nesting for free (cells carry real geometry); `C-w H/J/K/L` move-window is now implementable but stays unimplemented.
- Stored dims are advisory: anything needing real pane size reads cells (`window-height`/`-width`/`-list` do).

## Related

- [SPEC-258](../specs/SPEC-258-window-layout-tree.md), issue #260
- [ADR-0280](ADR-0280-window-stored-dimension-layout.md) (#259 — superseded authority), [ADR-0282](ADR-0282-window-directional-navigation.md) (#261 — navigation on cells), [ADR-0277](ADR-0277-window-viewport-model-authoritative.md) (#258 — separators), #263
