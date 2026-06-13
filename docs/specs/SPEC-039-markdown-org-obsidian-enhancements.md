# Spec: Markdown-mode Org/Obsidian-inspired Enhancements (SPEC-039)

**Status:** Implementation complete — 26 new tests pass, 0 regressions (2134 total). Code review identified 2 critical and 5 required issues. See Review Findings and acceptance criteria for per-item status.

**Depends on:** RFC-011, SPEC-018 (markdown major mode)

## Objective

Extends tmax's markdown-mode with Org-mode-inspired document editing capabilities and Obsidian-core Zettelkasten features. Adds six capability areas: subtree operations, tag navigation, executable code blocks, table formulas, YAML frontmatter, and wiki-link Zettelkasten (heading links, embeds, backlinks, unlinked mentions, templates, note composer). All features use native markdown syntax — no org-specific constructs.

**User story:** As a markdown-mode user, I want subtree editing, executable code blocks, tag navigation, wiki-links with backlinks, and frontmatter support so that tmax's markdown-mode provides a modern structured document editing experience comparable to Org-mode and Obsidian.

**Problem:** markdown-mode ships with heading navigation, folding, formatting, links, and tables — but lacks structure-level operations (subtree move/kill/copy), dynamic content (executable code blocks, table formulas), and Zettelkasten features (wiki-links, backlinks, embeds, frontmatter) that users expect from modern markdown tools.

**Solution (6 phases):**

1. Phase 1: Subtree operations + sparse tree filtering + `#tag` navigation + search operators
2. Phase 2: Executable code blocks with Babel-like evaluation and session support
3. Phase 3: Table formulas with arithmetic, functions, and cell references
4. Phase 4: Multi-format export engine (HTML, LaTeX, plain text)
5. Phase 5: Footnote navigation + include files + YAML frontmatter parsing
6. Phase 6: Wiki-links with heading/block references, embeds, backlinks, unlinked mentions, templates, and note composer

### Prerequisites

1. **[RFC-011](../rfcs/RFC-011-org-markdown-gap-analysis.md)** — Feature design, phased plan, effort estimates, and design decisions
2. **[SPEC-018](SPEC-018-markdown-major-mode.md)** — Current markdown-mode implementation (commands, keybindings, tokenizer, folding)

## Commands

```
Type check:  bun run typecheck:src
Test types:  bun run typecheck:test
All checks:  bun run typecheck
Unit tests:  bun run test:unit
Full suite:  bun run test
Build:       bun run build
Daemon test: bun run test:daemon
```

## Project Structure

```
src/tlisp/core/commands/markdown.tlisp   → All T-Lisp commands (defun + export)
src/tlisp/core/modes/markdown-mode.tlisp → Mode-scoped key bindings
src/syntax/languages/markdown.ts         → Tokenizer rules (SyntaxRule)
src/editor/tlisp-api.ts                  → TypeScript primitives (shell-exec, cache-get, etc.)
src/editor/api/fold-ops.ts               → Fold operations (pure functions, no changes needed)
test/unit/markdown-spec-039.test.ts      → Integration tests for all 6 phases
test/unit/markdown-commands.test.ts      → Existing markdown command tests
test/unit/markdown-follow-link.test.ts   → Link navigation tests
test/unit/markdown-tokenizer.test.ts     → Tokenizer tests (tag, wiki-link, embed tokens)
```

## Code Style

**T-Lisp commands** — `defun` inside `defmodule`, exported, using buffer primitives:

```lisp
(defun markdown-next-tag ()
  "Jump to next #tag in buffer."
  (let ((tags (markdown-scan-tags)))
    (if (null tags)
      (message "No tags found")
      (let ((line (cursor-line)))
        (if (markdown-goto-next-tag tags line)
          (message "")
          (message "No more tags"))))))
```

**TypeScript primitives** — Factory pattern, added to `createEditorAPI()`:

```typescript
api.set('shell-exec', (args: TLispValue[]): Either<AppError, TLispValue> => {
  const cmd = expectString(args[0]);
  const proc = Bun.spawnSync(['sh', '-c', cmd], { timeout: 30000 });
  return Either.right(makeList([
    makeString(proc.stdout?.toString() ?? ''),
    makeString(proc.stderr?.toString() ?? ''),
    makeNumber(proc.exitCode ?? 1),
  ]));
});
```

**Tokenizer rules** — `SyntaxRule` interface with pattern/type/priority:

```typescript
{ pattern: /\[\[[^\]]+\]\]/g, type: "wiki-link", priority: 62 },
{ pattern: /!\[\[[^\]]+\]\]/g, type: "wiki-link-embed", priority: 67 },
{ pattern: /(?:^|\s)#[a-zA-Z_-][a-zA-Z0-9_-]*/g, type: "tag", priority: 43 },
```

**Key conventions:**
- T-Lisp has NO `%` modulo operator — use `(- l (* r (/ l r)))`
- T-Lisp has NO `cond` — use nested `if`/`progn`
- `let` bindings are NOT visible in the same `let` block — use `set!` for sequential assignment
- All key bindings mode-scoped: `(key-bind KEY CMD "normal" "markdown")`
- **Multi-key bindings require space separators**: `"g h"`, `", b"`, `"z c"` — NOT `"gh"`, `",b"`, `"zc"`

