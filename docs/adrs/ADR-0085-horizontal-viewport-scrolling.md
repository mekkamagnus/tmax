# Horizontal Viewport Scrolling Infrastructure

## Status

Accepted

## Context

Long lines extending beyond the terminal width were either clipped or relied on wrapping. There was no horizontal scrolling — users couldn't navigate to content beyond the right edge of the viewport without enabling wrap mode.

## Decision

Add horizontal viewport scrolling infrastructure (SPEC-037):

- **Viewport state**: `viewportLeft` tracks the horizontal scroll offset in the editor state
- **Rendering**: The renderer receives a pre-computed `viewportLeft` offset rather than recalculating it internally. Non-wrapping lines are sliced to `[viewportLeft, viewportLeft + width]`.
- **Scroll commands**: `scroll-column-left` (`zh`), `scroll-column-right` (`zl`), `scroll-cursor-start` (`zs`), `scroll-cursor-end` (`ze`) registered via T-Lisp keymap under the `z` prefix
- **Status indicator**: `«` character shown when content is scrolled right, signaling hidden content to the left

The authoritative content string for the buffer comes from the logical `lines` array, not from the gap buffer's internal representation (a separate fix in `buffer.ts` that `getContent()` returns `this.lines.join("\n")`).

## Consequences

- **Easier**: Users can scroll horizontally to view and edit long lines. The `z`-prefix scroll commands are consistent with Vim conventions.
- **Harder**: All rendering code must account for horizontal offset. The split between wrapping and non-wrapping render paths must both handle `viewportLeft` correctly.
