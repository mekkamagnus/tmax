# Bug: No syntax highlighting for markdown-mode

## Bug Description
When opening a `.md` file in tmax, the markdown major mode activates correctly (heading navigation, folding, formatting toggles all work), but there is no syntax highlighting rendered. Headings, bold, italic, code, links, blockquotes, and all other markdown constructs appear in plain monochrome text with no color or style differentiation.

## Problem Statement
The markdown tokenizer (`src/syntax/languages/markdown.ts`) produces token types like `"heading"`, `"bold"`, `"italic"`, `"link"`, `"code"`, `"blockquote"`, `"strikethrough"`, `"code-delimiter"`, `"table-separator"`, `"list-item"`, `"task-item"`, `"image"`, `"hr"`, `"meta"`, and `"code-block"`.

The `defaultDarkTheme` in `src/syntax/types.ts` only maps programming-language token types (`keyword`, `string`, `comment`, `number`, `function`, `operator`, etc.). None of the markdown-specific token types have entries in the theme.

When `highlighter.ts` resolves a token type via `resolveStyle(token.type, theme)`, it falls through to `theme.default = {}` (empty object = no styling), so all markdown tokens render with zero visual differentiation.

## Solution Statement
Add markdown-specific token type entries to `defaultDarkTheme` in `src/syntax/types.ts`. Each token type gets an appropriate ANSI style (color, bold, italic, etc.) following the One Dark palette already used for programming tokens.

## Steps to Reproduce
1. Open any `.md` file in tmax: `tmax some-file.md`
2. Observe that headings, bold text, code spans, links, blockquotes all render in the same plain monochrome color
3. Compare with a `.ts` file where keywords, strings, comments are colorized correctly

## Root Cause Analysis
The highlight pipeline works correctly:
1. `computeHighlightSpans` in `highlight-buffer.ts` auto-detects `"markdown"` from the `.md` extension
2. The markdown rules in `languages/markdown.ts` tokenize correctly producing typed spans
3. `highlightLine` in `highlighter.ts` maps each token type to a style via `theme[tokenType]`
4. The theme has no entries for any markdown token type, so every token gets `theme.default = {}`
5. The render pipeline in `buffer-lines.ts` applies `span.style` — an empty object produces no ANSI escapes

The tokenizer, render pipeline, and mode activation are all correct. Only the theme is missing.

## Relevant Files

- `src/syntax/types.ts` — Contains `defaultDarkTheme` that maps token types to ANSI styles. **This is the fix location.** Missing all markdown token type entries.
- `src/syntax/languages/markdown.ts` — Defines markdown tokenizer rules producing the unmapped token types. Read-only reference for which types exist.
- `src/syntax/highlighter.ts` — `resolveStyle()` does `theme[tokenType] ?? theme.default ?? {}`. No change needed.
- `src/syntax/highlight-buffer.ts` — `computeHighlightSpans()` auto-detects language from filename. Already maps `.md` → `"markdown"` correctly. No change needed.
- `src/frontend/render/buffer-lines.ts` — `applyHighlights()` consumes spans and applies ANSI styling. No change needed.

## Step by Step Tasks

### Add markdown token type styles to defaultDarkTheme

**User Story**: As a tmax user editing markdown files, I want headings, bold, italic, code, links, and other markdown constructs to be visually distinct with colors and styles so that I can quickly scan and understand document structure.

- Open `src/syntax/types.ts`
- Add the following entries to `defaultDarkTheme` (using One Dark palette):
  - `"heading"` — prominent heading color (e.g., `{ fg: "#e06c75", bold: true }`)
  - `"bold"` — slightly brighter text (e.g., `{ fg: "#d19a66", bold: true }`)
  - `"italic"` — distinct italic color (e.g., `{ fg: "#c678dd", italic: true }`) — note: only add `italic` if the `ANSIStyle` type supports it, otherwise use a color-only approach
  - `"link"` — blue accent (e.g., `{ fg: "#61afef", underline: true }`)
  - `"code"` — green string-like (e.g., `{ fg: "#98c379" }`)
  - `"code-delimiter"` — muted comment-like (e.g., `{ fg: "#5c6370" }`)
  - `"code-block"` — slightly dimmed (e.g., `{ fg: "#abb2bf", dim: true }`)
  - `"blockquote"` — purple-ish special (e.g., `{ fg: "#c678dd" }`)
  - `"strikethrough"` — dimmed red (e.g., `{ fg: "#f85149", dim: true }`)
  - `"hr"` — muted border (e.g., `{ fg: "#5c6370" }`)
  - `"list-item"` — cyan operator-like (e.g., `{ fg: "#56b6c2" }`)
  - `"task-item"` — bright green (e.g., `{ fg: "#98c379", bold: true }`)
  - `"table-separator"` — muted (e.g., `{ fg: "#5c6370" }`)
  - `"image"` — link-like (e.g., `{ fg: "#61afef" }`)
  - `"meta"` — comment-like for front matter (e.g., `{ fg: "#5c6370", dim: true }`)

**Acceptance Criteria**:
- [ ] `defaultDarkTheme` contains entries for all 15 markdown token types produced by `markdown.ts`
- [ ] Each entry uses colors from the One Dark palette already in use
- [ ] TypeScript compiles without errors (`bun run typecheck:src`)
- [ ] Existing tests continue to pass

### Validate highlighting renders correctly

**User Story**: As a developer, I want to verify the fix works end-to-end so I'm confident the render pipeline produces colored output for markdown.

- Run `bun run typecheck:src` to verify type safety
- Run `bun test test/unit/` to verify no regressions
- Optionally open a `.md` file in tmax and visually confirm colors appear on headings, bold, links, etc.

**Acceptance Criteria**:
- [ ] `bun run typecheck:src` passes with zero errors
- [ ] `bun test test/unit/` passes with zero failures

## Validation Commands

- `bun run typecheck:src` — Verify TypeScript compiles without errors
- `bun test test/unit/` — Verify no test regressions
- `bun run start test.md` — Visual verification (manual): open a markdown file and confirm headings, bold, code, etc. render with colors

## Notes
- This is a theme-only fix. The tokenizer, highlighter, render pipeline, and mode activation are all working correctly.
- The `ANSIStyle` type in `src/core/types.ts` supports: `fg`, `bg`, `bold`, `dim`, `underline`, `inverse`. It does NOT have an `italic` field — use `inverse` or color-only for italic differentiation.
- The `style()` function from `src/steep/matcha.ts` in the render pipeline checks `span.style.fg`, `span.style.bg`, `span.style.bold`, `span.style.dim` — these are the fields we can use.
