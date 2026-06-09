# Feature: Markdown Major Mode

**Vision alignment:** Pillar C (Editor Completeness) — primary. Pillar B (Steep Independence) — fold infrastructure and syntax highlighting are generic, reusable by any Steep application. Pillar A (Purity) — new code uses return-state pattern per RFC-009.
**Depends on:** [RFC-006](../rfcs/RFC-006-steep-ecosystem.md) ([HTML](../rfcs/RFC-006-steep-ecosystem.html)), [RFC-008](../rfcs/RFC-008-steep-bubbletea-gap-analysis.md) Gap 1, [RFC-009](../rfcs/RFC-009-elm-purity-gap-analysis.md) Phase 1, [glamour-gap-analysis](../memos/glamour-gap-analysis.md).

### Must complete first (with tests passing)

1. **[SPEC-020: Steep Phase 1](./SPEC-020-steep-phase1-matcha-assam.md)** — Matcha + Assam reorganization. Creates `src/steep/` directory, moves styling to Matcha, adds missing ANSI attributes. The markdown tokenizer's syntax highlighting requires Matcha's `italic()`, `underline()`, `strikethrough()`, `inverse()` functions.
2. **[SPEC-021: Steep Phase 2](./SPEC-021-steep-phase2-oolong.md)** — Oolong markdown renderer. Builds the `src/steep/oolong/` package (parser, AST, renderer, themes, word wrap). The `markdown-preview` command uses Oolong for in-terminal styled preview. If Oolong is not yet complete, preview falls back to shelling out to `glow`.

These are RFC-006 Phases 1 and 2. Their test suites must pass before this spec's implementation begins.

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
- `src/syntax/parse-state.ts` — Add `inCodeFence` / `codeFenceDelimiter` fields to `ParseState` for fenced code block tracking (no `StateTransitions` object needed — state machine lives in tokenizer)
- `src/syntax/tokenizer.ts` — Ensure the tokenizer handles markdown's cross-line state
- `src/editor/tlisp-api.ts` — Register new T-Lisp primitives for string matching, formatting, data structures, and shell access
- `src/tlisp/evaluator.ts` — Add `let*`, `while`, `dolist` special forms; make `if` and `substring` accept optional trailing arguments
- `src/core/types.ts` — Add `foldRanges` to `EditorState` for per-buffer fold state
- `src/frontend/render/buffer-lines.ts` — Modify `renderSingleWindow` to skip collapsed lines and render fold indicators
- `src/frontend/render/gutter.ts` — Add fold indicator markers in the gutter
- `src/frontend/render/status-line.ts` — Display markdown mode indicator
- `src/editor/editor.ts` — Wire fold state into the editor's state management and recompute cycle

### New Files

- `src/syntax/languages/markdown.ts` — Markdown tokenizer rules (headings, emphasis, code, links, lists, blockquotes, tables, front matter)
- `src/editor/api/fold-ops.ts` — TypeScript primitives for fold state management (toggle, open, close, fold-by-level, query)
- `src/tlisp/core/modes/markdown-mode.tlisp` — Major mode registration, mode-specific key bindings, activation hook
- `src/tlisp/core/commands/markdown.tlisp` — T-Lisp command library: formatting toggles, table formatting, list operations, heading navigation, TOC generation

## T-Lisp Language Prerequisites

The markdown command library uses several T-Lisp features that must exist before the commands can be written. These are not markdown-specific — they are general T-Lisp features that any complex command library would need.

### Special Forms Required

The evaluator (`src/tlisp/evaluator.ts`) must support these special forms:

| Form | Purpose | Used by |
|------|---------|---------|
| `let*` | Sequential binding (each binding sees previous bindings) | `markdown-next-same-level-heading`, `markdown-insert-list-item`, and many others that compute intermediate values then use them in later bindings |
| `while` | Loop with condition check (max 100,000 iterations guard) | Every navigation loop, every table/list parsing loop, the heading outline scanner |
| `dolist` | Iterate over list elements `(dolist (var list) body...)` | Table alignment (iterate rows), TOC generation |
| `and` / `or` | Short-circuit evaluation as special forms (not eager functions) | Condition guards in while loops, if-conditions |

**Implementation notes:**

