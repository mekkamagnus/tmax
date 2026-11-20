# ADR-0293 — wrap-aware wire windows and viewport tops (#321)

- **Status**: Accepted
- **Date**: 2026-11-21
- **Issue**: #321
- **Spec**: SPEC-267

## Context

The viewport-only wire (issue #46) sends `visibleLines` sized to the
frame's rows; the client re-renders with word wrap. A 2026-11-20 patch
added wrap expansion (send more logical lines when wrap is on), but
blank tails persisted on large buffers. #321 mandated a capture matrix
FIRST: 90+ cells over N ∈ {80..200} × dims × wrap × path, plus the
original fikra chat shape.

## Decision

The matrix discriminated cleanly (wrap-off never failed on frame-sized
paths) and a probe pinned the mechanism (wording corrected per
verify-gate r1): the CLIENT-RENDERED window was the failing surface —
from a logically-clamped top it fills the screen with wrapped rows after
only ~rows/2 logical lines while the logical-only clamp still believes
the cursor visible, so nothing advances the top and the cursor + tail
render below the fold. The wire window itself always carried ≥
renderHeight logical lines (cursor on it via the clamp invariant) but
with zero fill-below-cursor slack — and render-state passed no width,
disabling the expansion there. Three changes, one contract:

1. **The client advances the viewport top wrap-awarely (operative).**
   `renderSingleWindowWrapped` walks the cursor's wrapped-row span and
   advances the top until it fits — using the client's exact wrapLine +
   gutter math, fold-hidden lines counted as zero rows. The advance is
   ONE shared helper (`advanceWrappedTop`); `getWrappedViewportTop` (span
   precompute) delegates to it — verify-gate r1 caught the duplicated
   fold-blind copies as a desync risk.
2. **The wire window carries fill slack.** The daemon's expansion walks
   until wrapped rows cover the screen AND past the cursor line; width-
   less paths span through the cursor + screen slack under the same 6×
   wire bound. `render-state` now passes the frame width (expansion was
   silently disabled there).
3. **Spans follow the rendered range.** Frontends precompute syntax spans
   from `getWrappedViewportTop` over a 2× logical span so the advanced
   window keeps its colors.

## Consequences

- Over-sending remains harmless (ViewportBuffer holds extra rows); the
  wire bound (6× rows) still caps pathological single-line walls.
- The no-frame default RPC path keeps its 22-row fallback — height-blind
  by construction, documented, unreachable by the TUI/`--capture`.
- The matrix test is committed as the regression gate: every client-path
  cell (render-state/keypress × wrap on/off × N × dims) plus the fikra
  and uniform-wall shapes assert the expected tail text at the scrolled
  viewport.
