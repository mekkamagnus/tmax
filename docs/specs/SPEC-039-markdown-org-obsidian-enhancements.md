# Feature: Markdown-mode Org/Obsidian-inspired Enhancements

**Depends on:** RFC-011, SPEC-018 (markdown major mode)

### Prerequisites (must pass before implementation)

1. **[RFC-011](../rfcs/RFC-011-org-markdown-gap-analysis.md)** — Feature design, phased plan, effort estimates, and design decisions
2. **[SPEC-018](SPEC-018-markdown-major-mode.md)** — Current markdown-mode implementation (commands, keybindings, tokenizer, folding)

## Feature Description

Extends tmax's markdown-mode with Org-mode-inspired document editing capabilities and Obsidian-core Zettelkasten features. Adds six capability areas: subtree operations, tag navigation, executable code blocks, table formulas, YAML frontmatter, and wiki-link Zettelkasten (heading links, embeds, backlinks, unlinked mentions, templates, note composer). All features use native markdown syntax — no org-specific constructs.

## User Story

As a markdown-mode user
I want subtree editing, executable code blocks, tag navigation, wiki-links with backlinks, and frontmatter support
So that tmax's markdown-mode provides a modern structured document editing experience comparable to Org-mode and Obsidian

## Problem Statement

markdown-mode ships with heading navigation, folding, formatting, links, and tables — but lacks structure-level operations (subtree move/kill/copy), dynamic content (executable code blocks, table formulas), and Zettelkasten features (wiki-links, backlinks, embeds, frontmatter) that users expect from modern markdown tools.

## Solution Statement

1. Phase 1: Subtree operations + sparse tree filtering + `#tag` navigation + search operators
2. Phase 2: Executable code blocks with Babel-like evaluation and session support
3. Phase 3: Table formulas with arithmetic, functions, and cell references
4. Phase 4: Multi-format export engine (HTML, LaTeX, plain text)
5. Phase 5: Footnote navigation + include files + YAML frontmatter parsing
6. Phase 6: Wiki-links with heading/block references, embeds, backlinks, unlinked mentions, templates, and note composer

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| T-Lisp commands | `src/tlisp/core/commands/markdown.tlisp` | All commands are `defun` inside the existing `defmodule editor/commands/markdown` with `(export ...)` listing |
| Key bindings | `src/tlisp/core/modes/markdown-mode.tlisp` | Mode-scoped bindings via `(key-bind KEY CMD "normal" "markdown")` |
| Tokenizer | `src/syntax/languages/markdown.ts` | New token types follow `SyntaxRule` interface with pattern/type/priority |
| Fold operations | `src/editor/api/fold-ops.ts` | Pure functions taking state + heading ranges, returning `{foldRanges: Map}` |
| T-Lisp API primitives | `src/editor/tlisp-api.ts` | New primitives added to appropriate `api/*.ts` module, merged via `createEditorAPI()` |
| Testing | `rules/testing.md` | TDD: write failing test first, then implement |
| FP patterns | `rules/functional-programming.md` | Result/Option types for fallible operations |
| TypeScript style | `rules/typescript.md` | Bun APIs, no external deps |

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/tlisp/core/commands/markdown.tlisp` | Add subtree ops, tag navigation, footnote nav, frontmatter commands, wiki-link commands, embed commands, template commands, note composer | Must export all new public functions; private helpers stay unexported |
| `src/tlisp/core/modes/markdown-mode.tlisp` | Add key bindings for all new commands | Mode-scoped to `"markdown"`, normal mode |
| `src/syntax/languages/markdown.ts` | Add token rules for `#tag`, wiki-links `[[]]`, embeds `![[]]`, frontmatter YAML | Priority ordering must not conflict with existing rules |
| `src/editor/tlisp-api.ts` | Register new primitives: `shell-exec`, `shell-exec-session`, `file-rename`, `cache-get`/`cache-set`, `frontmatter-parse`/`frontmatter-serialize` | Follow existing `create*Ops()` factory pattern |
| `src/editor/api/fold-ops.ts` | No changes — subtree ops and sparse trees reuse existing functions | Pure functions, no side effects |
| `test/unit/markdown-commands.test.ts` | Add tests for subtree ops, sparse tree filtering, tag navigation | Follow existing `bun:test` patterns |
| `test/unit/markdown-follow-link.test.ts` | Extend with wiki-link, embed, backlink tests | Use `setupMdEditor` fixture pattern |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| `src/editor/api/process-ops.ts` | `shell-exec`, `shell-exec-session` primitives for code block execution | Factory pattern, `Bun.spawn`, no external deps |
| `src/editor/api/cache-ops.ts` | `cache-get`/`cache-set` for persistent K/V store (backlink cache, session state) | JSON file backing store, async |
| `src/editor/api/yaml-ops.ts` | `frontmatter-parse`/`frontmatter-serialize` for YAML frontmatter | Minimal YAML parser (no external deps) |
| `test/unit/markdown-code-blocks.test.ts` | Tests for executable code block parsing and execution | Integration tests with `createStartedEditor` |
| `test/unit/markdown-table-formulas.test.ts` | Tests for formula parsing, evaluation, table update | Unit tests for parser, integration for eval |
| `test/unit/markdown-wiki-links.test.ts` | Tests for wiki-link parsing, heading/block refs, embeds, backlinks | Integration tests |
| `test/unit/markdown-frontmatter.test.ts` | Tests for YAML frontmatter parse/get/set | Unit tests |

