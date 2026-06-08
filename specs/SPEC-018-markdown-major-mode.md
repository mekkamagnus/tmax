# Feature: Markdown Major Mode

## Feature Description

A comprehensive major mode for editing Markdown files (.md, .markdown, .mdx) in tmax. The mode provides syntax highlighting, structural navigation, section folding, inline formatting toggles, table formatting, list editing automation, and a rich set of T-Lisp commands — all following the existing major mode architecture and T-Lisp extensibility model.

Inspired by Emacs `markdown-mode.el`, VSCode's "Markdown All in One", and vim markdown plugins, this mode adapts their best patterns to a terminal-based modal editing context: pure text-manipulation commands, heading-based navigation and folding, smart toggle primitives, and shell-out integration for preview/export.

## User Story

As a developer writing documentation, READMEs, or technical articles in Markdown
I want a dedicated major mode that understands Markdown structure
So that I can navigate, edit, fold, and format Markdown efficiently without leaving the keyboard

## Problem Statement

tmax currently has no file-type-specific behavior for Markdown. Opening a `.md` file provides no syntax highlighting, no structural navigation between headings, no section folding, no table formatting, and no Markdown-specific editing commands. Users must edit Markdown as plain text with no awareness of its document structure.

## Solution Statement

Implement a `markdown` major mode that:

1. **Registers via the existing major mode system** (`major-mode-register` in T-Lisp) with file extension detection for `.md`, `.markdown`, `.mdx`
2. **Adds a Markdown tokenizer** (`src/syntax/languages/markdown.ts`) with stateful tracking for fenced code blocks, so headings, emphasis, code, links, lists, blockquotes, tables, and YAML front matter are all highlighted
3. **Provides heading-based navigation** — commands to jump between headings, navigate the heading outline, and move by section
4. **Implements section folding** — a new fold infrastructure in TypeScript (fold state per buffer, render-pipeline integration) exposed to T-Lisp, with heading-level fold commands (`zc`/`zo`, `z1`–`z6`, TAB visibility cycling)
5. **Delivers smart inline formatting toggles** — wrap/unwrap `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, with visual-mode and normal-mode variants
6. **Formats GFM pipe tables** — parse columns, compute widths, re-align
7. **Automates list editing** — auto-continue markers on Enter, renumber ordered lists
8. **Exposes everything through T-Lisp** so users can customize, extend, and rebind

## Relevant Files

### Existing Files to Modify

- `src/syntax/highlight-buffer.ts` — Register markdown language rules in `languageMap` and `extToLang`
- `src/syntax/parse-state.ts` — Add markdown-specific `StateTransitions` for fenced code block tracking
- `src/syntax/tokenizer.ts` — Ensure the tokenizer handles markdown's cross-line state
- `src/editor/tlisp-api.ts` — Register new fold and markdown-specific T-Lisp primitives
- `src/core/types.ts` — Add `foldRanges` to `EditorState` for per-buffer fold state
- `src/frontend/render/buffer-lines.ts` — Modify `renderSingleWindow` to skip collapsed lines and render fold indicators
- `src/frontend/render/gutter.ts` — Add fold indicator markers in the gutter (▼/▶ or similar)
- `src/frontend/render/status-line.ts` — Display markdown mode indicator
- `src/editor/editor.ts` — Wire fold state into the editor's state management and recompute cycle

### New Files

- `src/syntax/languages/markdown.ts` — Markdown tokenizer rules (headings, emphasis, code, links, lists, blockquotes, tables, front matter)
- `src/editor/api/fold-ops.ts` — TypeScript primitives for fold state management (toggle, open, close, fold-by-level, query)
- `src/tlisp/core/modes/markdown-mode.tlisp` — Major mode registration, mode-specific key bindings, activation hook
- `src/tlisp/core/commands/markdown-commands.tlisp` — T-Lisp command library: formatting toggles, table formatting, list operations, heading navigation, TOC generation

## Implementation Plan

### Phase 1: Foundation — Markdown Tokenizer and Mode Registration

Add the syntax highlighting layer and register the major mode. This is the base that all other features build on.

- Create `src/syntax/languages/markdown.ts` with regex-based rules for all Markdown constructs
- Add markdown `StateTransitions` to `parse-state.ts` for fenced code block enter/exit
- Register the language in `highlight-buffer.ts` and `syntax-ops.ts`
- Create `src/tlisp/core/modes/markdown-mode.tlisp` with `major-mode-register`
- Add indent rules for lists and blockquotes

### Phase 2: Fold Infrastructure — Generic Folding System

Build a general-purpose fold system in TypeScript that T-Lisp commands can drive. Markdown headings are the first consumer, but the infrastructure is language-agnostic.

- Add `foldRanges: Map<number, number>` to `EditorState` (maps fold-start line → fold-end line)
- Create `src/editor/api/fold-ops.ts` with fold primitives: toggle, open, close, close-all, open-all, fold-by-level
- Modify `renderSingleWindow` in `buffer-lines.ts` to skip lines within collapsed ranges and render a fold indicator at the fold-start line
- Add gutter fold markers
- Wire the fold API into `tlisp-api.ts`

### Phase 3: Markdown Commands — Navigation, Formatting, Tables

Implement the T-Lisp command library that makes markdown mode useful.

- Heading navigation: next/prev heading, next/prev same-level, up to parent
- Inline formatting toggles: bold, italic, strikethrough, code span (smart wrap/unwrap)
- Heading promotion/demotion (change `##` to `###` etc.)
- GFM table formatting (parse, align, re-emit)
- List auto-continuation on Enter
- TOC generation
- Fold commands specific to markdown headings: fold by level (`z1`–`z6`), TAB visibility cycling
- Context-aware "do" command (fold on heading, follow link, toggle checkbox)

