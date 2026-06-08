# Gap Analysis: Glamour-Style Markdown Renderer for tmax/Steep

**Date:** 2026-06-08

## What Glamour Does

Glamour's pipeline: **Markdown text → goldmark parser → AST → stylesheet-driven ANSI renderer → styled terminal output**

The stylesheet is a JSON file mapping every markdown element (h1-h6, bold, italic, code_block, link, blockquote, list, table, hr, etc.) to ANSI properties (color, background_color, bold, italic, underline, crossed_out, prefix, suffix, indent, margin). Themes are just different JSON files.

Glamour renders: headings (6 levels), bold, italic, strikethrough, inline code, fenced code blocks (with Chroma syntax highlighting), links, images, blockquotes, ordered/unordered/task lists, GFM tables, horizontal rules, YAML front matter, definition lists, footnotes, emoji shortcodes.

## What tmax Has Now

| Capability | Status | Location |
|---|---|---|
| ANSI styling (fg, bg, bold, dim) | **Have** | `src/frontend/frontends/steep/style.ts` — 24-bit true-color support |
| Screen write-at-position | **Have** | `src/frontend/frontends/steep/screen.ts` — CSI cursor movement |
| Syntax tokenizer pipeline | **Have** | `src/syntax/` — regex rules + state machine, 6 languages |
| Highlight spans → ANSI wrapping | **Have** | `src/frontend/render/buffer-lines.ts:applyHighlights()` |
| Strip ANSI for width calc | **Have** | `stripAnsi()` in style.ts |
| Block cursor in ANSI text | **Have** | `renderWithBlockCursorAnsi()` in buffer-lines.ts |
| Minibuffer rich-text (face-based styles) | **Have** | `src/frontend/render/minibuffer.ts:faceStyle()` |
| ANSI-to-HTML conversion | **Have** | `src/render/ansi-to-html.ts` — for frame capture |
| Headless frame capture | **Have** | `src/render/capture-frame.ts` — mirrors Steep render loop |

## Gaps (What's Missing)

### Gap 1: Markdown Parser