## Implementation Phases

### Phase 1: Subtree operations + sparse trees + tag navigation + search operators — 3 weeks

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] `findHeadingRanges` in `fold-ops.ts` returns correct ranges for nested headings
- [ ] `fold-close-all`, `fold-open` work correctly (existing tests pass)

#### Step 1: Subtree kill/copy/move

**User story:** As a markdown author, I want to kill, copy, and reorder entire heading subtrees, so that I can restructure documents efficiently.

**Description:** Add six subtree commands that operate on heading ranges computed by `findHeadingRanges`.

**MUST:**
- `markdown-kill-subtree` — delete heading + children, push text to kill ring
- `markdown-copy-subtree` — copy heading + children to kill ring
- `markdown-move-subtree-up` / `markdown-move-subtree-down` — reorder sibling subtrees by swapping with adjacent sibling
- `markdown-promote-subtree` / `markdown-demote-subtree` — adjust all heading levels in subtree by ±1

**MUST NOT:**
- Modify any fold operations (`fold-ops.ts`)
- Add new TypeScript primitives — use existing `buffer-delete-range`, `buffer-get-range`, `find-heading-ranges`

**Convention source:** `markdown.tlisp` command patterns (defun with docstring, buffer primitives)

**Acceptance criteria:**
- [ ] `markdown-kill-subtree` on `## Sub` with children deletes all lines and stores them in kill ring
- [ ] `markdown-promote-subtree` reduces all child heading levels by 1 (min `#`)
- [ ] `markdown-demote-subtree` increases all child heading levels by 1 (max `######`)
- [ ] `markdown-move-subtree-up` swaps subtree with preceding sibling (preserves content)
- [ ] Subtree operations on level-1 heading with 3 nested levels work correctly

#### Step 2: Sparse tree filtering

**User story:** As a markdown author, I want to filter visible headings by regex or level, so that I can focus on relevant sections in large documents.

**Description:** Add sparse tree commands that collapse all headings then selectively expand matches.

**MUST:**
- `markdown-sparse-tree-regex` — close all, expand only headings matching regex
- `markdown-sparse-tree-level` — show headings up to N, fold deeper
- `,f` keybinding for filter dispatch
- Search operators: `tag:VALUE`, `level:N`, `file:NAME`, `path:PATTERN` as structured query prefixes in the regex filter

**MUST NOT:**
- Modify the fold engine — reuse `fold-close-all` then selectively `fold-open`

**Convention source:** `markdown-fold-close-all`, `markdown-fold-open-all` existing patterns

**Acceptance criteria:**
- [ ] `markdown-sparse-tree-regex` with `"TODO"` shows only headings containing TODO, folds everything else
- [ ] `markdown-sparse-tree-level` with 2 shows only `#` and `##` headings
- [ ] Search operator `tag:review` filters headings containing `#review`
- [ ] Clearing sparse tree (`,f RET`) restores all headings to visible