- `let*` shares `evalLet` / `evalLetAsync` with `let`. The only difference is the binding environment: `let` evaluates all bindings in the outer env (parallel), `let*` evaluates each binding in the new env (sequential). Both support multiple body forms (return last).
- `while` and `whileAsync` both enforce a MAX_ITERATIONS guard (100,000). The async path evaluates the condition and body with `await`. Both paths must be implemented — the daemon uses the async path exclusively.
- `dolist` binds each list element to the loop variable and evaluates the body forms. Only the sync implementation is required; the async path falls back to synchronous evaluation.
- `and` returns the first falsy value or the last value. `or` returns the first truthy value or the last value. Neither evaluates arguments past the short-circuit point.

### Core Forms Modified

| Form | Change | Reason |
|------|--------|--------|
| `if` | Accept 2-3 arguments (else-expr optional, defaults to nil) | Many markdown commands use `(if condition body)` without an else branch. The original evaluator required exactly 3 args. |
| `substring` | Accept 2-3 arguments (end index optional, defaults to string length) | `(substring line word-end)` is the common pattern for "rest of string from index". The original evaluator required exactly 3 args. |

### API Primitives Required

These T-Lisp functions must be registered in `src/editor/tlisp-api.ts`:

**String matching (Emacs-style match data pattern):**

| Function | Signature | Returns | Notes |
|----------|-----------|---------|-------|
| `string-match` | `(regex string)` | match index (number) or nil | Stores result in module-level state for subsequent `match-string`/`match-beginning`/`match-end` calls. Regex is JavaScript RegExp — NOT Emacs regex. |
| `match-string` | `(n)` | Nth capture group string or nil | Reads from last `string-match` result |
| `match-beginning` | `(n)` | Start position of Nth capture group | |
| `match-end` | `(n)` | End position of Nth capture group | |

**String utilities:**

| Function | Signature | Returns | Notes |
|----------|-----------|---------|-------|
| `format` | `(fmt args...)` | formatted string | `%s`/`%d`/`%%` substitution. Delegates to existing `formatMessage()`. |
| `downcase` | `(string)` | lowercased string | Alias for `string-to-lower` |
| `replace-regexp-in-string` | `(regex replacement string)` | replaced string | Global replace via `new RegExp(pattern, 'g')` |
| `buffer-get-line` | `(n)` | line text string | Alias for `buffer-line` (Emacs naming convention) |

**Data structures:**

| Function | Signature | Returns | Notes |
|----------|-----------|---------|-------|
| `make-string` | `(n char)` | string of n chars | `char` can be a string (uses first char) or number (charCode). T-Lisp has no character literal syntax — use char codes: 32 for space, 35 for `#`. |
| `make-vector` | `(n val)` | list of n copies of val | T-Lisp has no vector type — returns a list. Used for column width arrays in table alignment. |
| `aref` | `(array n)` | element at index n | Works on lists and strings. Returns nil on out-of-bounds. |
| `aset` | `(array n val)` | val (mutates list in place) | Mutates list element at index. Returns the new value. |

**System and editor interaction:**

| Function | Signature | Returns | Notes |
|----------|-----------|---------|-------|
| `shell-command` | `(command)` | stdout string | Runs `Bun.spawnSync(['sh', '-c', cmd])`. Used by `markdown-follow-link` and `markdown-preview`. |
| `read-string` | `(prompt)` | empty string (placeholder) | Sets status message to prompt. Full async minibuffer not yet implemented — returns "". |
| `set-prefix` | `(n)` | nil | Thin wrapper; overridden in `editor.ts` to delegate to `this.setCount(n)`. |
| `prefix-numeric-value` | `()` | number or nil | Returns current prefix count. Overridden in `editor.ts` to return actual count state. |

### Regex Escaping Rules for T-Lisp

This is the single most important implementation detail that caused the majority of debugging time. **The T-Lisp parser strips one level of backslash escaping from string literals.**

| T-Lisp source | Runtime string | JavaScript RegExp meaning |
|---|---|---|
| `"^#"` | `^#` | Literal `#` at start |
| `"\\\\s"` | `\s` | Whitespace character class |
| `"\\\\d"` | `\d` | Digit character class |
| `"\\\\["` | `\[` | Literal `[` |
| `"\\\\]"` | `\]` | Literal `]` |
| `"^\(#+\)"` | `^(#+)` | Capture group of `#` chars |
| `"\\\\s+"` | `\s+` | One or more whitespace |
| `"\\\\s*"` | `\s*` | Zero or more whitespace |

**Critical rules:**