## Step by Step Tasks

### Step 1: Create Markdown Tokenizer Rules

- Create `src/syntax/languages/markdown.ts` with `SyntaxRule[]` covering:
  - YAML front matter (`---` blocks) — type `meta`
  - ATX headings (`# ` through `###### `) — type `heading`
  - Setext headings (underline `===`/`---`) — type `heading`
  - Fenced code block delimiters (`` ``` ``) — type `code-delimiter`
  - Inline code (`` `code` ``) — type `code`
  - Bold (`**text**` or `__text__`) — type `bold`
  - Italic (`*text*` or `_text_`) — type `italic`
  - Strikethrough (`~~text~~`) — type `strikethrough`
  - Links (inline `[text](url)`, reference `[text][ref]`) — type `link`
  - Images (`![alt](url)`) — type `image`
  - Blockquotes (`> `) — type `blockquote`
  - Unordered list markers (`- `, `* `, `+ `) — type `list-item`
  - Ordered list markers (`1. `, `1) `) — type `list-item`
  - Task list markers (`- [ ]`, `- [x]`) — type `task-item`
  - Horizontal rules (`---`, `***`, `___`) — type `hr`
  - Pipe table separators (`|---|`) — type `table-separator`
- Add `StateTransitions` for fenced code blocks in `parse-state.ts`:
  - Track `inCodeFence` state with the fence delimiter (`` ``` `` or `~~~`)
  - When inside a code fence, tokenize lines as `code-block` type
- Priority ordering: front matter > fenced code blocks > headings > inline emphasis > links > lists > blockquotes

### Step 2: Register Markdown Language

- Add import of markdown rules to `src/syntax/highlight-buffer.ts`
- Add `["markdown", mdRules]` to `languageMap`
- Add entries to `extToLang`: `.md` → `"markdown"`, `.markdown` → `"markdown"`, `.mdx` → `"markdown"`
- Add entry in `src/editor/api/syntax-ops.ts` `languageRules` map

### Step 3: Register Markdown Major Mode