#### Step 3: Tag navigation

**User story:** As a markdown author, I want to navigate between `#tag` occurrences and filter by tag, so that I can work with tagged content.

**Description:** Add tag parsing, navigation, and filter commands. Requires tokenizer update.

**MUST:**
- Add `tag` token type to markdown tokenizer (pattern: `(?<=\s|^)#[\w-]+`, priority: 43, after italic)
- `markdown-next-tag` / `markdown-prev-tag` — jump between `#tag` occurrences
- `markdown-tag-list` — collect unique tags, show in minibuffer for selection
- `markdown-sparse-tree-tag` — sparse tree filtering scoped to headings containing a given tag
- `]t` / `[t` keybindings

**MUST NOT:**
- Match `#` in headings (e.g. `## heading`) — only standalone `#tag` patterns
- Match `#` in URLs or code blocks

**Convention source:** Tokenizer rules in `markdown.ts`, navigation commands in `markdown.tlisp`

**Acceptance criteria:**
- [ ] `#important` in text is tokenized as `tag` type
- [ ] `## heading` is NOT tokenized as a tag (heading rule has higher priority)
- [ ] `]t` moves cursor to next `#tag` in buffer
- [ ] `markdown-tag-list` returns unique tags in buffer
- [ ] `markdown-sparse-tree-tag "review"` shows only headings containing `#review`

---

### Phase 2: Executable code blocks — 2-3 weeks

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 1 subtree operations pass all tests
- [ ] `Bun.spawn` works for basic shell execution (manual test)

#### Step 4: Block execution engine

**User story:** As a markdown author, I want to execute fenced code blocks and see results inline, so that I can use markdown as a literate programming environment.

**Description:** Add code block parsing and execution with result insertion.

