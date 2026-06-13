# RFC-011: Markdown-mode Org-inspired Enhancements

**Author:** Mekael Turner
**Date:** 2026-06-11
**Status:** PROPOSED
**Related:** RFC-003 §3.1, SPEC-018

## Abstract

Gap analysis between Emacs Org-mode's feature set and Obsidian's default features against tmax's current markdown-mode. Identifies which Org-mode-inspired and Obsidian-core features belong in markdown-mode and proposes a phased plan to implement them. Org-mode-specific features (TODO workflows, scheduling, property drawers, agenda, clocking, column view) are out of scope for markdown-mode and belong in a future dedicated org-mode major mode.

## Motivation

tmax's markdown-mode is the richest major mode shipped (~750 lines of T-Lisp commands, 30+ keybindings). It covers heading navigation, folding, formatting, links, tables, and structure editing well. But Org-mode users choose Org for capabilities that are language-agnostic, not org-syntax-specific: subtree manipulation, sparse filtering, footnote navigation, literate programming, and export.

This RFC answers: **which Org-mode capabilities and Obsidian default features make sense in markdown documents, and how do we implement them without turning markdown into org?**

The guiding principle: markdown-mode gets features that improve structured document editing and match what users expect from modern markdown tools like Obsidian. Features that require `.org` syntax (TODO state machines, scheduling, property drawers, agenda, clocking, column view) belong in a future org-mode and are listed here only for completeness.

## Current State

### What markdown-mode ships today

| Category | Features |
|----------|----------|
| Navigation | Next/prev heading, same-level heading, up-to-parent, heading outline (`gO`) |
| Folding | Toggle, open, close, close-all, open-all, fold-by-level (z1-z6), TAB visibility cycling, gutter markers |
| Formatting | Bold, italic, strikethrough, inline code, code block toggles |
| Structure | Heading promote/demote, insert at level |
| Lists | Auto-continue on Enter, insert item, renumber ordered lists |
| Links | URL/file/anchor following, jump-back ring (20 entries), `gx` context dispatch |
| Tables | GFM pipe table alignment |
| Utility | TOC generation, checkbox toggle (`[ ]`/`[x]`), `glow` preview |
| Highlighting | 18 token types with One Dark theme |

### Reusable infrastructure

The TypeScript fold engine (`fold-ops.ts`) and heading range finder (`findHeadingRanges`) are language-agnostic. The render pipeline already handles collapsed ranges, fold indicators, and gutter markers generically. The fenced code block tokenizer already tracks enter/content/exit state. Any heading-based or block-based feature gets folding and highlighting for free.

---

## Gap Analysis

### Features that belong in markdown-mode

These are language-agnostic document editing capabilities that improve markdown documents without requiring org syntax:

| Org/Obsidian Feature | tmax Status | Rationale for markdown | Effort |
|----------------------|-------------|------------------------|--------|
| Subtree operations (move/kill/copy/promote/demote entire subtrees) | Heading promote/demote only | Heading ranges are already computed; subtree ops are structure editing, not org-specific | 1 week |
| Sparse tree filtering (regex/level filter with subtree visibility) | Heading outline (`gO`) only | Folding engine already exists; filtering is a natural extension | 1 week |
| Tag navigation (`#tag` parsing, jump, filter) | Tags highlighted as inline spans only | `#tag` is standard markdown convention; tag-aware navigation is an Obsidian core feature | 1 week |
| Search operators (`tag:`, `file:`, `path:`) | None | Structured search queries extend sparse tree filtering and heading outline (Obsidian parity) | included above |
| Executable code blocks (Babel-like evaluation of fenced blocks) | None | Fenced code blocks are native markdown syntax; execution is a power-user feature | 2-3 weeks |
| Table formulas (arithmetic formulas in GFM tables) | GFM alignment only | Tables are a core markdown construct; formulas make them practical | 2-3 weeks |
| Export engine (HTML, LaTeX, plain text) | `glow` preview only | Every structured document editor needs export | 3-4 weeks |
| Footnote navigation | None | Footnotes are standard markdown (`[^id]`) | 0.5 weeks |
| Include files (transclusion) | None | `markdown-do` can already open files; transclusion extends this | 0.5 weeks |
| YAML frontmatter parsing | None | Standard markdown convention; Obsidian uses frontmatter for properties, templates depend on it | 1 week |
| Wiki-links with heading/block references (`[[file#heading]]`, `[[file#^block]]`) | Jump-back ring only | Obsidian core feature; heading links are the most-used wiki-link variant | 1.5 weeks |
| Embeds (`![[file]]`, `![[file#heading]]`) | None | Obsidian core feature; inline content from other files | 1 week |
| Backlinks + unlinked mentions | Jump-back ring only | Obsidian core feature; unlinked mentions find implicit references | 1 week |
| Templates + note composer | None | Obsidian core features; template expansion + rename-with-link-update | 0.5-1 week |

