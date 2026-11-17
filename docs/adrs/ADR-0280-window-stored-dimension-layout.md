# ADR-0280: Layout Honors Stored Window Dimensions (Proportional Fit)

## Status

Accepted

## Context

Issue #259: `computeLayout` distributed space evenly and never read `Window.height`/`Window.width`, so `window-resize-height`/`-width` and `window-balance` mutated state nothing rendered (live repro: resize moved `(window-height 0)` 42→52 while the separator row never moved). SPEC-084's DoD had asserted the stored value, not visible behavior. `split-window` compounded this by giving the new window half the dimension while the origin kept its full stored size — stored sizes summed past the terminal by construction.

## Decision

1. **Proportional fit.** `computeLayout` scales the stored sizes proportionally to fill the available space exactly (available = terminal − #258 separator gaps). A flat, single-axis layout can only honor *relative* sizes — a resize changes the pane's share, not absolute rows — so proportionality is the honest semantics short of #260's layout tree. Clamps: each pane ≥ its minimum (3 rows / 10 cols, mirroring the resize ops) and ≤ available − (n−1)·min; the rounding remainder goes to the last pane, and clamp overshoot is taken back newest-first. Missing stored sizes default to an even share; space below n minimums degrades to even distribution.
2. **Split conserves.** `split-window` halves the origin's stored dimension too (`dim − new`, minimum-clamped), so stored sizes conserve the pre-split total. This also makes stored dims approximate rendered cell sizes — dissolving ADR-0277's stored-height approximation caveat (its "exact fidelity arrives with #259" note): `switchWindow`'s leave-save now clamps with a height that matches the rendered pane, and the #258 focus-sync tests' clamp expectation moved 39→50 (creation-time 22 → halved 11).
3. `window-balance` is unchanged — equalizing stored dims renders as an even split through the same fit.

Deliberately out of scope: mixed-axis layout tree (#260 — proportional fit is the flat-layout ceiling), directional navigation (#261), split minimum guards beyond the floor clamps (#263).

## Consequences

- `C-w +/-/</>` and `C-w =` are now user-visible: the separator moves with the relative pane sizes; panes always tile the available space exactly.
- Stored dims are the layout input but not the layout output: after any layout-affecting event (split, close, terminal resize), a pane's rendered size is its stored size's *share*, not its literal value. Code that needs the rendered geometry must read `computeLayout`'s cells (same rule as #258).
- First-window stored height remains `terminal − 2` (status-row convention) — irrelevant to a single-window render (full pane) and only a proportion seed once split.
- Per-window viewport saves are now dimensionally faithful (ADR-0277's approximation dissolved).

## Related

- [SPEC-254](../specs/SPEC-254-window-stored-dimension-layout.md), issue #259
- [ADR-0277](ADR-0277-window-viewport-model-authoritative.md) (#258 — separator gaps + the dissolved caveat), [ADR-0278](ADR-0278-window-focus-context-rebind.md) (#262), #260, #261, #263
