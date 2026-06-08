# Feature: Steep Phase 2 — Oolong Markdown Renderer

**Vision alignment:** Pillar B (Steep Independence) — primary. Oolong is a standalone Steep package usable by any terminal application. Pillar C (Editor Completeness) — enables markdown preview in tmax.
**RFC source:** [RFC-006 Phase 2](../rfcs/RFC-006-steep-ecosystem.md) (implementation plan), [glamour-gap-analysis](../memos/glamour-gap-analysis.md) (gaps 1-5)
**Depends on:** [SPEC-020](./SPEC-020-steep-phase1-matcha-assam.md) (Matcha must exist for ANSI styling imports)
**Unblocks:** [SPEC-018](./SPEC-018-markdown-major-mode.md) (`markdown-preview` command uses Oolong)
**See also:** [RFC-008](../rfcs/RFC-008-steep-bubbletea-gap-analysis.md) (Assam View for rendering), [RFC-009](../rfcs/RFC-009-elm-purity-gap-analysis.md) (purity phases)
**Aligned with:** [technical-vision.md](../technical-vision.md) — Pillars B + C

## Feature Description

Build **Oolong** — the Glamour-equivalent markdown-to-ANSI renderer as a Steep package. Oolong takes raw markdown text and produces styled ANSI terminal output, driven by declarative stylesheets (themes). It imports Matcha for ANSI styling primitives and is usable standalone by any TypeScript terminal application.

This is RFC-006 Phase 2 — the first new Steep module that didn't previously exist in any form.

## User Story

As a tmax developer
I want a stylesheet-driven markdown renderer that produces ANSI terminal output
So that I can render styled markdown previews in the terminal and any Steep application can render markdown

## Problem Statement

tmax has no markdown rendering capability. The glamour gap analysis identifies 5 gaps: no CommonMark/GFM parser, no AST walker/renderer, no stylesheet system, no word-wrap engine with ANSI awareness, and no block layout engine. The only styling available is Matcha's ANSI primitives (after SPEC-020 is complete).

## Solution Statement

Build Oolong as `src/steep/oolong/` with 5 files (~1,050 lines total):

1. **Parser** — recursive-descent CommonMark + GFM parser
2. **AST** — type definitions for all markdown nodes
3. **Renderer** — stylesheet-driven ANSI renderer using Matcha
4. **Themes** — dark and light themes in Glamour-compatible format
5. **Word wrap** — ANSI-aware word wrapping engine
6. **Table formatter** — GFM pipe table alignment

## Implementation Steps

### Step 1: Define AST types (`src/steep/oolong/ast.ts`)

~80 lines. Node types covering CommonMark + GFM:

```
Document, Heading (h1-h6), Paragraph, Text, Bold, Italic, Strikethrough,
Code (inline), CodeBlock (fenced), Blockquote, List (ordered/unordered/task),
ListItem, Link, Image, HorizontalRule, Table, TableRow, TableCell,
YamlFrontMatter, SoftBreak, HardBreak
```

### Step 2: Build parser (`src/steep/oolong/parser.ts`)

~400 lines. Recursive-descent parser producing the AST:

- Block parsing: headings, paragraphs, code fences, blockquotes, lists, tables, HR, front matter
- Inline parsing: bold/italic, code spans, links, images, strikethrough
- GFM extensions: tables, task lists, strikethrough

### Step 3: Define theme format (`src/steep/oolong/themes/`)

Theme structure matches Glamour's JSON stylesheet format for Charm theme compatibility:

```typescript
interface ThemeStyle {
  color?: string;
  background?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  prefix?: string;
  suffix?: string;
  margin?: number;
  indent?: number;
}

interface Theme {
  document: ThemeStyle;
  h1: ThemeStyle;
  h2: ThemeStyle;
  // ... h3-h6, text, strong, em, codespan, code_block, link, image,
  //     blockquote, list, table, hr, etc.
}
```

Provide `darkTheme` and `lightTheme` defaults.

### Step 4: Build renderer (`src/steep/oolong/renderer.ts`)

~350 lines. Walks AST, applies theme styles via Matcha:

```typescript
import { style, fg, bg, bold, italic, underline, strikethrough } from '../matcha';

export function renderMarkdown(
  text: string,
  options: { width: number; theme: Theme }
): string[] {
  const ast = parse(text);
  const lines: string[] = [];
  // Walk AST, apply styles, handle block layout, word-wrap
  return lines;
}
```

### Step 5: Build word-wrap engine (`src/steep/oolong/wrap.ts`)

~120 lines. Wraps text at word boundaries respecting:
- Terminal width
- ANSI escape sequences (zero-width)
- Indent and margin from theme styles

### Step 6: Build table formatter (`src/steep/oolong/table.ts`)

