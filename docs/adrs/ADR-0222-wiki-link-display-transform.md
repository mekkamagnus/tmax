# ADR-0222: SPEC-119 — `[[wiki-link]]` renders as a markdown link (display-only)

- **Status**: accepted
- **Date**: 2026-08-15
- **Issues**: #194
- **Spec**: [SPEC-119](../specs/SPEC-119-wiki-link-markdown-display.md)

## Context

The user's fourth demo ask: wiki syntax that READS as text but RENDERS like a
normal markdown link — Obsidian-style. The hard part is that the rendered line
becomes SHORTER than the buffer line, which breaks three invariants silently:
text/spans alignment, wrap math, and cursor column math (both the rendered
block cursor and the terminal cursor via `getCursorScreenOffset`).

## Decision

One pure transform — `transformWikiLine(rawLine, spans?) →
{text, spans, mapCol, changed}` (`src/frontend/render/wiki-display.ts`) —
applied at exactly the points that consume line text for display:

1. `renderSingleWindow` (the standard path): transform after span lookup; the
   render branches and the block-cursor column use display coordinates.
   Skipped when `viewportLeft > 0` (horizontal-scroll slicing operates on raw
   columns — a scrolled line renders raw; documented tradeoff).
2. `renderSingleWindowWrapped`: transform BEFORE wrapping; the cursor
   wrap-row math runs on the mapped column.
3. `getCursorScreenOffset`: maps the cursor column for the cursor's line —
   this is what both frontends (Steep embedded + TUI client) use to place the
   real terminal cursor.

Mapping rule: delimiters (and an alias's `target|`) are zero-width — cursor
columns on them land on the visible span's edge; visible text maps 1:1 (exact
for `[[target]]`, clamped for `[[target|display]]`).

Toggle: the `wiki-link-display` minor mode (globally ON at load, following the
electric-indent precedent; the render applies it only to markdown buffers).
`wiki-link-display-mode` / `global-wiki-link-display-mode` are interactive →
discoverable in M-x.

## Consequences

- The BUFFER is never touched: SPEC-116's follow/rewrite and BUG-74/76's
  at-point detection operate on raw text and are unaffected (gx follows the
  rendered link — verified live).
- SPEC-118's resolved/dangling faces carry through the transform (spans are
  re-mapped, not regenerated) — the live pane shows the dim distinction on
  the bracket-less rendering.
- Inline-code spans suppress the transform (style objects are theme entries,
  so identity comparison identifies code spans without re-tokenizing).
- Multi-window: only the focused window transforms (per-window buffer modes
  are not tracked by the renderer) — documented limitation.
- Discovered en route (filed, not fixed here): BUG-81 — `SPC ;` is
  unreliable/broken in the live embedded editor while the engine is provably
  correct; it blocked the live M-x toggle demo (unit-verified instead).
- Suite: wiki-link-display 13/13 (transform mapping, alias, code-span
  protection, toggle on/off, non-markdown pass-through, buffer-unchanged,
  plain-link/frontmatter regressions, cursor mapping); render+syntax sweep
  358/358; typecheck clean.