**Total: ~16-22 weeks**

### Features that do NOT belong in markdown-mode

These require `.org` syntax or concepts that have no markdown equivalent. Listed here to define the boundary:

| Feature | Why not markdown | Future home |
|---------|-----------------|-------------|
| TODO state workflows | No state machine syntax in markdown; checkboxes are binary | org-mode |
| Scheduling & deadlines | No timestamp syntax (`SCHEDULED:`, `DEADLINE:`) | org-mode |
| Property drawers | No per-heading metadata syntax in markdown | org-mode |
| Tags (per-heading, inherited) | Org-style `:tag:` syntax has no markdown equivalent; `#tag` navigation is covered in Phase 1 | org-mode |
| Agenda views | Aggregates TODO+scheduling across files — requires org data model | org-mode |
| Capture templates | Targets org-specific template expansion | org-mode |
| Clocking | Requires `:LOGBOOK:` drawers | org-mode |
| Column view | Requires property drawers | org-mode |

---

## Implementation Plan

### Phase 1: Subtree operations + sparse trees + tag navigation (3 weeks)

Foundation for all structure-aware features.

**1a. Subtree operations (1 week)**
- `markdown-kill-subtree` — delete heading and all children, push to kill ring
- `markdown-copy-subtree` — copy heading and all children
- `markdown-move-subtree-up` / `markdown-move-subtree-down` — reorder sibling subtrees
- `markdown-promote-subtree` / `markdown-demote-subtree` — adjust all child heading levels
- Implementation: use `findHeadingRanges` to identify subtree boundaries, operate on line ranges

**1b. Sparse tree filtering + search operators (1 week)**
- `markdown-sparse-tree-regex` — collapse all, expand only headings matching regex
- `markdown-sparse-tree-level` — show headings up to N, fold deeper
- Reuse fold engine: close all, then selectively open matching ranges
- Search operators for sparse tree and heading outline: `tag:`, `file:`, `path:`, `level:` — filter headings by structured criteria (Obsidian parity)
- `,f` keybinding for filter dispatch

**1c. Tag navigation (1 week)**
- Parse `#tag` tokens in markdown tokenizer (already highlighted as inline spans; promote to dedicated token type)
- `markdown-next-tag` / `markdown-prev-tag` — jump between `#tag` occurrences in buffer
- `markdown-tag-list` — collect all unique tags in buffer, show in minibuffer for selection
- `markdown-sparse-tree-tag` — sparse tree filtering scoped to headings containing a given tag
- `]t` / `[t` keybindings for tag navigation
- Tag index per-buffer (build on demand, cache for session)

### Phase 2: Executable code blocks (2-3 weeks)

The flagship feature: fenced code blocks become live, executable cells. Inspired by Org Babel but using native markdown syntax.

**2a. Block execution engine (1.5 weeks)**
- Parse fenced code blocks: identify language tag, extract source lines
- `markdown-execute-block` — run block under cursor, capture stdout/stderr
- Insert results as a `<!-- results -->` comment block below the source block
- Result format:
  ```
  ```python
  print(2 + 2)
  ```
  <!-- results: 4 -->
  ```
- Language dispatch: shell (`sh`), TypeScript/JavaScript (`ts`/`js`), Python (`py`)
- Execution via `Bun.spawn` — no external dependencies
- Confirmation prompt before execution (configurable per-language whitelist)