## Testing Strategy

**Framework:** `bun:test` (`describe`/`test`/`expect`)

**Test locations:**
- `test/unit/markdown-spec-039.test.ts` — Integration tests for all 6 phases (26 tests)
- `test/unit/markdown-tokenizer.test.ts` — Tokenizer unit tests for new token types
- `test/unit/markdown-commands.test.ts` — Existing command tests (must not regress)

**Fixture pattern:**
```typescript
function setupMdEditor(content: string) {
  const { editor, env } = createStartedEditor();
  const mod = requireModule(editor, 'editor/commands/markdown');
  env.define('markdown-commands', mod);
  editor.setBufferContent(content);
  return { editor, env };
}
```

**Coverage expectations:**
- Every MUST criterion has at least one test
- Edge cases from the edge case list should have dedicated tests
- Regression baseline: 2134 tests must continue passing

## Boundaries

**Always:**
- Run `bun run typecheck:src` and `bun run test` before reporting completion
- Export all new public T-Lisp functions in the `(export ...)` list
- Scope key bindings to `"normal" "markdown"` mode
- Follow existing `defun` + docstring pattern in markdown.tlisp
- Follow `SyntaxRule` pattern with explicit priority for new token types
- Use `Bun.spawn`/`Bun.spawnSync` for shell operations (no `child_process`)

**Ask first:**
- Adding new TypeScript primitives beyond the 8 already added (`shell-exec`, `shell-exec-session`, `session-kill`, `session-list`, `file-glob`, `file-rename`, `cache-get`, `cache-set`)
- Modifying the fold engine (`fold-ops.ts`)
- Changing token priority values (affects precedence for all markdown highlighting)
- Adding new token types beyond `tag`, `wiki-link`, `wiki-link-embed`

**Never:**
- Add external dependencies (zero-dep policy)
- Use `%` modulo, `cond`, or other unsupported T-Lisp constructs
- Bind the same key to two different commands in the same mode
- Execute code blocks without user confirmation (security — currently a gap)
- Modify tokenizer rules without checking priority ordering against existing rules
- Delete or modify existing markdown tests to make new ones pass
- Use `Bun.spawnSync` without a `timeout` option
- Interpolate user input into shell commands (use `file-rename` primitive instead of `shell-command "mv ..."`)

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| T-Lisp commands | `src/tlisp/core/commands/markdown.tlisp` | All commands are `defun` inside the existing `defmodule editor/commands/markdown` with `(export ...)` listing |
| Key bindings | `src/tlisp/core/modes/markdown-mode.tlisp` | Mode-scoped bindings via `(key-bind KEY CMD "normal" "markdown")` |
| Tokenizer | `src/syntax/languages/markdown.ts` | New token types follow `SyntaxRule` interface with pattern/type/priority |
| Fold operations | `src/editor/api/fold-ops.ts` | Pure functions taking state + heading ranges, returning `{foldRanges: Map}` |
| T-Lisp API primitives | `src/editor/tlisp-api.ts` | New primitives added inline to `createEditorAPI()` (deviation: spec originally called for separate `api/*.ts` modules) |
| Testing | `rules/testing.md` | TDD: write failing test first, then implement |
| FP patterns | `rules/functional-programming.md` | Result/Option types for fallible operations |
| TypeScript style | `rules/typescript.md` | Bun APIs, no external deps |

## Relevant Files

### Modified Files

| File | Change | Status |
|------|--------|--------|
| `src/tlisp/core/commands/markdown.tlisp` | +940 lines: subtree ops, tag nav, code blocks, formulas, export, footnotes, frontmatter, wiki-links, templates, note composer | Done |
| `src/tlisp/core/modes/markdown-mode.tlisp` | +45 lines: key bindings for all new commands | Done (has `gb` and `]l`/`[l` bugs) |
| `src/syntax/languages/markdown.ts` | +3 rules: `tag` (priority 43), `wiki-link` (62), `wiki-link-embed` (67) | Done |
| `src/editor/tlisp-api.ts` | +99 lines: 8 new primitives inline | Done |
| `test/unit/markdown-tokenizer.test.ts` | +33 lines: tag, wiki-link, embed token tests | Done |

### New Files Created

| File | Purpose | Status |
|------|---------|--------|
| `test/unit/markdown-spec-039.test.ts` | Integration tests for all 6 phases | Created — 26 tests |

### Planned Files Not Created

| File | Original purpose | Why skipped |
|------|-----------------|-------------|
| `src/editor/api/process-ops.ts` | Shell execution primitives | Added inline to `tlisp-api.ts` |
| `src/editor/api/cache-ops.ts` | Persistent K/V store | Added inline (in-memory only) |
| `src/editor/api/yaml-ops.ts` | YAML frontmatter primitives | Parsed inline in T-Lisp |
| `test/unit/markdown-code-blocks.test.ts` | Code block tests | Covered by `markdown-spec-039.test.ts` |
| `test/unit/markdown-table-formulas.test.ts` | Formula tests | Covered by `markdown-spec-039.test.ts` |
| `test/unit/markdown-wiki-links.test.ts` | Wiki-link tests | Covered by `markdown-spec-039.test.ts` |
| `test/unit/markdown-frontmatter.test.ts` | Frontmatter tests | Covered by `markdown-spec-039.test.ts` |