**MUST:**
- Parse fenced code blocks: identify language tag (```` ```lang ````), extract source lines, detect existing `<!-- results: ... -->` blocks
- `markdown-execute-block` — run block under cursor, capture stdout/stderr, insert `<!-- results: OUTPUT -->` below
- Language dispatch: shell (`sh`/`bash`), TypeScript (`ts`/`tsx`), JavaScript (`js`/`jsx`), Python (`py`/`python`)
- Execution via `Bun.spawn` (new `process-ops.ts` module with `shell-exec` primitive)
- Confirmation prompt before execution (configurable via `markdown-safe-languages` variable)
- `markdown-clear-results` — remove results block below cursor
- `markdown-execute-all-blocks` — execute all blocks top-to-bottom
- Keybindings: `,e` execute block, `,E` execute all, `,kc` clear results

**MUST NOT:**
- Execute blocks without user confirmation (security)
- Support languages beyond sh/ts/js/py in this phase
- Block the editor during execution — use async execution with status updates

**Convention source:** `shell-command` primitive already exists in `tlisp-api.ts`; extend with `shell-exec` for structured output

**Acceptance criteria:**
- [ ] Cursor on ```` ```sh\necho hello\n``` ```` → `,e` → `<!-- results: hello -->` inserted below
- [ ] Result block is updated (not duplicated) on re-execution
- [ ] Confirmation prompt fires for non-whitelisted language
- [ ] `markdown-execute-all-blocks` executes blocks in document order
- [ ] `markdown-clear-results` removes the results comment below cursor
- [ ] TypeScript block executes via `bun run` and captures output
- [ ] Error output (stderr) is captured and displayed in results

#### Step 5: Session-based evaluation

**User story:** As a data analyst, I want code blocks to share state across executions, so that I can build incremental computations.

**Description:** Named sessions where blocks sharing a session name share process state.

**MUST:**
- Named sessions: ```` ```python {:session data} ```` — blocks sharing a session share state
- Session state: process kept alive between executions
- `markdown-kill-session` — terminate named session
- `markdown-list-sessions` — show active sessions
- Session timeout: auto-kill after configurable idle period
- `,ks` keybinding for kill session

**MUST NOT:**
- Leak processes — sessions must be killable and auto-expire
- Persist sessions across editor restarts

**Convention source:** `cache-ops.ts` for session state tracking

**Acceptance criteria:**
- [ ] Two Python blocks with `{:session data}` share variable state
- [ ] `markdown-kill-session "data"` terminates the session process
- [ ] `markdown-list-sessions` shows active session names
- [ ] Session auto-expires after idle timeout

---

### Phase 3: Table formulas — 2-3 weeks

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 2 code block execution passes all tests
- [ ] `markdown-align-table` works correctly (existing test)

#### Step 6: Formula parser and evaluator

**User story:** As a markdown author, I want to compute table cells from formulas, so that I can use GFM tables as lightweight spreadsheets.

**Description:** Add `<!-- tblfm: ... -->` formula support with cell references and functions.

**MUST:**
- Formula line format: `<!-- tblfm: @row$col=expression -->` (valid markdown HTML comment)
- Cell references: `@2$3` (row 2, col 3, 1-indexed), `@>` last row, `$>` last column
- Ranges: `@2$1..@5$3`
- Functions: `sum`, `mean`, `min`, `max`, `count`
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- `markdown-table-eval-formula` — compute and update cells, re-align table
- `markdown-table-insert-formula` — insert or edit formula line below table
- `,tf` keybinding

**MUST NOT:**
- Support complex spreadsheet features (conditionals, string functions, cross-table references)
- Modify table alignment logic — reuse existing `markdown-align-table`

**Convention source:** `markdown-align-table` pattern for table boundary detection

**Acceptance criteria:**
- [ ] Table with `<!-- tblfm: @2$3=@2$1+@2$2 -->` → eval → cell updated, table re-aligned
- [ ] `sum(@2$1..@5$1)` computes sum of range
- [ ] `@>$>` references bottom-right cell
- [ ] Formula line is valid HTML comment (invisible in rendered markdown)
- [ ] Multiple formula lines on one table all evaluate
- [ ] Division by zero produces error message, does not crash

---

### Phase 4: Export engine — 3-4 weeks

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Tokenizer produces correct token types for all markdown constructs
- [ ] Phase 3 table formulas pass all tests

#### Step 7: Export pipeline and backends

**User story:** As a markdown author, I want to export documents to HTML, LaTeX, and plain text, so that I can share polished output.

**Description:** Build export infrastructure with pluggable backends.

**MUST:**
- Parse markdown to intermediate representation using existing tokenizer tokens
- Backend interface: `(define-export-backend name render-fn)` in T-Lisp
- `markdown-export-dispatch` — which-key popup to choose backend
- HTML backend: headings → `<h1>`-`<h6>`, links → `<a>`, code blocks → `<pre><code class="lang">`, tables → `<table>`, inline formatting → `<strong>`/`<em>`/`<code>`
- Plain text backend: strip syntax, preserve structure
- LaTeX backend: headings → `\section`, code → `verbatim`, tables → `tabular`
- `,x` keybinding for export dispatch

**MUST NOT:**
- Add external dependencies for export (no markdown-it, no marked)
- Support PDF directly — LaTeX → PDF is a separate pipeline
- Handle every CommonMark edge case — start with the subset markdown-mode already tokenizes

**Convention source:** Tokenizer tokens from `markdown.ts`, which-key dispatch pattern

**Acceptance criteria:**
- [ ] Document with headings, bold, italic, code blocks, table exports to valid HTML
- [ ] Plain text export strips all syntax but preserves heading hierarchy
- [ ] LaTeX export produces compilable `.tex` source
- [ ] Export dispatch shows HTML, LaTeX, Plain text options via which-key
- [ ] Exported file is written to disk with appropriate extension

---

### Phase 5: Navigation extras + YAML frontmatter — 2 weeks

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 4 export engine passes all tests
- [ ] Existing link navigation (`markdown-follow-link`, `markdown-jump-back`) works

#### Step 8: Footnote navigation

**User story:** As a markdown author, I want to jump between footnote references and definitions, so that I can navigate long academic documents.

**Description:** Add footnote navigation commands.

**MUST:**
- `markdown-next-footnote` / `markdown-prev-footnote` — jump between `[^id]` references and `[^id]:` definitions
- `]f` / `[f` keybindings
- Bidirectional: from reference to definition, from definition to next reference

**MUST NOT:**
- Require new tokenizer rules — footnotes can be found via `string-match` on existing `link` tokens or line content

**Convention source:** `markdown-next-heading` / `markdown-prev-heading` navigation pattern

**Acceptance criteria:**
- [ ] On `[^1]` reference → `]f` → jumps to `[^1]:` definition
- [ ] On `[^1]:` definition → `]f` → jumps to next `[^2]` reference
- [ ] `[f` navigates backward through footnotes
- [ ] No footnotes in buffer → message "No footnotes found"

#### Step 9: Include-file transclusion

**User story:** As a markdown author, I want to follow file links as includes, so that I can navigate referenced documents.

**Description:** Extend `markdown-do` (`gx`) dispatch with include-file following.

**MUST:**
- `markdown-follow-include` — open referenced file from `![](path)` or `[](path)` at cursor
- Extend `markdown-do` dispatch to include this option

**MUST NOT:**
- Inline transcluded content — just open the file

**Convention source:** `markdown-open-file-link` existing pattern

**Acceptance criteria:**
- [ ] On `![](./other.md)` → `gx` → opens `other.md` in new buffer
- [ ] Relative paths resolved against current file directory

#### Step 10: YAML frontmatter parsing

**User story:** As a markdown author, I want to read and edit YAML frontmatter, so that I can manage document metadata.

**Description:** Add frontmatter parsing, tokenization, and T-Lisp access commands. Requires minimal YAML parser (no external deps).

**MUST:**
- Update tokenizer: `meta` rule at priority 100 already matches `^---$` — extend to recognize frontmatter region (opening `---` through closing `---`)
- Add `frontmatter` token type for YAML content between delimiters
- `markdown-frontmatter-get(key)` — read a frontmatter field value
- `markdown-frontmatter-set(key value)` — update or add a frontmatter field
- `markdown-frontmatter-show` — display all key-value pairs in minibuffer
- Template variable substitution: `{{date}}` → current date, `{{title}}` → filename sans extension, `{{tags}}` → frontmatter tags
- New `yaml-ops.ts` module with `frontmatter-parse`/`frontmatter-serialize` primitives
- `,m` keybinding for frontmatter dispatch

**MUST NOT:**
- Use an external YAML library — implement a minimal parser for flat key-value pairs only
- Support nested YAML objects or arrays in this phase

**Convention source:** `syntax-set-language` / `syntax-highlight-enable` pattern for tokenizer extension; `buffer-get-range`/`buffer-delete-range`/`buffer-insert` for editing

**Acceptance criteria:**
- [ ] File starting with `---\ntitle: Test\ntags: [a, b]\n---` — `markdown-frontmatter-get "title"` returns `"Test"`
- [ ] `markdown-frontmatter-set "date" "2026-06-11"` adds/updates the `date` field
- [ ] `markdown-frontmatter-show` displays all fields in minibuffer
- [ ] Frontmatter region is highlighted distinctly from body content
- [ ] File without frontmatter — `markdown-frontmatter-get` returns nil, no crash
- [ ] `{{date}}` in template expands to current date string

---

### Phase 6: Wiki-style linking + Zettelkasten — 4-5 weeks

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 5 frontmatter parsing and template variables work
- [ ] Link navigation (`markdown-follow-link`) works for standard markdown links
- [ ] `file-glob` primitive exists or is implemented

#### Step 11: Wiki-links with heading and block references

**User story:** As a Zettelkasten user, I want to link to specific headings and blocks in other files, so that I can create precise cross-references.

**Description:** Add `[[wiki-link]]` syntax with heading (`#heading`) and block (`^block-id`) suffixes.

**MUST:**
- Add `wiki-link` token type to tokenizer: `\[\[([^\]]+)\]\]`, priority 62 (above standard `link`)
- Add `wiki-link-embed` token type: `!\[\[([^\]]+)\]\]`, priority 67 (above `image`)
- Parse link target: `[[file]]`, `[[file#heading]]`, `[[file#^block-id]]`
- `markdown-insert-link-to-file` — find file via minibuffer, insert wiki-link with optional heading suffix
- `markdown-follow-wiki-link` — navigate to linked file (and heading/block if specified)
- `]l` / `[l` keybindings for next/prev wiki-link in buffer

**MUST NOT:**
- Autocomplete wiki-links in this step (that requires file index from Step 13)
- Implement block reference rendering — just navigate to the paragraph

**Convention source:** `markdown-follow-link` pattern for navigation; `markdown-link-at-point` pattern for parsing

**Acceptance criteria:**
- [ ] `[[other-note]]` tokenized as `wiki-link`, cursor on it → `gx` → opens `other-note.md`
- [ ] `[[other-note#Introduction]]` opens file and jumps to `## Introduction`
- [ ] `[[other-note#^def1]]` opens file and jumps to paragraph with `^def1`
- [ ] `]l` moves to next `[[]]` in buffer
- [ ] Broken wiki-link (file not found) shows error message, does not crash

#### Step 12: Embeds

**User story:** As a Zettelkasten user, I want to embed content from other files inline, so that I can compose documents from reusable pieces.

**Description:** Add `![[file]]` embed syntax that displays content inline in the viewport.

**MUST:**
- `![[file]]` — display file content inline (read-only in viewport)
- `![[file#heading]]` — display specific heading section
- `![[image.png]]` — display image path/alt text (no pixel rendering in TUI)
- `markdown-follow-embed` — navigate to source file
- `gx` on `![[]]` follows embed source

**MUST NOT:**
- Render images — TUI limitation, show path/alt text only
- Edit embedded content in place — read-only display

**Convention source:** `markdown-follow-link` navigation pattern; render pipeline in `buffer-lines.ts`

**Acceptance criteria:**
- [ ] `![[other-note]]` displays content of `other-note.md` inline in viewport
- [ ] `![[other-note#Intro]]` displays only the Intro section
- [ ] `![[photo.png]]` displays `photo.png` as text (path only)
- [ ] `gx` on embed navigates to source file
- [ ] Missing embed file shows `[embed not found: filename]`

#### Step 13: Backlinks + unlinked mentions

**User story:** As a Zettelkasten user, I want to see which files link to the current file, so that I can explore connections.

**Description:** Build a link index and backlink/unlinked-mention lookup system.

**MUST:**
- Backlink index: scan markdown files using `file-glob`, parse all `[[]]` links, build link graph
- `markdown-backlinks` — show files linking to current file
- Unlinked mentions: find files that reference current file's name without `[[]]`
- `markdown-unlinked-mentions` — display files with implicit references
- Persistent backlink cache (JSON file, updated on file save)
- `gb` keybinding for backlinks
- New `cache-ops.ts` module with `cache-get`/`cache-set` primitives

**MUST NOT:**
- Scan on every buffer switch — use persistent cache, update incrementally on save
- Scan non-markdown files

**Convention source:** `file-glob` primitive, `shell-command` for file system ops, `*markdown-link-ring*` defvar pattern for persistent state

**Acceptance criteria:**
- [ ] File A links to `[[File B]]` → `gb` in File B shows File A as backlink
- [ ] File C mentions "notes" in text but doesn't `[[link]]` to `notes.md` → appears as unlinked mention
- [ ] Backlink cache persists across editor sessions
- [ ] Cache is updated when a file is saved

#### Step 14: Templates + note composer

**User story:** As a Zettelkasten user, I want to create notes from templates and rename notes while updating all links, so that I can maintain a clean knowledge base.

**Description:** Template expansion system and note rename/move with link index update.

**MUST:**
- Template system: `markdown-new-from-template` — create note from `~/.config/tmax/templates/*.md`
- Template variables: `{{date}}`, `{{title}}`, `{{tags}}` expanded using frontmatter infrastructure (Phase 5 Step 10)
- Daily notes: `markdown-daily-note` — open or create `YYYY-MM-DD.md` from daily template
- Note composer: `markdown-rename-note` — rename file and update all `[[links]]` in the link index
- `markdown-move-note` — move file to new directory, update all links
- `,n` daily note, `,N` new from template

**MUST NOT:**
- Require templates to exist — daily note falls back to empty file with date heading
- Update links across non-markdown files

**Convention source:** `write-file-content` primitive, `find-file-open` command, Phase 5 frontmatter/template variables

**Acceptance criteria:**
- [ ] `,n` creates `2026-06-11.md` (or opens if exists) with daily template content
- [ ] Template with `{{date}}` expands to current date
- [ ] `markdown-rename-note "new-name"` renames file and updates all `[[old-name]]` → `[[new-name]]` across the index
- [ ] No template directory → daily note creates file with `# YYYY-MM-DD` heading
- [ ] Rename preview shows files that will be modified before executing

## Acceptance Criteria

1. All subtree operations work on nested headings up to 6 levels deep
2. Sparse tree filtering correctly collapses/expands based on regex, level, and tag queries
3. `#tag` tokens are highlighted and navigable without conflicting with heading syntax
4. Executable code blocks run shell, TypeScript, and Python with confirmation prompt
5. Session-based evaluation shares state between code blocks with the same session name
6. Table formulas update cells and re-align tables correctly
7. Export to HTML, LaTeX, and plain text produces valid output
8. Footnote navigation jumps between references and definitions bidirectionally
9. YAML frontmatter can be read, written, and displayed; template variables expand correctly
10. Wiki-links resolve to files, headings, and block references
11. Embeds display inline content from other files
12. Backlinks and unlinked mentions are accurate and cached persistently
13. Templates expand variables and daily notes create correctly
14. Note composer renames files and updates all cross-references
15. All new keybindings are scoped to normal mode + markdown major mode
16. No regressions in existing markdown-mode features

## Validation Commands

- `bun run typecheck:src` — Zero type errors in all source files
- `bun run typecheck:test` — Zero type errors in all test files
- `bun run test:unit` — All unit tests pass including new markdown tests
- `bun run test` — Full test suite passes with zero regressions
- `bun run build` — Build succeeds

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| HTML comments for code results (`<!-- results: ... -->`) | Valid markdown, invisible in renderers, no custom syntax | Custom `==>` prefix — not valid markdown, confuses parsers |
| HTML comments for table formulas (`<!-- tblfm: ... -->`) | Same rationale as results format | Org-style `#+TBLFM:` — not valid markdown |
| `[[link]]` wiki-link syntax | Matches Obsidian/Org-roam convention users expect | `[link]` — ambiguous with standard markdown links |
| Minimal YAML parser (no external deps) | Project has zero external dependency policy | `js-yaml` library — violates zero-dep constraint |
| `Bun.spawn` for code execution | Already available in runtime, no external deps | `child_process.exec` — Bun prefers `Bun.spawn` |
| Persistent JSON cache for backlinks | Simple, human-readable, no external deps | SQLite — overkill for this use case |
| `#tag` as dedicated token type | Enables tag-specific navigation and filtering distinct from heading `#` | Reuse `link` token type — no way to distinguish |

**Deferred to follow-up:**
- Code block autocomplete for wiki-links (needs full file index)
- Nested YAML objects/arrays in frontmatter
- Cross-table formula references
- PDF export (LaTeX → PDF pipeline)
- Block reference rendering (show referenced block content inline)
- Wiki-link autocomplete as-you-type
- Image rendering in TUI (terminal limitation)

## Edge Cases

- Subtree operation on last heading in file (no next sibling)
- Subtree promote of `#` heading (already at minimum level)
- Subtree demote of `######` heading (already at maximum level)
- Sparse tree filter with regex matching zero headings
- `#tag` inside inline code (should not be tokenized as tag)
- `#tag` inside fenced code block (should not be tokenized as tag)
- Code block execution with no language tag
- Code block execution when `<!-- results -->` already exists (update, don't duplicate)
- Session execution when process has crashed
- Table formula referencing cell outside table bounds
- Table formula dividing by zero
- Export of empty document
- Export of document with only frontmatter
- Footnote navigation when no footnotes exist
- Frontmatter set on file without existing frontmatter (insert at top)
- Frontmatter get on file without frontmatter (return nil)
- Wiki-link to non-existent file
- Embed of non-existent file
- Backlink cache when files are deleted externally
- Note rename when new name conflicts with existing file
- Template directory does not exist
- Daily note when date file already exists (open, don't overwrite)
- Multiple formula lines on one table
- `#tag` at start of line vs heading `#` — tokenizer priority ensures heading wins