~100 lines. GFM pipe table alignment:
- Parse column separators
- Compute column widths
- Re-align cells with padding

### Step 7: Add `markdown-preview` T-Lisp command

Expose Oolong in tmax via a T-Lisp API function that renders the current buffer as markdown and displays in a pager or split pane.

## Acceptance Criteria

- [ ] `src/steep/oolong/` directory exists with all 5+ files
- [ ] `renderMarkdown(text, { width: 80, theme: darkTheme })` returns `string[]`
- [ ] All CommonMark block elements render correctly (headings, paragraphs, code blocks, blockquotes, lists, HR)
- [ ] All inline elements render with ANSI styling (bold, italic, code, links, strikethrough)
- [ ] GFM tables render with aligned columns
- [ ] Word wrap respects terminal width and ANSI escape width
- [ ] Dark and light themes produce visibly different output
- [ ] Theme format is Glamour-compatible (JSON structure matches)
- [ ] Oolong imports from `../matcha` (not tmax editor code)
- [ ] `bun run typecheck` passes
- [ ] Unit tests in `test/unit/oolong/` pass

## Test Plan

### Unit tests: Parser (`test/unit/oolong/parser.test.ts`)

```typescript
describe('oolong parser', () => {
  test('parses ATX headings h1-h6');
  test('parses paragraph blocks');
  test('parses fenced code blocks with info string');
  test('parses nested blockquotes');
  test('parses ordered and unordered lists');
  test('parses GFM task lists');
  test('parses inline bold, italic, strikethrough');
  test('parses inline code spans');
  test('parses links and images');
  test('parses GFM pipe tables');
  test('parses YAML front matter');
  test('parses horizontal rules');
});
```

### Unit tests: Renderer (`test/unit/oolong/renderer.test.ts`)

```typescript
describe('oolong renderer', () => {
  test('headings render with theme colors');
  test('bold text wraps with ANSI bold escapes');
  test('code blocks render with background tint');
  test('blockquotes render with indent prefix');
  test('links render with visible URL');
  test('GFM tables render with aligned columns');
  test('output lines do not exceed specified width');
  test('dark theme vs light theme produces different ANSI colors');
  test('empty document returns empty array');
  test('plain text paragraph renders unstyled');
});
```

### Unit tests: Word wrap (`test/unit/oolong/wrap.test.ts`)

```typescript
describe('oolong wrap', () => {
  test('wraps at word boundaries');
  test('preserves ANSI escapes in wrapped text');
  test('respects indent parameter');
  test('handles long words exceeding width');
});
```

### Unit tests: Themes (`test/unit/oolong/themes.test.ts`)

```typescript
describe('oolong themes', () => {
  test('dark theme has all required style keys');
  test('light theme has all required style keys');
  test('theme structure matches Glamour format');
});
```

## Files Created

| File | Lines (est.) | Purpose |
|------|:---:|---------|
| `src/steep/oolong/ast.ts` | ~80 | AST node type definitions |
| `src/steep/oolong/parser.ts` | ~400 | CommonMark + GFM recursive-descent parser |
| `src/steep/oolong/renderer.ts` | ~350 | Stylesheet-driven ANSI renderer |
| `src/steep/oolong/themes/dark.ts` | ~40 | Dark theme (Glamour-compatible) |
| `src/steep/oolong/themes/light.ts` | ~40 | Light theme (Glamour-compatible) |
| `src/steep/oolong/wrap.ts` | ~120 | ANSI-aware word wrap engine |
| `src/steep/oolong/table.ts` | ~100 | GFM table formatter |
| `test/unit/oolong/parser.test.ts` | ~150 | Parser tests |
| `test/unit/oolong/renderer.test.ts` | ~120 | Renderer tests |
| `test/unit/oolong/wrap.test.ts` | ~60 | Wrap tests |
| `test/unit/oolong/themes.test.ts` | ~30 | Theme tests |

## Notes

**Design decisions:**

- **Directory structure.** Oolong starts as `oolong/` directory (~1,050 lines) because a flat file would be unwieldy (RFC-006 DD#3).
- **Glamour-compatible theme format.** Oolong adopts Glamour's JSON stylesheet format directly, giving instant access to existing Charm themes (dracula, catppuccin, etc.) without modification (RFC-006 DD#4).
- **Imports Matcha, not tmax.** Oolong imports only `../matcha` for ANSI styling — no editor types, no buffer types, no T-Lisp. This ensures Steep independence.
- **Pure functions.** `renderMarkdown` is a pure function: markdown text + options → ANSI lines. No side effects, no global state. This aligns with RFC-009's purity goals and RFC-008's Assam View contract.
- **Falls back to `glow`.** If Oolong is not yet complete, `markdown-preview` can shell out to `glow` as a temporary fallback per SPEC-018.