**2b. Session-based evaluation (1 week)**
- Named sessions: ` ```python {:session data} ` — blocks sharing a session share state
- Session state: process kept alive between executions
- `markdown-kill-session` — terminate named session
- `markdown-list-sessions` — show active sessions

**2c. Block editing helpers (0.5 weeks)**
- `markdown-send-block` — send block to results without inserting (for side-effect blocks)
- `markdown-clear-results` — remove results block below cursor
- `markdown-execute-all-blocks` — execute all blocks top-to-bottom (literate programming)
- Syntax highlighting: style result blocks differently from source blocks

**Key bindings:**
| Key | Command |
|-----|---------|
| `,e` | `markdown-execute-block` |
| `,E` | `markdown-execute-all-blocks` |
| `,kc` | `markdown-clear-results` |
| `,ks` | `markdown-kill-session` |

### Phase 3: Table formulas (2-3 weeks)

Spreadsheet-level computation in GFM tables.

- `#+TBLFM:` equivalent: formula line below table (use HTML comment to stay valid markdown: `<!-- tblfm: @2$3=@2$1+@2$2 -->`)
- Cell references: `@row$col` (1-indexed), `@>` last row, `$>` last column
- Ranges: `@2$1..@5$3`
- Functions: `sum`, `mean`, `min`, `max`, `count`
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- `markdown-table-eval-formula` — compute and update cells, re-align table
- `markdown-table-insert-formula` — insert or edit formula line

**Key bindings:**
| Key | Command |
|-----|---------|
| `,tf` | `markdown-table-eval-formula` |

### Phase 4: Export engine (3-4 weeks)

Multi-format export for markdown documents.

**4a. Export pipeline (1.5 weeks)**
- Parse markdown to intermediate AST (reuse tokenizer tokens)
- Backend interface: `(define-export-backend name render-fn)`
- `markdown-export-dispatch` — which-key popup to choose backend

**4b. Backends (1.5-2.5 weeks)**
- HTML: headings → `<h1>`-`<h6>`, links → `<a>`, code blocks → `<pre><code>` with language class, tables → `<table>`, inline formatting → `<strong>`/`<em>`/`<code>`
- Plain text: strip syntax, preserve structure
- LaTeX: markdown → LaTeX source (headings → `\section`, code → `verbatim`, etc.)

**Key bindings:**
| Key | Command |
|-----|---------|
| `,x` | `markdown-export-dispatch` |

### Phase 5: Navigation extras + frontmatter (2 weeks)

Smaller features that round out the document editing experience.

**5a. Footnote navigation (0.5 weeks)**
- `markdown-next-footnote` / `markdown-prev-footnote`
- Jump between `[^id]` references and `[^id]:` definitions
- Keybinding: `]f` / `[f`

**5b. Include-file transclusion (0.5 weeks)**
- `markdown-follow-include` — open referenced file
- Support `![description](path)` and `[link](path)` as include candidates
- Extend `markdown-do` dispatch

**5c. YAML frontmatter (1 week)**
- Parse `---`-delimited frontmatter block at file start (standard markdown convention, Obsidian parity)
- Tokenizer: recognize frontmatter as a distinct region, highlight as YAML
- `markdown-frontmatter-get(key)` — read a frontmatter field value (T-Lisp primitive)
- `markdown-frontmatter-set(key value)` — update or add a frontmatter field
- `markdown-frontmatter-show` — display all frontmatter key-value pairs in minibuffer
- Template variable substitution: `{{date}}`, `{{title}}`, `{{tags}}` in frontmatter (foundation for Phase 6 templates)
- `,m` keybinding for frontmatter dispatch

### Phase 6: Wiki-style linking + Zettelkasten (4-5 weeks)

Org-roam/Obsidian-inspired features adapted to markdown's wiki-link syntax. This phase assumes the link index infrastructure from Phase 5 and frontmatter from Phase 5c.

**6a. Wiki-links with heading and block references (1.5 weeks)**
- `[[wiki-link]]` syntax support in tokenizer (Obsidian parity)
- `[[file#heading]]` — link to specific heading in target file (Obsidian parity)
- `[[file#^block-id]]` — link to specific paragraph/block marked with `^block-id` (Obsidian parity)
- `markdown-insert-link-to-file` — find file, insert wiki-link with optional heading/block suffix
- Autocomplete wiki-links against file index as user types `[[`

**6b. Embeds (1 week)**
- `![[file]]` — embed content from another file inline (read-only display in viewport, Obsidian parity)
- `![[file#heading]]` — embed specific heading section from another file
- `![[image.png]]` — display image path/alt text (no pixel rendering in TUI)
- Tokenizer: recognize `![[...]]` as embed tokens distinct from `[[]]` links
- `markdown-follow-embed` — navigate to source of embedded content