- Create `src/tlisp/core/modes/markdown-mode.tlisp`:
  ```lisp
  (defmodule editor/modes/markdown
    (export)
    (major-mode-register "markdown" '(".md" ".markdown" ".mdx") "markdown"
      '("\\{$" "```" "\\{$" ">\\s" "-\\s" "\\*\\s" "\\+\\s")
      '("^\\s*}" "^\\s*```" "^\\s*}\\s*$" "^\\s*$")))
  ```
- Add `(require-module editor/modes/markdown)` to the module loading sequence
- Add a mode activation hook that enables syntax highlighting and sets indent rules

### Step 4: Add Fold State to EditorState

- Add `foldRanges?: Map<number, number>` to `EditorState` in `src/core/types.ts`
- This map stores collapsed ranges: key = start line (where the fold indicator appears), value = end line (last hidden line)
- Fold state is per-buffer, tracked in the editor's state management

### Step 5: Create Fold Operations API

- Create `src/editor/api/fold-ops.ts` with these primitives:
  - `fold-toggle(line)` — if line has an active fold, open it; otherwise, create a fold to the next heading boundary
  - `fold-open(line)` — remove the fold at `line` from `foldRanges`
  - `fold-close(line, endLine)` — add `line → endLine` to `foldRanges`
  - `fold-close-all()` — fold all detectable regions (all headings at all levels)
  - `fold-open-all()` — clear all entries in `foldRanges`
  - `fold-by-level(maxLevel)` — fold all headings at levels deeper than `maxLevel`
  - `fold-is-collapsed(line)` → boolean
  - `fold-get-ranges()` → list of `{start, end}` pairs
- Register these as T-Lisp primitives in `tlisp-api.ts`

### Step 6: Integrate Folding into Render Pipeline

- Modify `renderSingleWindow` in `src/frontend/render/buffer-lines.ts`:
  - Before rendering each line, check if its line number falls within any collapsed range in `foldRanges`
  - Skip rendering collapsed lines (they are hidden)
  - At fold-start lines, render a fold indicator: replace the gutter marker with `▶` and append `... [N lines]` after the heading text
  - Adjust `viewportTop` computation so the cursor is never hidden inside a fold (auto-expand fold if cursor lands in one)
- In the gutter, render `▼` for expanded foldable headings and `▶` for collapsed folds

### Step 7: Create Markdown Command Library

- Create `src/tlisp/core/commands/markdown-commands.tlisp` with the following functions:

  **Navigation:**
  - `markdown-next-heading` — move cursor to next `#`-prefixed line
  - `markdown-prev-heading` — move cursor to previous `#`-prefixed line
  - `markdown-next-same-level-heading` — find next heading with same `#` count
  - `markdown-prev-same-level-heading` — find previous heading with same `#` count
  - `markdown-up-heading` — move to parent heading (fewer `#`s)
  - `markdown-heading-outline` — populate minibuffer with all headings as a navigable list

  **Folding (markdown-specific):**
  - `markdown-fold-toggle` — fold/unfold section at current heading
  - `markdown-fold-all` — fold all sections
  - `markdown-unfold-all` — unfold all sections
  - `markdown-fold-by-level(N)` — fold sections deeper than level N
  - `markdown-visibility-cycle` — TAB cycle: collapsed → subheadings visible → fully expanded

  **Inline Formatting (smart toggles):**
  - `markdown-toggle-bold` — wrap/unwrap `**` around word or selection
  - `markdown-toggle-italic` — wrap/unwrap `*` around word or selection
  - `markdown-toggle-strikethrough` — wrap/unwrap `~~` around word or selection
  - `markdown-toggle-code` — wrap/unwrap `` ` `` around word or selection
  - `markdown-toggle-code-block` — wrap/unwrap fenced code block around selection

  **Structure:**
  - `markdown-promote-heading` — decrease heading level (`##` → `#`)
  - `markdown-demote-heading` — increase heading level (`##` → `###`)
  - `markdown-insert-heading(level)` — insert new heading at given level

  **Tables:**
  - `markdown-align-table` — parse and re-align the pipe table at point

  **Lists:**
  - `markdown-insert-list-item` — insert a new list item below current, matching marker and indent
  - `markdown-renumber-list` — renumber the ordered list at point

  **Links:**
  - `markdown-follow-link` — open URL or file reference under cursor via `open` / `xdg-open`
  - `markdown-insert-link` — prompt for URL and text, insert inline link

  **Utility:**
  - `markdown-generate-toc` — scan headings and generate TOC with anchor links
  - `markdown-do` — context-aware action at point (fold on heading, follow link, toggle checkbox)
  - `markdown-preview` — render markdown using `glow` (if available) or ANSI split-pane fallback, displayed in a pager inside the terminal

- Add `(provide "markdown-commands")`

### Step 8: Add Markdown Key Bindings

- In `src/tlisp/core/modes/markdown-mode.tlisp`, add mode-specific key bindings:
  - `]h` → `markdown-next-heading`
  - `[h` → `markdown-prev-heading`
  - `]H` → `markdown-next-same-level-heading`
  - `[H` → `markdown-prev-same-level-heading`
  - `gh` → `markdown-up-heading`
  - `TAB` → `markdown-visibility-cycle` (on heading lines)
  - `zc` → `markdown-fold-toggle` (close fold)
  - `zo` → `markdown-fold-toggle` (open fold)
  - `zM` → `markdown-fold-all`
  - `zR` → `markdown-unfold-all`
  - `z1` through `z6` → `markdown-fold-by-level(N)`
  - `,b` → `markdown-toggle-bold` (local leader)
  - `,i` → `markdown-toggle-italic`
  - `,s` → `markdown-toggle-strikethrough`
  - `,x` → `markdown-toggle-code`
  - `,X` → `markdown-toggle-code-block`
  - `,h` → `markdown-promote-heading`
  - `,H` → `markdown-demote-heading`
  - `,t` → `markdown-align-table`
  - `,l` → `markdown-insert-list-item`
  - `,T` → `markdown-generate-toc`
  - `gx` → `markdown-follow-link`
  - `gO` → `markdown-heading-outline`
  - `,P` → `markdown-preview`

- Register bindings via `(key-bind "key" "(command)" "normal")` inside the mode's activation hook so they only apply when markdown mode is active

### Step 9: Add List Auto-Continuation

- Modify the insert handler's Enter behavior to detect when the current line matches a list item pattern (`^\s*[-*+]\s`, `^\s*\d+[.)]\s`)
- When it does, automatically insert the continuation marker on the new line:
  - Unordered: repeat the same marker (`-`, `*`, or `+`) at the same indent
  - Ordered: increment the number (`1.` → `2.`) at the same indent
- If the current line is an empty list item (just the marker, no content), clear it instead (exit the list)
- Wire this through the mode activation hook so it only applies in markdown mode

### Step 10: Tests

- Create `test/unit/markdown-tokenizer.test.ts`:
  - Test each token type is correctly identified (headings at all levels, bold, italic, code, links, lists, blockquotes, tables, front matter)
  - Test fenced code block state transitions (enter, content inside, exit)
  - Test nested formatting (bold containing italic, links in headings)
  - Test edge cases (escaped characters, empty documents, deeply nested lists)
- Create `test/unit/fold-ops.test.ts`:
  - Test fold toggle, open, close, close-all, open-all, fold-by-level
  - Test fold state isolation (folds in one buffer don't affect another)
  - Test cursor auto-expand (moving cursor into a collapsed region expands it)
- Create `test/unit/markdown-commands.test.ts`:
  - Test formatting toggles: wrap, unwrap, wrap with selection, unwrap at boundary
  - Test heading navigation: next/prev, same-level, up
  - Test heading promote/demote
  - Test table alignment (simple table, alignment markers, uneven rows)
  - Test list continuation (unordered, ordered, nested, exit-on-empty)
  - Test TOC generation

### Step 11: Validation

- Run `bun run typecheck:src` — zero type errors
- Run `bun run typecheck:test` — zero type errors
- Run `bun run typecheck` — zero type errors
- Run `bun test` — all existing tests pass, all new tests pass
- Run `bun run test:daemon` — daemon starts, opens a `.md` file, mode auto-detects as markdown, syntax highlighting renders correctly
- Manually verify: open a markdown file, fold/unfold sections, toggle formatting, navigate headings, format a table

## Testing Strategy

### Unit Tests

- **Tokenizer tests**: Each Markdown construct tested in isolation and in combination. Fenced code block state machine tested for enter/content/exit cycles. Multi-line constructs (code blocks, front matter) tested with line-by-line tokenization.
- **Fold operation tests**: Pure function tests for fold state transitions. Test toggle, open, close, close-all, open-all, fold-by-level with various heading structures.
- **Formatting toggle tests**: Test the wrap/unwrap logic for each inline format. Cover: no selection (word at point), selection, already-wrapped (unwrap), empty wrap (insert markers with cursor inside).
- **Table formatter tests**: Parse various pipe table formats, verify alignment output, test alignment markers (`:---:`, `---:`).
- **Navigation tests**: Test heading search in documents with various heading levels, missing levels, setext headings.

### Integration Tests

- **End-to-end mode activation**: Open a `.md` file via the daemon, verify the mode is set to "markdown", syntax highlighting is active, and markdown key bindings work.
- **Fold rendering**: Create a document with multiple heading sections, fold one section, verify the rendered output skips the hidden lines and shows the fold indicator.

### Edge Cases

- Empty Markdown file (no headings, no content)
- File with only front matter and no body
- Deeply nested heading hierarchy (levels 1–6, skipping levels)
- Fenced code blocks with tilde delimiters (`~~~`)
- Fenced code blocks with info strings and attributes (` ```typescript hljs `)
- Inline formatting spanning line boundaries
- Bold inside italic and vice versa
- Pipe tables with inconsistent column counts
- Task lists with mixed checked/unchecked items
- Reference-style links with multi-line definitions
- Documents with no headings (folding should be a no-op)

## Acceptance Criteria

1. Opening a `.md` file auto-activates `markdown` major mode and displays the mode name in the status line
2. All Markdown syntax elements are correctly highlighted: headings (6 levels with distinct colors), bold, italic, strikethrough, inline code, code blocks, links, images, lists, blockquotes, tables, horizontal rules, YAML front matter
3. `]h` / `[h` navigate to the next/previous heading; `]H` / `[H` navigate to same-level headings
4. `zc` folds the section under the cursor heading; `zo` unfolds it; the render pipeline hides folded lines and shows a `▶` fold indicator with line count
5. `zM` folds all sections; `zR` unfolds all; `z1`–`z6` fold by heading depth
6. TAB on a heading line cycles visibility: collapsed → subheadings → fully expanded
7. `,b` toggles bold (wraps `**` if unwrapped, removes `**` if wrapped); `,i`, `,s`, `,x` work identically for their formats
8. `,h` promotes the current heading (fewer `#`s); `,H` demotes it (more `#`s)
9. `,t` aligns the pipe table at point, respecting alignment markers
10. Pressing Enter on a list item auto-continues the list with the correct marker and indent
11. `,T` generates a table of contents from all headings in the document
12. `gx` opens the URL or file path under the cursor using the system's default handler
13. All new code has zero type errors (`bun run typecheck`)
14. All existing tests continue to pass with zero regressions

## Validation Commands

- `bun run typecheck:src` — Zero type errors in source
- `bun run typecheck:test` — Zero type errors in tests
- `bun run typecheck` — Full typecheck passes
- `bun test` — All tests pass (existing + new markdown/fold tests)
- `bun run test:daemon` — Daemon starts and serves a markdown file with correct mode activation
- `bun run test:ui:renderer` — Renderer tests pass (fold rendering verified)

## Notes

**Design decisions:**

- **Folding is generic infrastructure**, not markdown-specific. The `foldRanges` state and fold operations in TypeScript work for any language. Markdown headings are the first consumer; future modes (TypeScript brace blocks, Lisp defuns) can reuse the same system.
- **Heading regex is the single source of truth** for navigation, folding, TOC, and syntax highlighting — avoiding the Emacs markdown-mode weakness of maintaining separate regex sets.
- **Code block highlighting delegates to sub-tokenizers**: Inside fenced code blocks, the markdown tokenizer detects the info string (language identifier) and switches to the corresponding language's rules. This avoids the Emacs performance pitfall of instantiating full sub-modes.
- **Preview uses `glow` as the primary renderer**: `markdown-preview` (`,P`) shells out to `glow` which renders markdown as styled terminal output with headings, emphasis, code blocks, lists, blockquotes, tables, links, images, and horizontal rules — all in the terminal with full color. Falls back to an ANSI split-pane view if `glow` is not installed. No in-terminal HTML rendering; no browser context switch.
- **Smart toggles are the core UX primitive**: Every inline format command follows the same wrap/unwrap/insert-empty pattern. This reduces cognitive load and keybinding count.
- **The "do" command pattern** (from Emacs markdown-mode) is adopted: `SPC RET` or `,SPC` performs the most useful action for the context — fold on a heading, follow a link, toggle a checkbox, insert a list item.
- **Mode-specific key bindings** are registered in the mode's activation hook, not globally. This prevents key binding collisions when editing non-markdown files.

**Future considerations (out of scope for this spec):**

- Markdown linting (subset of markdownlint rules via T-Lisp)
- Paste image support (clipboard capture via platform tools)
- Code chunk execution (org-babel-style)
- Export pipeline (pandoc templates)
- Reference link management (jump to definition, auto-collect at end of file)
- Narrow-to-section (Emacs narrowing for focused editing)
- Markup hiding (render `**bold**` as **bold** with invisible markers — requires careful cursor handling)