No CommonMark/GFM parser exists in tmax. Need an AST from markdown text. tmax has zero external dependencies (no goldmark — that's Go anyway). Need a TypeScript equivalent built from scratch.

**Effort:** Medium (~400 lines for a recursive-descent CommonMark + GFM parser)

### Gap 2: AST Walker/Renderer

No generic "walk an AST and emit styled output" infrastructure. Current pipeline is line-by-line tokenizer → `HighlightSpan[]`, not tree-based. Glamour registers a high-priority NodeRenderer that walks the AST and dispatches per-node-type to a stylesheet lookup.

**Effort:** Medium (~350 lines)

### Gap 3: Stylesheet System

No JSON/style-driven theme system. All styling is hardcoded — `style.ts` uses named params, `highlighter.ts` uses a `defaultDarkTheme` map. No concept of prefix/suffix/margin/indent as style properties. Glamour's power comes from everything being driven by a declarative stylesheet.

**Effort:** Medium (~100 lines for theme definitions + renderer integration)

### Gap 4: Word Wrapping

No word-wrap engine that accounts for ANSI escape width + indent/margin. `padAnsiToWidth()` pads but doesn't wrap. Glamour wraps at word boundaries respecting visual character width, margins, and indentation.

**Effort:** Medium (~120 lines)

### Gap 5: Block Layout Engine

No concept of "block elements" with vertical margins, nested indentation, or prefix/suffix strings. Current renderer is strictly one-line-per-buffer-line. A Glamour-style renderer needs block-level layout: headings with padding, blockquotes with indent tokens, code blocks with background tint, tables with column alignment.

**Effort:** Large (the biggest gap — spans across the renderer and wrap engine)

### Gap 6: Missing ANSI Attributes

`style()` supports bold and dim only. Missing attributes needed for Glamour parity:

| Attribute | Escape Sequence | Status |
|---|---|---|
| Italic | `\x1b[3m` / `\x1b[23m` | **Missing** |
| Underline | `\x1b[4m` / `\x1b[24m` | **Missing** |
| Strikethrough | `\x1b[9m` / `\x1b[29m` | **Missing** |
| Inverse | `\x1b[7m` / `\x1b[27m` | **Missing** |

**Effort:** Small (~15 lines added to style.ts)

### Gap 7: Table Alignment

No column-width calculation or pipe-table alignment rendering. GFM tables need: parse pipe-delimited rows, calculate max width per column, respect alignment markers (`:---:`, `---:`, `:---`), pad cells.

**Effort:** Medium (~100 lines)

### Gap 8: List Rendering

No bullet enumeration, nesting indent, or task-list checkbox rendering. Glamour handles: unordered (`•`, `-`, `*`), ordered (numbered), task lists (`✓`/`✗`), nested with level indent.

**Effort:** Medium (covered by renderer + wrap engine)

### Gap 9: Code Block Sub-Highlighting

`highlight-buffer.ts` can tokenize embedded languages, but only for the editor buffer. No way to render an inline code block with syntax highlighting inside a markdown preview. The existing `computeHighlightSpans()` + `applyHighlights()` pipeline can be reused if given the right inputs.

**Effort:** Small (reuse existing pipeline with a thin adapter)

### Gap 10: Width-Aware Rendering

No concept of rendering at a specific width with margins. The editor renders full-width buffer lines. A preview renderer needs margin/padding control — Glamour defaults to 80 chars with configurable `WithWordWrap()`.

**Effort:** Small (wrap engine handles this)

## Approach: Build vs. Wrap

### Option A: Wrap an existing TS markdown-to-ANSI library

Libraries like `terminal-markdown` or `cli-markdown` exist but are limited (no themes, no GFM tables, poor code block handling). Would add a dependency, conflicting with tmax's zero-dependency goal.

### Option B: Build a Glamour-style renderer from scratch (recommended)

- Write a lightweight CommonMark/GFM parser
- Build a stylesheet-driven ANSI renderer
- Reuse tmax's existing `style()`, `stripAnsi()`, and syntax highlighting pipeline
- Fits the tmax architecture: TypeScript primitives, T-Lisp commands

## Estimated Scope

| Component | New File(s) | Est. Lines |
|---|---|---|
| Markdown parser (CommonMark + GFM) | `src/render/markdown/parser.ts` | ~400 |
| AST types | `src/render/markdown/ast.ts` | ~80 |
| ANSI renderer with stylesheet | `src/render/markdown/renderer.ts` | ~350 |
| Theme definitions (dark, light) | `src/render/markdown/themes/` | ~100 |
| Word wrap engine | `src/render/markdown/wrap.ts` | ~120 |
| Table formatter | `src/render/markdown/table.ts` | ~100 |
| Style.ts additions (italic, underline, strikethrough, inverse) | modify `steep/style.ts` | ~15 |
| T-Lisp integration (preview command) | `src/tlisp/core/commands/markdown-commands.tlisp` | ~20 |
| Tests | `test/unit/markdown-renderer.test.ts` | ~200 |
| **Total** | | **~1,400 lines** |

## Key Design Decisions

1. **Parser**: Build a minimal recursive-descent CommonMark parser rather than pulling in a dependency. GFM adds tables, task lists, strikethrough — ~60% of the total parser work.

2. **Stylesheet format**: Adopt Glamour's JSON format directly. This gives instant access to all their themes (dark, light, dracula, catppuccin) and makes custom themes trivial.

3. **Rendering model**: The renderer takes markdown text + width + theme → returns `string[]` (one ANSI-encoded string per screen line). The Steep frontend writes these lines via `screen.writeAt()` exactly like it does for buffer content.

4. **Integration point**: A `markdown-preview` T-Lisp command replaces the buffer viewport with the renderer output. `q` returns to normal editing. No new screen modes needed — just a different data source for the same `writeAt()` loop.

5. **Code block highlighting**: Reuse the existing `computeHighlightSpans()` → `applyHighlights()` pipeline by extracting the highlight logic into a standalone function callable from the markdown renderer.