**6c. Backlinks + unlinked mentions (1 week)**
- Backlink index: scan markdown files, build link graph
- `markdown-backlinks` — show files linking to current file
- Unlinked mentions: find files that reference the current file's name without explicit `[[link]]` (Obsidian parity)
- `markdown-unlinked-mentions` — display files with implicit references
- Persistent backlink cache (JSON file, updated on file save)

**6d. Templates + note composer (0.5-1 week)**
- Template system: `markdown-new-from-template` — create new note from `~/.config/tmax/templates/` directory
- Template variables: `{{date}}`, `{{title}}`, `{{tags}}` substituted from frontmatter (uses Phase 5c infrastructure)
- Daily notes: `markdown-daily-note` — open or create `YYYY-MM-DD.md` from daily template
- Note composer: `markdown-rename-note` — rename current file and update all `[[links]]` across the link index (Obsidian parity)
- `markdown-move-note` — move file to new path, update all links

**Key bindings:**
| Key | Command |
|-----|---------|
| `gb` | `markdown-backlinks` (repurposed from jump-back when on empty line) |
| `,n` | `markdown-daily-note` |
| `,N` | `markdown-new-from-template` |
| `]l` / `[l` | Next/prev wiki-link in buffer |
| `gx` (on `![[...]]`) | Follow embed source |

---

## New T-Lisp Primitives Needed

### Process execution (for code block evaluation)
- `shell-exec(cmd)` — execute command, return stdout/stderr/exit-code
- `shell-exec-session(name cmd)` — send command to persistent session

### File scanning (for backlink index, daily notes, templates)
- `file-glob(pattern)` — list files matching glob
- `file-read-lines(path start end)` — read line range without opening full buffer
- `file-rename(old-path new-path)` — rename file, used by note composer

### Persistent storage (for backlink cache, session state)
- `cache-get(key)` / `cache-set(key value)` — lightweight K/V store

### YAML frontmatter (for frontmatter parsing)
- `frontmatter-parse(text)` — parse YAML frontmatter block, return alist
- `frontmatter-serialize(alist)` — serialize alist back to YAML frontmatter string

### Existing (reused)
- `fold-toggle`, `fold-open`, `fold-close`, `fold-close-all`, `fold-open-all`, `fold-by-level`
- `findHeadingRanges`
- `buffer-text`, `buffer-line-count`, `buffer-line`, `cursor-line`, `cursor-column`
- `insert-text`, `delete-range`, `replace-range`

---

## Key Bindings Summary

New keybindings added by this RFC (all scoped to normal mode + markdown major mode):

| Key | Command | Phase |
|-----|---------|-------|
| `,e` | `markdown-execute-block` | 2 |
| `,E` | `markdown-execute-all-blocks` | 2 |
| `,kc` | `markdown-clear-results` | 2 |
| `,ks` | `markdown-kill-session` | 2 |
| `,tf` | `markdown-table-eval-formula` | 3 |
| `,x` | `markdown-export-dispatch` | 4 |
| `]f` / `[f` | Footnote navigation | 5 |
| `,m` | Frontmatter dispatch | 5 |
| `gb` | `markdown-backlinks` | 6 |
| `,n` | `markdown-daily-note` | 6 |
| `,N` | `markdown-new-from-template` | 6 |
| `]l` / `[l` | Next/prev wiki-link | 6 |
| `]t` / `[t` | Next/prev tag | 1 |

Existing keybindings extended:
| Key | Change | Phase |
|-----|--------|-------|
| `gx` (`markdown-do`) | Add dispatch to include-file following + embed source | 5, 6 |
| `,t` | After `,tf` dispatch for table formulas | 3 |
| `,f` | Filter dispatch (sparse tree + search operators) | 1 |

---

## Testing Strategy

**Phase 1:**
- Unit tests for subtree kill/copy/move (verify line ranges)
- Unit tests for sparse tree filtering (verify fold state after filter)
- Renderer test: collapsed subtree shows correct line count
- Unit tests for `#tag` parsing and navigation (verify tag positions in buffer)
- Unit tests for search operators: `tag:`, `file:`, `path:`, `level:` filter headings correctly

**Phase 2:**
- Unit tests for block parsing (identify language, extract source, detect existing results)
- Integration tests: execute shell block, verify result insertion
- Integration tests: execute TypeScript block via `Bun.spawn`, verify output
- Integration tests: session-based evaluation (state persists between blocks)
- Security test: confirmation prompt fires, whitelist enforced

