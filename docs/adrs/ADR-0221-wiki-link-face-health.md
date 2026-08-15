# ADR-0221: SPEC-118 — dangling `[[wiki-links]]` render dimmed

- **Status**: accepted
- **Date**: 2026-08-15
- **Issues**: #193
- **Spec**: [SPEC-118](../specs/SPEC-118-dangling-wiki-link-dim-face.md)

## Context

Obsidian-style link health at a glance was the user's third demo ask: a
`[[target]]` that resolves renders in the link color; one that doesn't renders
dimmed. Discovery: the `wiki-link` token type had NO theme entry at all —
wiki-links rendered completely unstyled, so this also fixes them rendering as
plain text.

## Decision

- **Classifier** (`src/syntax/wiki-link-faces.ts`, new): `makeWikiLinkResolver(
  buffer, filename)` → target ⇒ `wiki-link-resolved` / `wiki-link-dangling`.
  Mirrors SPEC-116's follow rule exactly: `.md` appended when extension-less,
  dir-relative resolution, file part drives `[[file#heading]]`, and
  `[[#heading]]` is resolved iff the heading exists in the current buffer
  (lazy heading-slug scan — paid only when a heading-only link is rendered).
- **Perf guard**: `existsSync` behind a 2s TTL memo (module-level) — a repaint
  never stats the vault per keystroke; staleness is bounded by the TTL.
- **Integration**: `computeHighlightSpans` gained an optional 5th param
  (resolver); applied only to markdown buffers, per visible line (the render
  path is already viewport-scoped). Both render callers (embedded Steep via
  `captureFrame`, and the TUI client) pass the resolver.
- **Faces** (`src/syntax/types.ts`): `wiki-link-resolved` = the standard link
  face; `wiki-link-dangling` = same hue + `dim` (terminal intensity-2 halves
  it — a dimmed variant OF the link color, per spec); plain `wiki-link` added
  as the no-resolver fallback.

## Consequences

- One face per span, both classes in one buffer verified by unit test (exact
  ranges, no overlap) and live: in the mekkapi tab the ANSI snapshot shows
  `[[2026-08-08]]` at `38;2;97;175;239` full intensity and
  `[[brand new thought]]` with `ESC[2m` dim preceding the same color.
- Non-markdown buffers are untouched even if a resolver is passed (tested).
- Wiki-links previously invisible-as-links now always read as links — a
  side-effect fix that makes the whole feature discoverable.
- Suite: wiki-link-faces 10/10; syntax+render sweep 313/313; typecheck clean.