## Implementation Phases

### Phase 1: Subtree operations + sparse trees + tag navigation — 3 weeks

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
- [x] `markdown-kill-subtree` on `## Sub` with children deletes all lines and stores them in kill ring
- [x] `markdown-promote-subtree` reduces all child heading levels by 1 (min `#`)
- [x] `markdown-demote-subtree` increases all child heading levels by 1 (max `######`)
- [x] `markdown-move-subtree-up` swaps subtree with preceding sibling (preserves content)
- [x] Subtree operations on level-1 heading with 3 nested levels work correctly

#### Step 2: Sparse tree filtering

**User story:** As a markdown author, I want to filter visible headings by regex or level, so that I can focus on relevant sections in large documents.

**Description:** Add sparse tree commands that collapse all headings then selectively expand matches.

**MUST:**
- `markdown-sparse-tree-regex` — close all, expand only headings matching regex
- `markdown-sparse-tree-level` — show headings up to N, fold deeper
- `,f` keybinding for filter dispatch
- ~~Search operators: `tag:VALUE`, `level:N`, `file:NAME`, `path:PATTERN` as structured query prefixes in the regex filter~~ **Not implemented** — only plain regex filtering works

**MUST NOT:**
- Modify the fold engine — reuse `fold-close-all` then selectively `fold-open`

**Convention source:** `markdown-fold-close-all`, `markdown-fold-open-all` existing patterns

**Acceptance criteria:**
- [x] `markdown-sparse-tree-regex` with `"TODO"` shows only headings containing TODO, folds everything else
- [x] `markdown-sparse-tree-level` with 2 shows only `#` and `##` headings
- [ ] ~~Search operator `tag:review` filters headings containing `#review`~~ **Not implemented**
- [x] Clearing sparse tree (`,f RET`) restores all headings to visible

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
- [x] `#important` in text is tokenized as `tag` type
- [x] `## heading` is NOT tokenized as a tag (heading rule has higher priority)
- [x] `]t` moves cursor to next `#tag` in buffer
- [x] `markdown-tag-list` returns unique tags in buffer
- [x] `markdown-sparse-tree-tag "review"` shows only headings containing `#review`

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
- Execution via `Bun.spawn` (`shell-exec` primitive added inline to `tlisp-api.ts`)
- ~~Confirmation prompt before execution (configurable via `markdown-safe-languages` variable)~~ **Not implemented** — blocks execute immediately without confirmation
- `markdown-clear-results` — remove results block below cursor
- `markdown-execute-all-blocks` — execute all blocks top-to-bottom
- Keybindings: `,e` execute block, `,E` execute all, `,kc` clear results

**MUST NOT:**
- Execute blocks without user confirmation (security)
- Support languages beyond sh/ts/js/py in this phase
- Block the editor during execution — use async execution with status updates

**Convention source:** `shell-command` primitive already exists in `tlisp-api.ts`; extend with `shell-exec` for structured output

**Acceptance criteria:**
- [x] Cursor on ```` ```sh\necho hello\n``` ```` → `,e` → `<!-- results: hello -->` inserted below
- [x] Result block is updated (not duplicated) on re-execution
- [ ] ~~Confirmation prompt fires for non-whitelisted language~~ **Not implemented** — security gap
- [x] `markdown-execute-all-blocks` executes blocks in document order
- [x] `markdown-clear-results` removes the results comment below cursor
- [x] TypeScript block executes via `bun run` and captures output
- [x] Error output (stderr) is captured and displayed in results

#### Step 5: Session-based evaluation

**User story:** As a data analyst, I want code blocks to share state across executions, so that I can build incremental computations.

**Description:** Named sessions where blocks sharing a session name share process state.