**Phase 3:**
- Unit tests for formula parsing (cell references, ranges, functions)
- Unit tests for formula evaluation (arithmetic, sum, mean)
- Integration test: table with formula → eval → verify updated cells

**Phase 4:**
- Per-backend tests: markdown source → export → verify output structure
- Round-trip test: export to HTML, verify all document elements present

**Phase 5:**
- Footnote round-trip: define, reference, navigate between them
- Frontmatter parsing: valid YAML, missing frontmatter, malformed YAML
- Frontmatter get/set: read fields, update fields, preserve non-target fields
- Template variable substitution: `{{date}}`, `{{title}}`, `{{tags}}` expand correctly

**Phase 6:**
- Backlink accuracy: create 3 files with cross-links, verify index
- Wiki-link variants: `[[file]]`, `[[file#heading]]`, `[[file#^block]]` all resolve correctly
- Embed rendering: `![[file]]` and `![[file#heading]]` display inline content
- Unlinked mentions: file referenced by name without `[[]]` appears in mentions
- Note composer: rename file, verify all `[[links]]` across index updated

---

## Effort Summary

| Phase | Features | Effort | Depends On |
|-------|----------|--------|------------|
| Phase 1 | Subtree operations + sparse trees + tag navigation + search operators | 3 weeks | Current markdown-mode |
| Phase 2 | Executable code blocks (Babel-like) | 2-3 weeks | Phase 1 |
| Phase 3 | Table formulas | 2-3 weeks | Current table alignment |
| Phase 4 | Export engine | 3-4 weeks | Current tokenizer |
| Phase 5 | Footnotes + include files + YAML frontmatter | 2 weeks | Current link navigation |
| Phase 6 | Wiki-links + heading/block refs + embeds + backlinks + unlinked mentions + templates + note composer | 4-5 weeks | Phase 5, file scanning primitives |
| **Total** | | **16-22 weeks** | |

Phases 1-2 are the highest value: subtree ops make structure editing practical, and executable code blocks make markdown a literate programming environment. Phase 6 brings Obsidian parity for Zettelkasten workflows. Phases 3-5 can ship incrementally in any order.

---

## Risks

1. **Code block execution security.** Running arbitrary code is inherently risky. Mitigate with per-language whitelist, confirmation prompt, and a `markdown-safe-languages` config option.
2. **Session management.** Long-running sessions can leak resources. Mitigate with session timeouts and explicit kill commands.
3. **Export accuracy.** Markdown has many edge cases (nested formatting, edge-case table syntax). Start with the CommonMark subset that markdown-mode already tokenizes.
4. **Backlink index performance.** Scanning many files on every open is slow. Mitigate with a persistent cache updated on file save.
5. **Embed rendering in TUI.** Inline display of embedded content from other files is limited by terminal capabilities. Start with text-only embedding; image embedding shows path/alt text only.
6. **Note composer safety.** Renaming files and bulk-updating links across the index is destructive. Mitigate with dry-run preview and undo support.

## Open Questions

1. **Results format.** Should code block results be stored as HTML comments (`<!-- results: ... -->`), markdown comments, or a custom syntax? HTML comments are invisible in rendered markdown but may interfere with static site generators. Recommendation: HTML comments with a `results:` prefix.

2. **Formula line format.** Should table formulas use `<!-- tblfm: ... -->` (valid markdown) or a custom convention like a trailing colon in the separator line? Recommendation: HTML comment for standards compliance.

3. **Wiki-link syntax.** Should wiki links use `[[link]]` (Org/Obsidian style) or `[link]` (standard markdown)? Recommendation: `[[link]]` to disambiguate from standard links and match the convention users expect from Obsidian/Org-roam.

## Future Work: org-mode

A dedicated org-mode major mode (`.org` files) will handle features that don't fit markdown syntax:

- TODO state workflows with custom keywords
- Scheduling, deadlines, and timestamps
- Property drawers and tag inheritance
- Agenda views across files
- Capture templates and refile
- Clocking and column view

This is tracked in RFC-003 §3.1 and estimated at 10-14 additional weeks. The markdown-mode enhancements in this RFC build the shared substrate (subtree ops, fold-based filtering, code block infrastructure) that org-mode will reuse.
