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
paths) and a probe pinned the mechanism: the expansion's stop condition
covered the SCREEN, not the CURSOR — the wire window could end before the
cursor line while the client's logical-only clamp believed the cursor
visible. Three changes, one contract:

1. **The wire window always contains the cursor line.** The daemon's
   expansion walks until wrapped rows cover the screen AND the window
   includes the cursor (width known); width-less paths still span through
   the cursor + slack under the same 6× wire bound. `render-state` now
   passes the frame width (expansion was silently disabled there).
2. **The client advances the viewport top wrap-awarely.**
   `renderSingleWindowWrapped` walks the cursor's wrapped-row span and
   advances the top until it fits — using the client's exact wrapLine +
   gutter math, no daemon-side estimation.
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