**MUST:**
- Named sessions: ```` ```python {:session data} ```` — blocks sharing a session share state
- Session state: process kept alive between executions
- `markdown-kill-session` — terminate named session
- `markdown-list-sessions` — show active sessions
- ~~Session timeout: auto-kill after configurable idle period~~ **Not implemented**
- `,ks` keybinding for kill session

**MUST NOT:**
- Leak processes — sessions must be killable and auto-expire
- Persist sessions across editor restarts

**Convention source:** `cache-ops.ts` for session state tracking

**Acceptance criteria:**
- [ ] ~~Two Python blocks with `{:session data}` share variable state~~ **Not working** — `shell-exec-session` spawns a transient process every time; the `sessions` Map is never populated
- [ ] ~~`markdown-kill-session "data"` terminates the session process~~ **Not working** — operates on an always-empty Map
- [ ] ~~`markdown-list-sessions` shows active session names~~ **Not working** — operates on an always-empty Map
- [ ] ~~Session auto-expires after idle timeout~~ **Not implemented**

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
- [x] Table with `<!-- tblfm: @2$3=@2$1+@2$2 -->` → eval → cell updated, table re-aligned
- [x] `sum(@2$1..@5$1)` computes sum of range
- [x] `@>$>` references bottom-right cell
- [x] Formula line is valid HTML comment (invisible in rendered markdown)
- [x] Multiple formula lines on one table all evaluate
- [x] Division by zero produces error message, does not crash

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
- [x] Document with headings, bold, italic, code blocks, table exports to valid HTML
- [x] Plain text export strips all syntax but preserves heading hierarchy
- [x] LaTeX export produces compilable `.tex` source
- [x] Export dispatch shows HTML, LaTeX, Plain text options via which-key
- [x] Exported file is written to disk with appropriate extension

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
- [x] On `[^1]` reference → `]f` → jumps to `[^1]:` definition
- [x] On `[^1]:` definition → `]f` → jumps to next `[^2]` reference
- [x] `[f` navigates backward through footnotes
- [x] No footnotes in buffer → message "No footnotes found"

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
- [x] On `![](./other.md)` → `gx` → opens `other.md` in new buffer
- [x] Relative paths resolved against current file directory

#### Step 10: YAML frontmatter parsing

**User story:** As a markdown author, I want to read and edit YAML frontmatter, so that I can manage document metadata.

**Description:** Add frontmatter parsing, tokenization, and T-Lisp access commands. Requires minimal YAML parser (no external deps).

**MUST:**
- Update tokenizer: `meta` rule at priority 100 already matches `^---$` — frontmatter region recognized by T-Lisp via `string-match`
- ~~Add `frontmatter` token type for YAML content between delimiters~~ **Not implemented** — no distinct frontmatter highlighting
- `markdown-frontmatter-get(key)` — read a frontmatter field value
- `markdown-frontmatter-set(key value)` — update or add a frontmatter field
- `markdown-frontmatter-show` — display all key-value pairs in minibuffer
- Template variable substitution: `{{date}}` → current date, `{{title}}` → filename sans extension (~~`{{tags}}` → frontmatter tags~~ **Not implemented**)
- ~~New `yaml-ops.ts` module with `frontmatter-parse`/`frontmatter-serialize` primitives~~ **Not created** — frontmatter parsed inline in T-Lisp
- `,m` keybinding for frontmatter dispatch

**MUST NOT:**
- Use an external YAML library — implement a minimal parser for flat key-value pairs only
- Support nested YAML objects or arrays in this phase

**Convention source:** `syntax-set-language` / `syntax-highlight-enable` pattern for tokenizer extension; `buffer-get-range`/`buffer-delete-range`/`buffer-insert` for editing

**Acceptance criteria:**
- [x] File starting with `---\ntitle: Test\ntags: [a, b]\n---` — `markdown-frontmatter-get "title"` returns `"Test"`
- [x] `markdown-frontmatter-set "date" "2026-06-11"` adds/updates the `date` field
- [x] `markdown-frontmatter-show` displays all fields in minibuffer
- [ ] ~~Frontmatter region is highlighted distinctly from body content~~ **Not implemented** — no `frontmatter` token type
- [x] File without frontmatter — `markdown-frontmatter-get` returns nil, no crash
- [x] `{{date}}` in template expands to current date string

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
- `]l` / `[l` keybindings for next/prev wiki-link in buffer **(Bug: currently bound to `markdown-next-heading`/`markdown-prev-heading` — duplicates `]h`/`[h`)**

**MUST NOT:**
- Autocomplete wiki-links in this step (that requires file index from Step 13)
- Implement block reference rendering — just navigate to the paragraph

**Convention source:** `markdown-follow-link` pattern for navigation; `markdown-link-at-point` pattern for parsing

**Acceptance criteria:**
- [x] `[[other-note]]` tokenized as `wiki-link`, cursor on it → `gx` → opens `other-note.md`
- [x] `[[other-note#Introduction]]` opens file and jumps to `## Introduction`
- [x] `[[other-note#^def1]]` opens file and jumps to paragraph with `^def1`
- [ ] `]l` moves to next `[[]]` in buffer **(Bug: bound to heading navigation instead)**
- [x] Broken wiki-link (file not found) shows error message, does not crash

#### Step 12: Embeds — **NOT IMPLEMENTED**

**User story:** As a Zettelkasten user, I want to embed content from other files inline, so that I can compose documents from reusable pieces.

**Description:** Add `![[file]]` embed syntax that displays content inline in the viewport.

**MUST:**
- `![[file]]` — display file content inline (read-only in viewport)
- `![[file#heading]]` — display specific heading section
- `![[image.png]]` — display image path/alt text (no pixel rendering in TUI)
- `markdown-follow-embed` — navigate to source file
- `gx` on `![[]]` follows embed source

**Note:** `wiki-link-embed` token type is added to the tokenizer, but no inline display or `markdown-follow-embed` command was implemented. Embed tokens are highlighted but not actionable.

**MUST NOT:**
- Render images — TUI limitation, show path/alt text only
- Edit embedded content in place — read-only display

**Convention source:** `markdown-follow-link` navigation pattern; render pipeline in `buffer-lines.ts`

**Acceptance criteria:**
- [ ] `![[other-note]]` displays content of `other-note.md` inline in viewport **(Not implemented)**
- [ ] `![[other-note#Intro]]` displays only the Intro section **(Not implemented)**
- [ ] `![[photo.png]]` displays `photo.png` as text (path only) **(Not implemented)**
- [ ] `gx` on embed navigates to source file **(Not implemented — no `markdown-follow-embed`)**
- [ ] Missing embed file shows `[embed not found: filename]` **(Not implemented)**

#### Step 13: Backlinks + unlinked mentions

**User story:** As a Zettelkasten user, I want to see which files link to the current file, so that I can explore connections.

**Description:** Build a link index and backlink/unlinked-mention lookup system.

**MUST:**
- Backlink index: scan markdown files using `file-glob`, parse all `[[]]` links, build link graph
- `markdown-backlinks` — show files linking to current file
- Unlinked mentions: find files that reference current file's name without `[[]]`
- ~~`markdown-unlinked-mentions` — display files with implicit references~~ **Not implemented**
- ~~Persistent backlink cache (JSON file, updated on file save)~~ **Not implemented** — in-memory Map only, lost on restart
- `gb` keybinding for backlinks **(Bug: conflicts with existing `gb` → `markdown-jump-back`; backlinks override takes precedence)**
- ~~New `cache-ops.ts` module with `cache-get`/`cache-set` primitives~~ **Not created** — primitives added inline to `tlisp-api.ts`

**MUST NOT:**
- Scan on every buffer switch — use persistent cache, update incrementally on save
- Scan non-markdown files

**Convention source:** `file-glob` primitive, `shell-command` for file system ops, `*markdown-link-ring*` defvar pattern for persistent state

**Acceptance criteria:**
- [x] File A links to `[[File B]]` → `gb` in File B shows File A as backlink
- [ ] ~~File C mentions "notes" in text but doesn't `[[link]]` to `notes.md` → appears as unlinked mention~~ **Not implemented**
- [ ] ~~Backlink cache persists across editor sessions~~ **Not implemented** — in-memory only
- [x] Cache is updated when a file is saved

#### Step 14: Templates + note composer

**User story:** As a Zettelkasten user, I want to create notes from templates and rename notes while updating all links, so that I can maintain a clean knowledge base.

**Description:** Template expansion system and note rename/move with link index update.

**MUST:**
- Template system: `markdown-new-from-template` — create note from `~/.config/tmax/templates/*.md`
- Template variables: `{{date}}`, `{{title}}`, `{{tags}}` expanded using frontmatter infrastructure (Phase 5 Step 10)
- Daily notes: `markdown-daily-note` — open or create `YYYY-MM-DD.md` from daily template
- Note composer: `markdown-rename-note` — rename file and update all `[[links]]` in the link index
- ~~`markdown-move-note` — move file to new directory, update all links~~ **Not implemented**
- `,n` daily note, `,N` new from template

**MUST NOT:**
- Require templates to exist — daily note falls back to empty file with date heading
- Update links across non-markdown files

**Convention source:** `write-file-content` primitive, `find-file-open` command, Phase 5 frontmatter/template variables

**Acceptance criteria:**
- [x] `,n` creates `2026-06-11.md` (or opens if exists) with daily template content
- [x] Template with `{{date}}` expands to current date
- [x] `markdown-rename-note "new-name"` renames file and updates all `[[old-name]]` → `[[new-name]]` across the index
- [x] No template directory → daily note creates file with `# YYYY-MM-DD` heading
- [ ] ~~Rename preview shows files that will be modified before executing~~ **Not implemented**

## Success Criteria

1. [x] All subtree operations work on nested headings up to 6 levels deep
2. [x] Sparse tree filtering correctly collapses/expands based on regex, level, and tag queries
3. [x] `#tag` tokens are highlighted and navigable without conflicting with heading syntax
4. [ ] ~~Executable code blocks run shell, TypeScript, and Python with confirmation prompt~~ **No confirmation prompt**
5. [ ] ~~Session-based evaluation shares state between code blocks with the same session name~~ **Not working** — `shell-exec-session` is a no-op
6. [x] Table formulas update cells and re-align tables correctly
7. [x] Export to HTML, LaTeX, and plain text produces valid output
8. [x] Footnote navigation jumps between references and definitions bidirectionally
9. [x] YAML frontmatter can be read, written, and displayed; template variables expand correctly
10. [x] Wiki-links resolve to files, headings, and block references
11. [ ] ~~Embeds display inline content from other files~~ **Not implemented**
12. [ ] ~~Backlinks and unlinked mentions are accurate and cached persistently~~ **No unlinked mentions, no persistent cache**
13. [x] Templates expand variables and daily notes create correctly
14. [x] Note composer renames files and updates all cross-references
15. [ ] ~~All new keybindings are scoped to normal mode + markdown major mode~~ **All multi-key bindings are unreachable** — missing space separators in key strings
16. [x] No regressions in existing markdown-mode features (2134 tests pass, 0 failures)

### Known Bugs

- **All multi-key bindings unreachable**: `markdown-mode.tlisp` uses concatenated strings (`"gh"`, `",b"`, `"zc"`) but the keymap dispatch requires space separators (`"g h"`, `", b"`, `"z c"`). All 45 new SPEC-039 bindings and most pre-existing ones are non-functional. Only `<Tab>` (single-key) works.
- `gb` bound twice: `markdown-jump-back` (line 56) then `markdown-backlinks` (line 101) — backlinks takes precedence, jump-back behavior lost
- `,ks` bound twice: `markdown-kill-subtree` (line 63) then `markdown-kill-session` (line 81) — kill-subtree behavior lost
- `,x` bound twice: `markdown-toggle-code` (line 41) then `markdown-export-dispatch` (line 88) — code toggle behavior lost
- `]l`/`[l` bound to `markdown-next-heading`/`markdown-prev-heading` instead of wiki-link navigation — duplicates `]h`/`[h`
- `shell-exec-session` does not implement sessions — spawns a transient process every time; `sessions` Map is never populated
- `markdown-rename-note` has shell injection — user input interpolated directly into `shell-command "mv ..."` instead of using `file-rename` primitive
- `markdown-scan-tags` has off-by-one — second and subsequent tags on the same line report wrong column positions (missing column offset accumulator)
- `markdown-demote-subtree` has no level-6 cap — can produce `#######` (level 7+)
- `markdown-promote/demote-subtree` match non-heading `#` lines — uses `string-match "^#"` instead of `"^#+\\s+"`
- `markdown-execute-all-blocks` uses stale `total` — line count not re-read after inserting results
- `Bun.spawnSync` calls have no `timeout` — hanging command blocks editor indefinitely
- `exitCode ?? 0` masks signal-killed processes — should be `exitCode ?? 1`

## Review Findings

Five-axis code review conducted against the implementation.

### Critical (blocks merge)

| # | Finding | Location | Fix |
|---|---------|----------|-----|
| C1 | All multi-key bindings unreachable due to missing space separators | `markdown-mode.tlisp:17-105` | Change `"gh"` → `"g h"`, `",b"` → `", b"`, `"zc"` → `"z c"`, etc. |
| C2 | `shell-exec-session` is a no-op — `sessions` Map never populated | `tlisp-api.ts:1046-1067` | Implement persistent process management or mark as stub and remove misleading code |
| C3 | No timeout on `Bun.spawnSync` — hanging command blocks editor | `tlisp-api.ts:1018, 1032, 1055` | Add `timeout: 30_000` to all three calls |

### Required (must fix)

| # | Finding | Location | Fix |
|---|---------|----------|-----|
| R1 | Shell injection in `markdown-rename-note` | `markdown.tlisp:1628` | Use `file-rename` primitive instead of `shell-command "mv ..."` |
| R2 | Off-by-one in `markdown-scan-tags` column tracking | `markdown.tlisp:933` | Change to `(tag-col (+ col (match-beginning 0) 1))` |
| R3 | `markdown-promote/demote-subtree` match non-heading `#` lines | `markdown.tlisp:870, 893` | Use `"^#+\\s+"` instead of `"^#"` |
| R4 | Three keybinding conflicts cause silent overwrites (`gb`, `,ks`, `,x`) | `markdown-mode.tlisp` | Assign unique keys or use prefix chains |
| R5 | `markdown-demote-subtree` has no level-6 cap | `markdown.tlisp:882-899` | Add `(if (< level 6) ...)` guard |

### Test Coverage Gaps

30+ acceptance criteria marked `[x]` have zero test coverage. Zero of 25 edge cases have dedicated tests. Several existing tests use weak assertions (`line > 0`) that could pass for wrong reasons.

**High-priority missing tests:**
- `markdown-move-subtree-up` / `markdown-move-subtree-down` (swap with sibling)
- Kill ring content after `markdown-kill-subtree`
- `markdown-execute-all-blocks` execution order
- Export functions (HTML, LaTeX, plain text)
- `markdown-follow-wiki-link` navigation
- `markdown-backlinks` cross-file linking
- `markdown-rename-note` with link updates
- `markdown-daily-note` creation
- All edge cases (zero headings, no tags, missing files, boundary levels)

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
| Primitives inline in tlisp-api.ts | Faster to implement, fewer files to maintain; same API surface | Separate `api/*.ts` modules — more organized but adds indirection for 8 small primitives |

## Deferred to Follow-up

- Code block autocomplete for wiki-links (needs full file index)
- Nested YAML objects/arrays in frontmatter
- Cross-table formula references
- PDF export (LaTeX → PDF pipeline)
- Block reference rendering (show referenced block content inline)
- Wiki-link autocomplete as-you-type
- Image rendering in TUI (terminal limitation)
- Search operators for sparse tree (`tag:`, `level:`, `file:`, `path:`)
- Confirmation prompt for code block execution (`markdown-safe-languages`)
- Session idle timeout / auto-expire
- Implement actual session persistence in `shell-exec-session` (currently a no-op)
- `frontmatter` token type for distinct YAML highlighting
- `{{tags}}` template variable expansion
- `markdown-follow-embed` and inline embed display (Step 12)
- `markdown-unlinked-mentions` command
- `markdown-move-note` command (directory move with link update)
- Persistent JSON backlink cache (currently in-memory)
- Rename preview before executing note rename
- Fix keybinding format — add space separators to all multi-key bindings (`"g h"`, `", b"`, `"z c"`)
- Resolve keybinding conflicts: `gb` (jump-back vs backlinks), `,ks` (subtree vs session), `,x` (code toggle vs export)
- Fix `]l`/`[l` keybindings (should navigate wiki-links, not headings)
- Fix `markdown-execute-all-blocks` stale line count after results insertion
- Add timeout to `Bun.spawnSync` calls
- Fix `exitCode ?? 0` to `exitCode ?? 1` in shell-exec primitives
- Fix `markdown-scan-tags` column offset for multi-tag lines
- Add level-6 cap to `markdown-demote-subtree`
- Tighten heading match in `markdown-promote/demote-subtree` to `"^#+\\s+"`
- Replace `shell-command "mv ..."` in `markdown-rename-note` with `file-rename` primitive
- Add edge case tests (25 items from edge case list have zero coverage)
- Add missing acceptance criteria tests (30+ items marked [x] have no test)

## Open Questions

- Should `gb` map to `markdown-jump-back` or `markdown-backlinks`? Currently backlinks wins. Suggestion: `gb` → backlinks, `g r` → jump-back (return).
- Should `,ks` map to `markdown-kill-subtree` or `markdown-kill-session`? Suggestion: `, k s` for subtree, `, k c` for session (clear).
- Should `,x` map to `markdown-toggle-code` or `markdown-export-dispatch`? Suggestion: `, x` for code toggle, `, x e` for export.
- Should embed display (Step 12) wait for a render pipeline refactor or ship a minimal version?
- Is the in-memory backlink cache sufficient, or is JSON persistence required before merge?
- Should the `frontmatter` token type be added to the tokenizer, or is the current `meta` token for `---` delimiters sufficient?
- Should `shell-exec-session` be implemented properly, or should sessions be managed entirely in T-Lisp (with the TypeScript primitive removed)?
- Should the existing test suite (26 tests) be expanded with the 30+ missing acceptance criteria tests, or is the current coverage acceptable for a first pass?

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

## Audit findings (patch-review 2026-06-13T20:13:08Z)

**VERDICT: GAPS** — audited tree @ `e7d8741b83c5` (gather bundle under-scoped the commit list; bulk of SPEC-039 shipped in `ac219dc` / `3c4134b` / `73076ce`). Gates: `typecheck:src` PASS, `test:unit` PASS (2279/1skip/0fail), `test:daemon` PASS (19/19). Full verdict at `.patch-reviews/SPEC-039-2026-06-13T20-13-08/verdict.md`.

### Gaps driving the verdict

**1. Named bugs still open (3)**
- **C2 `shell-exec-session` is a documented stub** (`tlisp-api.ts:1046-1081`) — `sessions` Map never populated; Step 5 session MUSTs (`markdown-kill-session`, `markdown-list-sessions`, shared state) are effectively MISSING. Either implement persistent process management or formally descope + remove the misleading primitives.
- **`]l`/`[l` bound to heading nav, no wiki-link command exists** (`markdown-mode.tlisp:106-107`) — `markdown-next-wiki-link`/`markdown-prev-wiki-link` are not implemented anywhere, so even re-binding has nothing to target. Criterion Step 11 acceptance "](move to next `[[]]`) MISSING.
- **`markdown-execute-all-blocks` uses stale `total`** (`markdown.tlisp:1101,1104`) — `(buffer-line-count)` read once before the while loop; later blocks skipped after results insertion shifts line indices. Re-read per iteration.

**2. PARTIAL MUSTs (4)**
- **Table formulas** (`markdown.tlisp:1129-1239`) — implements only literal-number `+,-,*,/` and `sum(range)`. Missing: `mean`/`min`/`max`/`count`, `%` modulo, `@>$>` shorthand. SPEC acceptance "sum range", "@>$> bottom-right" not satisfied.
- **`markdown-export-dispatch`** (`markdown.tlisp:1365-1374`) — plain `read-string` prompt, not a which-key popup. SPEC MUST "which-key popup to choose backend" unmet.
- **Template-variable expansion + templates dir** (`markdown.tlisp:1577-1603`) — `{{date}}` is never substituted in loaded templates (daily-note hardcodes date via `format`, passing by coincidence). `~/.config/tmax/templates/*.md` is never read; only built-in blank/daily/meeting strings exist.
- **LaTeX backend** (`markdown.tlisp:1324-1363`) — emits bare `\item` lines outside any `\begin{itemize}/\end{itemize}`; SPEC acceptance "compilable `.tex` source" borderline.

**3. Entirely MISSING features (SPEC-acknowledged)**
- **Step 12 embeds** — `wiki-link-embed` token type exists but no `markdown-follow-embed` command, no inline display, no missing-file message.
- `markdown-unlinked-mentions`, persistent backlink cache (in-memory Map only, no save-hook), `markdown-move-note`, rename preview.

**4. Test coverage gaps (13 behaviors marked `[x]` with no test)**
- `markdown-move-subtree-up`/`-down` (sibling swap correctness) — UNCOVERED
- `markdown-execute-all-blocks` (document order, multi-block) — UNCOVERED (would expose the stale-total bug)
- `markdown-table-eval-formula` end-to-end (table + tblfm + re-align) — UNCOVERED; `sum(@2$1..@5$1)` range branch UNCOVERED
- Export backends (HTML / LaTeX / plain text) — all 3 UNCOVERED
- `markdown-follow-wiki-link` navigation — UNCOVERED (only parser tested)
- `markdown-backlinks` cross-file — UNCOVERED
- `markdown-rename-note` (filesystem + link update) — UNCOVERED
- `markdown-daily-note` creation — UNCOVERED
- `markdown-frontmatter-set` on file without frontmatter — UNCOVERED
- `shell-exec` timeout / `exitCode ?? 1` behavior — UNCOVERED
- Several existing tests use weak `line > 0` assertions (next-tag, prev-tag, next-footnote, prev-footnote)
- **No UI/renderer test sends any of the new multi-key bindings** (e.g. `g h`, `, k s`) to verify reachability after the `editor.ts:441-449` dispatch-gate change

**5. Edge cases MISSED (6)**
- `#tag` inside fenced code block — tag regex has no code-block guard (`markdown.ts:47`); SPEC MUST NOT (line 265) violated
- Export of document with only frontmatter — frontmatter leaks into HTML/LaTeX body (`markdown.tlisp:1260-1363`)
- Wiki-link to non-existent file — no explicit guard before `find-file-open` (`markdown.tlisp:1528-1541`); SPEC acceptance "shows error, does not crash" unasserted
- Note rename when new name conflicts with existing file — `file-rename` throws via `renameSync`, no friendly message (`markdown.tlisp:1631-1632`)
- Template directory does not exist — `markdown-new-from-template` never touches filesystem templates dir
- `markdown-execute-all-blocks` stale total (see bug 1 above)

### What landed well (e7d8741b83c5 fixed 7 named bugs)

The shipped tree is materially better than the SPEC's Review Findings/Known Bugs sections claim. These are FIXED in the audited tree:
- **C1** concatenated keystrings → all bindings use space separators (`markdown-mode.tlisp:19-107`)
- **C3** no timeouts → `timeout: 30_000` on both `Bun.spawnSync` calls (`tlisp-api.ts:1032,1057`)
- **R1** rename shell injection → uses `(file-rename ...)` (`markdown.tlisp:1632`)
- **R2** scan-tags column off-by-one → `(+ col ...)` accumulator (`markdown.tlisp:937`)
- **R3/R5** promote/demote predicate + level-6 cap → `"^#+\\s"` and `(< level 6)` guard (`markdown.tlisp:870,893-897`)
- **R4** keybinding conflicts → `g b`/`g r`, `, k s`/`, k S`, `, x`/`, x e` all distinct
- `editor.ts:441-449` dispatch gate correctly keeps major-mode bindings out of the unified T-Lisp keymap while preserving them in `this.keyMappings`

### Assumptions challenged

- SPEC Status line says "26 new tests pass, 2134 total" → actual: 22 tests in `markdown-spec-039.test.ts`, gate reports 2279 pass. Numbers are stale.
- SPEC "Known Bugs"/"Review Findings" lists C1/C3/R1/R2/R3/R4/R5 as open → all seven are FIXED. SPEC body should be updated.
- Gather bundle listed only `e7d8741b83c5` as the implementing commit → misleading; it's the patch-review fix commit. Bulk of SPEC-039 shipped in `ac219dc`/`3c4134b`/`73076ce`.

### Recommended next pass (priority order)

1. Fix the 3 remaining named bugs (C2 sessions or descope; `]l`/`[l` + add wiki-link nav commands; `execute-all-blocks` stale total)
2. Close the 4 PARTIAL MUSTs (table formula functions + `%` + `@>$>`; export-dispatch → which-key; template-variable expansion + templates dir; LaTeX list env)
3. Either implement or formally descope Step 12 embeds, unlinked-mentions, persistent cache
4. Add the 13 missing acceptance-criteria tests (esp. export, rename, execute-all-blocks drift)
5. Add ≥1 renderer test driving a markdown buffer through `, k s` / `g h` to guard the dispatch gate

### Infrastructure note (not a SPEC-039 gap)

`audit.ts gates` looked for daemon scripts at `.zcode/skills/tmax-daemon/scripts/`, which doesn't exist (only `.claude/skills/tmax-daemon/scripts/` does). Daemon-restart/daemon-start gates errored on the missing path; `test:daemon` was re-run manually with the correct path and passed 19/19. The audit script's `DAEMON_SCRIPTS_DIR` resolution should fall back to `.claude/skills/` or symlink `tmax-daemon` into `.zcode/skills/`.