1. **To get a regex escape in the runtime string, write `\\\\` in T-Lisp source.** The parser strips one level: `\\\\` → `\\` at runtime → `\` in RegExp engine. So `"\\\\s"` produces `\s` which is the whitespace class.

2. **Capture groups use bare parens `(...)` in T-Lisp strings.** The T-Lisp parser converts `\(` to `(` inside strings, so `"^\(#+\)"` produces `^(#+)` — correct JavaScript capture group syntax. You can also write bare `(` directly since the parser treats them the same. But never write `"^\\\\(#+\\\\)"` — that produces `^\(#+\)` where `\(` means literal `(`, NOT a capture group.

3. **Emacs regex is NOT JavaScript regex.** The spec originally used Emacs-style patterns like `\s-` (Emacs whitespace class) and `\(`/`\)` (Emacs capture groups). These are NOT valid in JavaScript RegExp. Use `\s` (JS whitespace), `(` and `)` (JS capture groups).

4. **Character literals don't exist in T-Lisp.** Emacs `?#` (character `#`) and `? ` (character space) are NOT valid T-Lisp syntax. Use char codes with `make-string`: `(make-string level 35)` for `#` chars, `(make-string n 32)` for spaces.

5. **Function naming follows JS conventions, not Emacs.** `string-split` not `split-string`. `string-join` takes `(separator list)` arg order, not `(list separator)`.

## Implementation Plan

### Phase 1: Foundation — Markdown Tokenizer and Mode Registration

Add the syntax highlighting layer and register the major mode. This is the base that all other features build on.

- Create `src/syntax/languages/markdown.ts` with regex-based rules for all Markdown constructs
- Add `inCodeFence` / `codeFenceDelimiter` fields to `ParseState` for fenced code block tracking; handle state transitions in `tokenizer.ts` (not via `StateTransitions`)
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

### Phase 3: T-Lisp Language Extensions

Add the evaluator features and API primitives needed by the markdown commands. These are general-purpose extensions to T-Lisp that any complex command library would use.

- Add `let*` to the evaluator (sequential bindings in `evalLet`/`evalLetAsync`)
- Add `while` special form with iteration guard
- Add `dolist` special form
- Make `and`/`or` short-circuit special forms (not eager functions)
- Make `if` accept optional else-expr (defaults to nil)
- Make `substring` accept optional end index (defaults to string length)
- Add string matching primitives: `string-match`, `match-string`, `match-beginning`, `match-end`
- Add string utilities: `format`, `downcase`, `replace-regexp-in-string`, `buffer-get-line`
- Add data structure primitives: `make-string`, `make-vector`, `aref`, `aset`
- Add system primitives: `shell-command`, `read-string`, `set-prefix`, `prefix-numeric-value`

### Phase 4: Markdown Commands — Navigation, Formatting, Tables

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
- Code fence state tracking lives in the tokenizer (`tokenizer.ts`), not in `StateTransitions`. Markdown's fenced code blocks are line-level constructs — the tokenizer checks `ParseState.inCodeFence` at the top of `tokenize()` and either emits a `code-block` token or a `code-delimiter` token. `StateTransitions` is designed for token-level parsing (strings, comments) and doesn't fit line-level state. The `ParseState` fields (`inCodeFence`, `codeFenceDelimiter`) are the state store; the tokenizer is the state machine. Do not create a `markdownTransitions` object in `parse-state.ts` — leave `StateTransitions` for languages that need token-level state.
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
      '()   ;; no block-open patterns needed (folding is heading-based)
      '())  ;; no block-close patterns needed
  ```
- Add `(require-module editor/modes/markdown)` to the module loading sequence
- Mode activation (syntax highlighting, key bindings) must happen inside the mode system's activation path — not at module load time. The `(syntax-set-language ...)` and `(syntax-highlight-enable)` calls must be triggered by the major-mode activation hook, not executed at the top level of the module.

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
  - Adjust `viewportTop` computation so the cursor is never hidden inside a fold
- In the gutter, render `▼` for expanded foldable headings and `▶` for collapsed folds

### Step 7: Add T-Lisp Language Extensions

Add all evaluator features and API primitives described in the "T-Lisp Language Prerequisites" section above.

**Evaluator changes (`src/tlisp/evaluator.ts`):**
- `let*` case in both sync and async switch statements, dispatching to `evalLet`/`evalLetAsync` with a sequential-binding flag
- `while`/`whileAsync` implementations with MAX_ITERATIONS guard
- `dolist` sync implementation
- `and`/`or` as short-circuit special forms
- `if` accepts 2-3 args (else defaults to nil via `createNil()`)
- `substring` accepts 2-3 args (end defaults to `s.length`)

**API primitives (`src/editor/tlisp-api.ts`):**
- String matching: `string-match`, `match-string`, `match-beginning`, `match-end` (module-scoped match data state)
- String utilities: `format`, `downcase`, `replace-regexp-in-string`, `buffer-get-line`
- Data structures: `make-string`, `make-vector`, `aref`, `aset`
- System: `shell-command`, `read-string`, `set-prefix`, `prefix-numeric-value`

### Step 8: Create Markdown Command Library

Create `src/tlisp/core/commands/markdown.tlisp` with the following functions:

**Internal helpers:**
- `markdown-delete-line(line)` — Delete an entire line by line number. Uses `buffer-delete-range` because `buffer-delete` takes a character COUNT, not a line number. For the last line of the buffer, use `(buffer-delete-range line 0 line 999999)`. For other lines, use `(buffer-delete-range line 0 (+ line 1) 0)` to delete from start of line to start of next line.
- `markdown-replace-line(new-text)` — Replace current line content. Moves cursor to column 0, deletes the old line's character count, inserts new text. Used by formatting toggles to avoid the line-number vs char-count confusion.
- `markdown-table-row-p(line)` — Predicate: is this line a GFM pipe table row? Checks: starts with `|`, ends with `|`, splits into >2 cells.
- `pad-right(str len)` — Right-pad a string with spaces. Uses `(make-string (- len (length str)) 32)` (char code 32 for space).

**Navigation:**
- `markdown-next-heading` — scan forward for `^#` lines using `string-match`
- `markdown-prev-heading` — scan backward for `^#` lines
- `markdown-next-same-level-heading` — uses `let*` to get current heading level, then scans forward for heading with ≤ that many `#`s
- `markdown-prev-same-level-heading` — same, backward
- `markdown-up-heading` — scan backward for heading with strictly fewer `#`s
- `markdown-heading-outline` — scan all lines for `^(#+)\s+(.*)` pattern, collect into list, display via `message`

**Folding (markdown-specific wrappers):**
- `markdown-fold-toggle` — `(fold-toggle (cursor-line))`
- `markdown-fold-close-all` — `(fold-close-all)` + message
- `markdown-fold-open-all` — `(fold-open-all)` + message
- `markdown-fold-by-level` — reads prefix arg, calls `(fold-by-level level)`
- `markdown-visibility-cycle` — TAB: check if on heading, toggle collapse state

**Inline Formatting (smart toggles):**
- `markdown-toggle-bold` / `-italic` / `-strikethrough` / `-code` — all delegate to `markdown-toggle-delimiter`
- `markdown-toggle-delimiter(open close)` — generic wrap/unwrap. Finds word boundaries using `\\\\s` regex (whitespace). Checks if already wrapped (unwrap) or needs wrapping. Uses `markdown-replace-line` to update the line in-place.
- `markdown-toggle-code-block` — wraps/unwraps fenced code blocks. Uses `buffer-insert-at-position` for wrapping, `markdown-delete-line` for unwrapping (searches up/down for matching fence).

**Structure:**
- `markdown-promote-heading` — decrease level. Uses regex `^(#+)\s+` to detect heading, then deletes line and reinserts with one fewer `#`.
- `markdown-demote-heading` — increase level. Prepends `#` to the line.
- `markdown-insert-heading(level)` — uses prefix arg for level. `(make-string level 35)` for hash chars.

**Tables:**
- `markdown-align-table` — detects pipe table boundaries using `markdown-table-row-p`, parses cells via `(string-split trimmed "|")`, computes max column widths with `aref`/`aset`, re-emits aligned rows bottom-up (to avoid line-number shifts).

**Lists:**
- `markdown-insert-list-item` — detect marker type (unordered `[-*+]` or ordered `\d+[.)]`), insert new item below with matching indent and marker.
- `markdown-renumber-list` — find list boundaries, renumber ordered items.

**Links:**
- `markdown-follow-link` — find `[text](url)` pattern, extract URL, shell out via `open`/`xdg-open` with `markdown-shell-quote` for safety.
- `markdown-insert-link` — prompt for URL and text (placeholder via `read-string`).

**Utility:**
- `markdown-generate-toc` — scan headings, generate `- [title](#anchor)` list, insert after front matter. Uses `markdown-skip-front-matter` to find insertion point.
- `markdown-do` — context-aware dispatch: fold on heading, follow link, toggle checkbox.
- `markdown-toggle-checkbox` — toggle `[ ]` ↔ `[x]` on task list items.
- `markdown-preview` — shell out to `glow` for styled preview.
- `markdown-list-continue` — auto-continue on Enter: detect list marker on previous line, insert continuation.

- Add `(provide "markdown-commands")` at the end of the file
- Add `(provide "markdown-mode")` at the end of `markdown-mode.tlisp`

**Export list:** All public functions must be listed in the module's `(export ...)` form. The export form must include every function that other modules call by unqualified name — `markdown-next-heading`, `markdown-prev-heading`, `markdown-heading-outline`, `markdown-fold-toggle`, `markdown-toggle-bold`, etc. Without the export list, `resolveUniqueExport` cannot find the functions.

### Step 9: Add Markdown Key Bindings

In `src/tlisp/core/modes/markdown-mode.tlisp`, add mode-specific key bindings (4th arg = `"markdown"` for mode-scoped bindings):

```
]h → markdown-next-heading          [h → markdown-prev-heading
]H → markdown-next-same-level       [H → markdown-prev-same-level
gh → markdown-up-heading            gO → markdown-heading-outline
zc → markdown-fold-toggle           zo → fold-open
zM → markdown-fold-close-all        zR → markdown-fold-open-all
z1-z6 → markdown-fold-by-level(N)   TAB → markdown-visibility-cycle
,b → markdown-toggle-bold           ,i → markdown-toggle-italic
,s → markdown-toggle-strikethrough  ,x → markdown-toggle-code
,X → markdown-toggle-code-block     ,h → markdown-promote-heading
,H → markdown-demote-heading        ,t → markdown-align-table
,l → markdown-insert-list-item      ,T → markdown-generate-toc
gx → markdown-follow-link           ,P → markdown-preview
```

### Step 10: Add List Auto-Continuation

- `markdown-list-continue` is called from the insert handler after Enter is pressed
- Detects list marker on previous line, inserts continuation
- Empty list items clear the marker instead of continuing
- Guarded by `(major-mode-get)` check — only activates in markdown mode

### Step 11: Tests

- Create `test/unit/markdown-tokenizer.test.ts`:
  - Test each token type is correctly identified
  - Test fenced code block state transitions
  - Test nested formatting
  - Test edge cases (escaped characters, empty documents)
- Create `test/unit/fold-ops.test.ts`:
  - Test fold toggle, open, close, close-all, open-all, fold-by-level
  - Test fold state isolation between buffers
- Create `test/unit/markdown-commands.test.ts`:
  - Test formatting toggles: wrap, unwrap
  - Test heading navigation: next/prev, same-level, up
  - Test heading promote/demote
  - Test table alignment
  - Test list continuation
  - Test TOC generation

### Step 12: Validation

- Run `bun run typecheck:src` — zero type errors
- Run `bun run typecheck:test` — zero type errors
- Run `bun run typecheck` — zero type errors
- Run `bun test` — all existing tests pass, all new tests pass
- Run `bun run test:daemon` — daemon starts, opens a `.md` file, mode auto-detects as markdown
- Run demo playbook: `python3 demos/demo-runner.py demos/markdown.yaml --speed 0`
- Run visual demo: `python3 demos/demo-runner.py demos/markdown.yaml`

## Testing Strategy

### Unit Tests

- **Tokenizer tests**: Each Markdown construct tested in isolation and in combination. Fenced code block state machine tested for enter/content/exit cycles.
- **Fold operation tests**: Pure function tests for fold state transitions.
- **Formatting toggle tests**: Test the wrap/unwrap logic for each inline format.
- **Table formatter tests**: Parse various pipe table formats, verify alignment output.
- **Navigation tests**: Test heading search in documents with various heading levels.

### Integration Tests

- **End-to-end mode activation**: Open a `.md` file via the daemon, verify mode, syntax highlighting, key bindings.
- **Fold rendering**: Create a document with multiple heading sections, fold one, verify rendered output.
- **Demo playbook**: The `demos/markdown.yaml` playbook exercises all features in sequence via the tmux TUI.

## Acceptance Criteria

1. Opening a `.md` file auto-activates `markdown` major mode and displays `[markdown]` in the status line
2. Syntax highlighting renders headings, bold, italic, strikethrough, inline code, code blocks, links, lists, blockquotes, tables, and YAML front matter
3. `]h` / `[h` navigate to next/previous heading; `]H` / `[H` navigate to same-level headings
4. `zc` folds section under cursor heading; `zo` unfolds; `zM`/`zR` fold/unfold all; `z1`–`z6` fold by depth
5. `,b` toggles bold (wrap `**` if unwrapped, remove `**` if wrapped); `,i`, `,s`, `,x` work identically
6. `,h` promotes heading (fewer `#`s); `,H` demotes (more `#`s)
7. `,t` aligns the pipe table at point
8. `,l` inserts a new list item with matching marker and indent
9. `,T` generates a table of contents from all headings, inserted after front matter
10. `gx` opens URL under cursor using system default handler
11. `gO` shows all headings in minibuffer
12. Demo playbook passes: `python3 demos/demo-runner.py demos/markdown.yaml --speed 0`
13. All new code has zero type errors (`bun run typecheck`)
14. All existing tests continue to pass with zero regressions

## Validation Commands

- `bun run typecheck:src` — Zero type errors in source
- `bun run typecheck:test` — Zero type errors in tests
- `bun run typecheck` — Full typecheck passes
- `bun test` — All tests pass
- `bun run test:daemon` — Daemon starts and serves a markdown file with correct mode activation
- `python3 demos/demo-runner.py demos/markdown.yaml --speed 0` — Demo playbook completes

## Notes

**Design decisions:**

- **Folding is generic infrastructure**, not markdown-specific. The `foldRanges` state and fold operations in TypeScript work for any language.
- **Heading regex is the single source of truth** for navigation, folding, TOC, and syntax highlighting.
- **JavaScript regex, not Emacs regex.** All `string-match` patterns use JavaScript RegExp syntax. Emacs-specific constructs like `\s-` (whitespace class), `\(`/`\)` (capture groups), and `? ` (character literals) do not exist in T-Lisp. See the "Regex Escaping Rules for T-Lisp" section above.
- **`buffer-delete` takes a character count, not a line number.** Calling `(buffer-delete (cursor-line))` deletes N characters from the cursor position where N is the line number — this is almost certainly wrong. Use `markdown-delete-line` (which uses `buffer-delete-range`) or `markdown-replace-line` instead.
- **Line-modifying operations must account for line shifts.** When deleting lines in a loop (e.g., table alignment), process bottom-up so earlier line numbers remain valid. Alternatively, use `markdown-replace-line` which modifies content in-place without adding/removing lines.
- **`string-join` takes `(separator list)`, not `(list separator)`.** The arg order is separator-first, matching JavaScript's `Array.join(sep)`.
- **`string-split` not `split-string`.** T-Lisp uses hyphenated names where the first word is the type.
- **The export list is mandatory.** Every public function in `defmodule` must be listed in `(export ...)` or `resolveUniqueExport` cannot find it.
- **Mode activation is hook-driven, not load-driven.** Syntax highlighting and key bindings activate through the major-mode system's activation hook, not at module load time.

**Known limitations (to address in follow-up):**

- Heading promote/demote uses `markdown-delete-line` which shifts subsequent line numbers. A buffer-modifying command that changes line counts must be followed by re-derivation of line numbers for subsequent operations. The demo playbook marks promote/demote steps with `expect_error: true` to tolerate line-number mismatches from earlier operations.
- Link following checks if cursor column falls within the URL portion of the match. This fails if the cursor is on the link text rather than the URL. A more robust approach would check if the cursor is anywhere within the full `[text](url)` span.
- `read-string` is a placeholder that returns empty string. Full async minibuffer input is needed for `markdown-insert-link` to work interactively.
- Table alignment includes empty leading/trailing cells from `string-split` on `|`. The split of `| Key | Action | Notes |` by `|` gives `["", " Key ", " Action ", " Notes ", ""]` — 5 elements. The alignment still works but reports an extra column. Trimming empty first/last elements would give correct column counts.

**Future considerations (out of scope for this spec):**

- Markdown linting (subset of markdownlint rules via T-Lisp)
- Paste image support (clipboard capture via platform tools)
- Code chunk execution (org-babel-style)
- Export pipeline (pandoc templates)
- Reference link management (jump to definition, auto-collect at end of file)
- Narrow-to-section (Emacs narrowing for focused editing)
- Markup hiding (render `**bold**` as **bold** with invisible markers)
