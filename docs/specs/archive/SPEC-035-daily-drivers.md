# Feature: Daily Driver Essentials

## Feature Description
The six foundational features needed to make tmax a usable daily editor: **syntax highlighting**, **incremental search**, **query-replace**, **auto-indentation**, **directory editor (dired)**, and **major modes**. Together these transform tmax from a proof-of-concept into a tool developers can rely on for everyday editing.

## User Story
As a software developer
I want syntax highlighting, incremental search, interactive find/replace, auto-indentation, a file browser, and language-aware modes
So that tmax becomes my primary terminal editor instead of a novelty

## Problem Statement
tmax v0.2.0 has solid foundations — modal editing, T-Lisp extensibility, buffer management, undo/redo, window splitting — but lacks the features developers use constantly. Without syntax highlighting, code is hard to scan. Without incremental search, finding text is clunky. Without query-replace, refactoring is manual. Without auto-indent, code formatting requires constant correction. Without a file browser, managing projects requires leaving the editor. Without major modes, every filetype gets the same behavior.

## Solution Statement
Implement these six features following the existing T-Lisp extensibility pattern: TypeScript provides low-level primitives, T-Lisp drives the behavior. Each feature is a separate T-Lisp API module exposed through `tlisp-api.ts`, with key bindings registered in the core binding files (`src/tlisp/core/bindings/*.tlisp`). The rendering pipeline in `src/frontend/render/` gains ANSI color support for syntax highlighting and search highlighting.

### Design Principle: Granular Primitives, T-Lisp Composition

Following the Emacs model: **TypeScript exposes only fine-grained, non-composable I/O primitives**. All editor behavior — save-buffer, incremental search, indent-line, dired navigation — is composed in T-Lisp from these primitives. The test: "would an Emacs user want to advise-override this function?" If yes, it must be T-Lisp-callable.

**Pattern**:
- TypeScript: `write-file-content(path, content)`, `buffer-modified-p()`, `file-exists-p(path)` — single-purpose I/O or state queries
- T-Lisp: `(defun save-buffer () ...)` — composes the primitives into user-visible behavior
- Handler: `this.interpreter.eval('(save-buffer)')` — one-line dispatch

**Async handling**: T-Lisp is synchronous. Async operations (file I/O) use the existing fire-and-forget pattern — the primitive fires the async op and sets status/logs result in the `.then()` callback.

## Relevant Files

### Core Type System
- `src/core/types.ts` — Add `HighlightSpan`, `SyntaxToken`, `MajorModeConfig` types; extend `EditorState`
- `src/core/buffer.ts` — Unchanged; new operations wrap the existing gap buffer
- `src/core/filesystem.ts` — Add `readDir()` and `stat()` for dired support

### Editor API Layer
- `src/editor/tlisp-api.ts` — Register all new API modules (syntax, replace, indent, dired, major-mode, hooks)
- `src/editor/editor.ts` — Wire new features into editor lifecycle (buffer switches, mode changes, highlight recomputation); shrink monolithic methods to one-line T-Lisp dispatches
- `src/editor/api/file-ops.ts` — Replace stubs with real granular primitives: `write-file-content`, `file-exists-p`, `file-modtime`, `file-copy`, `make-backup-file`, `file-remove`, `file-mkdir`, `read-dir`, `file-stat`
- `src/editor/api/buffer-ops.ts` — Add: `buffer-filename`, `set-buffer-filename`, `buffer-modified-p`, `set-buffer-modified-p`, `buffer-get-line-indent`, `buffer-set-line-indent`, `buffer-line-matches`
- `src/editor/api/search-ops.ts` — Add granular primitives: `search-find-all-matches`, `search-set-highlight-ranges`, `search-clear-highlights`
- `src/editor/api/bindings-ops.ts` — Update `save-file` and `open-file` to dispatch to T-Lisp `(save-buffer)` and `(find-file)` instead of calling TypeScript methods directly

### New API Modules (TypeScript Primitives)
- `src/editor/api/syntax-ops.ts` — Granular: `syntax-tokenize-line`, `syntax-apply-highlights`, `syntax-clear-highlights`, `syntax-set-language`, `syntax-get-language`, `syntax-highlight-toggle`
- `src/editor/api/replace-ops.ts` — Granular: `buffer-replace-range`, `replace-find-matches`, `replace-apply-current`
- `src/editor/api/indent-ops.ts` — Granular: `buffer-get-line-indent`, `buffer-set-line-indent`, `buffer-previous-non-blank-line`, `indent-calculate-column`
- `src/editor/api/dired-ops.ts` — Granular: `read-dir`, `file-stat`, `file-remove`, `file-mkdir`, `file-copy`
- `src/editor/api/major-mode-ops.ts` — Granular: `major-mode-set`, `major-mode-get`, `major-mode-register`, `major-mode-list`, `major-mode-auto-detect`, `add-hook`, `run-hooks`, `remove-hook`

### Syntax Highlighting Engine
- `src/syntax/types.ts` — `SyntaxRule`, `SyntaxToken`, `HighlightTheme` type definitions
- `src/syntax/tokenizer.ts` — Generic regex-based tokenizer (per-language rule sets, longest match wins)
- `src/syntax/highlighter.ts` — Maps tokens to ANSI color spans, produces `HighlightSpan[]`
- `src/syntax/languages/typescript.ts` — TypeScript/TSX syntax rules
- `src/syntax/languages/python.ts` — Python syntax rules
- `src/syntax/languages/lisp.ts` — Lisp/T-Lisp syntax rules
- `src/syntax/languages/go.ts` — Go syntax rules

### Rendering
- `src/frontend/render/buffer-lines.ts` — Consume `HighlightSpan[]` for colored output; apply search and replace highlighting
- `src/frontend/render/status-line.ts` — Show current major mode name and replace prompts
- `src/frontend/frontends/steep/style.ts` — Existing ANSI styling utilities (reuse for highlight spans)

### Key Bindings (T-Lisp)
- `src/tlisp/core/bindings/normal.tlisp` — Add `/` incremental search, `?` backward search, `=` for indent, dired navigation overrides
- `src/tlisp/core/bindings/command.tlisp` — Add `:s`, `:%s`, `:dired`, `:w` (save-buffer), `:e` (find-file) command parsing

### T-Lisp Command Definitions
- `src/tlisp/core/commands/save.tlisp` — `(save-buffer)` composed from `buffer-modified-p`, `buffer-filename`, `file-exists-p`, `make-backup-file`, `write-file-content`, `set-buffer-modified-p`, `message`
- `src/tlisp/core/commands/find-file.tlisp` — `(find-file)` composed from `minibuffer-read`, `file-exists-p`, `read-file-content`, `buffer-create`, `set-buffer-filename`
- `src/tlisp/core/commands/isearch.tlisp` — `(isearch-forward)`, `(isearch-backward)`, `(isearch-update)`, `(isearch-exit)` composed from `search-find-all-matches`, `search-set-highlight-ranges`, `cursor-move`, `minibuffer-set`
- `src/tlisp/core/commands/replace.tlisp` — `(query-replace)` composed from `replace-find-matches`, `buffer-replace-range`, `message`, `editor-set-mode`
- `src/tlisp/core/commands/indent.tlisp` — `(indent-line)`, `(indent-region)` composed from `buffer-get-line-indent`, `buffer-set-line-indent`, `buffer-previous-non-blank-line`, `indent-calculate-column`
- `src/tlisp/core/commands/dired.tlisp` — `(dired)`, `(dired-open-file)`, `(dired-mark-delete)`, etc. composed from `read-dir`, `buffer-create`, `file-stat`, `file-remove`, `file-mkdir`

### Indentation Rules (T-Lisp)
- `src/tlisp/core/indent/typescript.tlisp` — TypeScript indent: `{`, `}`, `else`, `catch`
- `src/tlisp/core/indent/lisp.tlisp` — Lisp indent: unmatched paren alignment
- `src/tlisp/core/indent/python.tlisp` — Python indent: `:`, `return`, `pass`
- `src/tlisp/core/indent/generic.tlisp` — Default indent: match previous line

### Major Mode Definitions (T-Lisp)
- `src/tlisp/core/modes/fundamental.tlisp` — Plain text fallback mode
- `src/tlisp/core/modes/typescript-mode.tlisp` — Register `.ts`/`.tsx` with syntax and indent rules
- `src/tlisp/core/modes/python-mode.tlisp` — Register `.py`/`.pyi`
- `src/tlisp/core/modes/lisp-mode.tlisp` — Register `.tlisp`/`.lisp`/`.el`
- `src/tlisp/core/modes/go-mode.tlisp` — Register `.go`

### Handlers
- `src/editor/handlers/insert-handler.ts` — Hook auto-indent on Enter key (dispatch `(indent-line)`), electric outdent on `}`
- `src/editor/handlers/normal-handler.ts` — Hook `/`, `?` for isearch (dispatch `(isearch-forward)`/`(isearch-backward)`), `=` for indent, `w`/save to dispatch `(save-buffer)`
- `src/editor/handlers/command-handler.ts` — Parse `:w` → `(save-buffer)`, `:e` → `(find-file)`, `:s`/`:%s` → `(query-replace)`, `:dired` → `(dired)`

### Hook System (shared across modes)
- `src/editor/api/hook-ops.ts` — Granular primitives: `add-hook`, `run-hooks`, `remove-hook`, `hook-list`. Hooks are named lists of T-Lisp function symbols. Used by major modes (`activate-hook`, `deactivate-hook`), save (`before-save-hook`, `after-save-hook`), and file operations (`find-file-hook`)

### Tests
- `test/unit/syntax-highlighter.test.ts` — Tokenizer and highlighter unit tests
- `test/unit/incremental-search.test.ts` — Incremental search state and rendering tests
- `test/unit/query-replace.test.ts` — Replace operation and interaction tests
- `test/unit/auto-indent.test.ts` — Indentation calculation per language
- `test/unit/dired.test.ts` — Directory listing, navigation, mark/delete tests
- `test/unit/major-mode.test.ts` — Mode registration, detection, hooks tests

## Implementation Plan

### Phase 0: Foundation — Granular Primitives
Decompose existing monolithic TypeScript methods into fine-grained T-Lisp-callable primitives. Replace `file-ops.ts` stubs with real implementations. Add buffer metadata primitives (filename, modified-p, line-indent). Add hook system. This phase enables all subsequent phases to compose behavior in T-Lisp.

### Phase 1: Infrastructure — Types, Syntax Engine, Highlight Rendering
Add core types for syntax tokens, highlight spans, and major modes. Build a generic tokenizer that accepts per-language rule sets. Update the rendering pipeline to apply ANSI color from highlight spans. This phase delivers syntax highlighting as a standalone capability.

### Phase 2: Incremental Search
Extend the existing search infrastructure (`search-ops.ts`) with granular match-finding primitives. Compose incremental search behavior in T-Lisp (`isearch.tlisp`). As the user types, matches highlight in real-time, cursor jumps to the first match. Add regex support. Reuses the highlight rendering from Phase 1.

### Phase 3: Query-Replace
Build query-replace from granular primitives (`buffer-replace-range`, `replace-find-matches`). Compose the interactive behavior in T-Lisp (`replace.tlisp`). Support `:s/foo/bar/g` (current line) and `:%s/foo/bar/g` (whole buffer) with per-match confirmation (y/n/a/q). Highlight current match and replacement preview.

### Phase 4: Auto-Indentation
Add indent primitives (`buffer-get-line-indent`, `buffer-set-line-indent`, `indent-calculate-column`). Compose indent behavior in T-Lisp (`indent.tlisp`). Indent rules defined per-language in T-Lisp. Hook into the Enter key in insert mode.

### Phase 5: Major Modes
Implement a major mode system built on the hook primitives from Phase 0. Each buffer has an active major mode (set by file extension or manually). Major modes carry syntax rules, indent rules, key bindings, and mode hooks. Ship modes for TypeScript, Python, Lisp, and a fundamental/text fallback.

### Phase 6: Directory Editor (Dired)
Build dired from granular filesystem primitives (`read-dir`, `file-stat`, `file-remove`, `file-mkdir`). Compose dired behavior in T-Lisp (`dired.tlisp`). Uses existing buffer infrastructure — dired is a special buffer with overridden key bindings.

## Step by Step Tasks

### 0a. Add Buffer Metadata Primitives to `src/editor/api/buffer-ops.ts`
- `(buffer-filename)` — return the file path associated with current buffer (or nil)
- `(set-buffer-filename PATH)` — associate buffer with a file path
- `(buffer-modified-p)` — return whether buffer has unsaved changes
- `(set-buffer-modified-p FLAG)` — mark buffer as clean or dirty
- `(buffer-get-line-indent LINE)` — return leading whitespace column count for a line
- `(buffer-set-line-indent LINE COLUMN)` — replace leading whitespace to set indent to COLUMN
- `(buffer-previous-non-blank-line LINE)` — return line number of previous non-blank line
- `(buffer-line-matches LINE PATTERN)` — test if a line matches a regex pattern
- Track `modified: boolean` per buffer (set true on insert/delete, false after save)
- Verify: `bun test` passes, `bunx tsc --noEmit` passes

### 0b. Replace File-Ops Stubs with Real Primitives in `src/editor/api/file-ops.ts`
Replace the current error-returning stubs with real implementations:
- `(write-file-content PATH CONTENT)` — write string to file path (async fire-and-forget, logs result via `logMessage`)
- `(read-file-content PATH)` — read file content as string (sync wrapper around `filesystem.readFile`)
- `(file-exists-p PATH)` — return `t` if path exists, `nil` otherwise
- `(file-modtime PATH)` — return modification timestamp string for a file
- `(file-copy SRC DEST)` — copy file from SRC to DEST
- `(make-backup-file PATH)` — copy PATH to `PATH~` backup (used by save-buffer)
- `(file-remove PATH)` — delete a file
- `(file-mkdir PATH)` — create directory
- `(read-dir PATH)` — list directory contents, return list of `{name, isFile, isDirectory, size, modified}`
- `(file-stat PATH)` — return file metadata `{size, modified, isFile, isDirectory}`
- Each wraps the corresponding `filesystem.*` method, returns `Either` for error handling
- Verify: `bun test` passes, `bunx tsc --noEmit` passes

### 0c. Add Hook System in `src/editor/api/hook-ops.ts`
- Create `src/editor/api/hook-ops.ts` with T-Lisp-callable primitives:
  - `(add-hook HOOK-NAME FUNCTION-NAME)` — append a function to a named hook list
  - `(remove-hook HOOK-NAME FUNCTION-NAME)` — remove a function from a hook list
  - `(run-hooks HOOK-NAME)` — execute all functions in a hook list in order
  - `(hook-list HOOK-NAME)` — return list of function names registered for a hook
- Hook storage: `Map<string, string[]>` on editor state — each hook name maps to a list of T-Lisp function symbols
- Standard hook names: `before-save-hook`, `after-save-hook`, `find-file-hook`, `mode-activate-hook`, `mode-deactivate-hook`
- Register in `src/editor/tlisp-api.ts`
- Verify: `bun test` passes

### 0d. Create T-Lisp Save Command in `src/tlisp/core/commands/save.tlisp`
- Compose `(save-buffer)` from granular primitives:
  ```lisp
  (defun save-buffer (&optional filename)
    (unless (buffer-modified-p)
      (message "No changes to save")
      (return-from save-buffer))
    (let ((path (or filename (buffer-filename))))
      (unless path
        (message "Buffer has no associated file")
        (return-from save-buffer))
      (run-hooks "before-save-hook")
      (when (file-exists-p path)
        (make-backup-file path))
      (write-file-content path (buffer-text))
      (set-buffer-filename path)
      (set-buffer-modified-p nil)
      (run-hooks "after-save-hook")
      (message (concat "Saved " path))))
  ```
- Update `src/editor/api/bindings-ops.ts` `save-file` binding to dispatch `(save-buffer)` instead of calling `editor.saveFile()` directly
- Verify: `bun test` passes, opening and saving a file still works end-to-end

### 0e. Create T-Lisp Find-File Command in `src/tlisp/core/commands/find-file.tlisp`
- Compose `(find-file PATH)` from granular primitives:
  ```lisp
  (defun find-file (path)
    (run-hooks "find-file-hook")
    (let ((content (read-file-content path)))
      (if content
        (progn
          (buffer-create path)
          (buffer-switch path)
          (set-buffer-filename path)
          (buffer-insert (list 0 0) content)
          (set-buffer-modified-p nil)
          (message (concat "Opened " path)))
        (message (concat "Could not open " path)))))
  ```
- Update `open-file` binding to dispatch `(find-file path)`
- Verify: `bun test` passes, opening a file via command or T-Lisp works

### 0f. Write Tests for New Primitives
- `test/unit/buffer-metadata.test.ts` — test `buffer-filename`, `buffer-modified-p`, `set-buffer-modified-p`, `buffer-get-line-indent`, `buffer-set-line-indent`, `buffer-previous-non-blank-line`
- `test/unit/file-primitives.test.ts` — test `write-file-content`, `read-file-content`, `file-exists-p`, `file-modtime`, `file-copy`, `make-backup-file` (mock filesystem)
- `test/unit/hook-system.test.ts` — test `add-hook`, `run-hooks`, `remove-hook`, `hook-list`
- Verify: `bun test` passes

### 1. Add Core Types to `src/core/types.ts`
- Add `HighlightSpan: { start: number; end: number; style: { fg?: string; bg?: string; bold?: boolean; underline?: boolean } }`
- Add `SyntaxToken: { type: string; value: string; line: number; startCol: number; endCol: number }`
- Add `MajorModeConfig: { name: string; extensions: string[]; syntaxRules: SyntaxRule[]; indentRules: IndentRule[]; keyBindings: Record<string,string>; hooks: string[] }`
- Extend `EditorState` with `currentMajorMode: string`, `highlightSpans: HighlightSpan[][]`, `searchMatches: Range[]`
- Verify: `bunx tsc --noEmit` passes with new types

### 2. Build Syntax Type Definitions
- Create `src/syntax/types.ts` with `SyntaxRule: { pattern: RegExp; type: string; priority?: number }` and `HighlightTheme: Record<string, { fg?: string; bg?: string; bold?: boolean; underline?: boolean }>`
- Define default dark theme mapping token types to ANSI colors
- Verify: `bunx tsc --noEmit` passes

### 3. Build Generic Tokenizer
- Create `src/syntax/tokenizer.ts` with `tokenize(line: string, rules: SyntaxRule[]): SyntaxToken[]`
- Iterate rules in priority order; longest match wins; skip already-tokenized spans
- Handle multi-character tokens correctly (strings, comments, regex literals)
- Verify: write and run `test/unit/syntax-tokenizer.test.ts` — test that a line of TS code produces correct token types

### 4. Build Highlighter
- Create `src/syntax/highlighter.ts` with `highlightLine(tokens: SyntaxToken[], theme: HighlightTheme): HighlightSpan[]`
- Map each token's `type` to theme style; produce contiguous `HighlightSpan` array
- Verify: write and run test — tokens with known types produce expected ANSI spans

### 5. Create Language Rule Sets
- Create `src/syntax/languages/typescript.ts` — rules for keywords, strings, comments, numbers, types, decorators
- Create `src/syntax/languages/python.ts` — rules for keywords, strings, comments, decorators, f-strings
- Create `src/syntax/languages/lisp.ts` — rules for parens, symbols, strings, comments, special forms
- Create `src/syntax/languages/go.ts` — rules for keywords, strings, comments, types, runes
- Each exports `rules: SyntaxRule[]` and `extensions: string[]`
- Verify: unit test each language tokenizer against sample code

### 6. Update Rendering Pipeline for Highlights
- Modify `src/frontend/render/buffer-lines.ts`:
  - Accept `highlightSpans: HighlightSpan[][]` parameter (per visible line)
  - Apply ANSI escape codes from spans before fitting to width
  - Preserve cursor-line highlighting (cursor bg color wins over syntax bg)
  - Use existing `style()` from `src/frontend/frontends/steep/style.ts`
- Verify: `bun test` — existing render tests still pass

### 7. Create Syntax T-Lisp API (Granular Primitives)
- Create `src/editor/api/syntax-ops.ts` with granular primitives:
  - `(syntax-tokenize-line LINE-NUM)` — return tokens for a line using current rules (for testing/debugging)
  - `(syntax-apply-highlights SPANS)` — set highlight spans for rendering
  - `(syntax-clear-highlights)` — clear all highlight spans
  - `(syntax-set-language "name")` — set active language rules
  - `(syntax-get-language)` — return current language name
  - `(syntax-highlight-enable)` — enable auto-highlighting for current buffer
  - `(syntax-highlight-disable)` — disable
  - `(syntax-highlight-toggle)` — toggle
  - `(syntax-highlight-line LINE-NUM)` — tokenize and return highlight spans for one line
- Register all functions in `src/editor/tlisp-api.ts`
- Verify: `bun test` passes, `bunx tsc --noEmit` passes

### 8. Add Highlight Recomputation to Editor
- In `src/editor/editor.ts`:
  - Add `recomputeHighlights()` that tokenizes visible viewport lines using current mode's rules
  - Call after buffer modifications, scroll, and buffer switch
  - Store result in `state.highlightSpans`
  - Only recompute visible lines for performance
- Verify: open a TS file in the editor, see colored keywords and comments

### 9. Write Syntax Highlighting Tests
- `test/unit/syntax-highlighter.test.ts`:
  - Test tokenizer produces correct tokens for each language sample
  - Test highlighter maps tokens to ANSI spans
  - Test overlapping highlights (cursor vs syntax) — cursor bg wins
  - Test unknown token types produce no styling
  - Test empty buffer and single-character buffer edge cases

### 10. Add Search Granular Primitives
- Extend `src/editor/api/search-ops.ts` with granular primitives:
  - `(search-find-all-matches PATTERN &optional START END)` — return list of `{line, startCol, endCol}` ranges matching pattern (supports regex)
  - `(search-set-highlight-ranges RANGES)` — store match ranges for rendering
  - `(search-clear-highlights)` — clear match ranges
  - `(search-incremental-start DIRECTION)` — enter isearch sub-mode (sets state flag)
  - `(search-incremental-update CHAR)` — append char to pattern, call `search-find-all-matches`, call `search-set-highlight-ranges`, move cursor to first match
  - `(search-incremental-backspace)` — remove last char, re-search
  - `(search-incremental-finish)` — accept search (Enter)
  - `(search-incremental-cancel)` — cancel (Escape), call `search-clear-highlights`
- Verify: `bunx tsc --noEmit` passes

### 11. Create T-Lisp Isearch Command in `src/tlisp/core/commands/isearch.tlisp`
- Compose isearch behavior from primitives:
  ```lisp
  (defun isearch-forward ()
    (search-incremental-start "forward")
    (editor-set-mode "isearch"))

  (defun isearch-update (char)
    (search-incremental-update char)
    (minibuffer-set (concat "I-search: " (search-pattern-get))))

  (defun isearch-exit ()
    (search-incremental-finish)
    (editor-set-mode "normal"))

  (defun isearch-cancel ()
    (search-incremental-cancel)
    (editor-set-mode "normal"))
  ```
- Wire handlers to dispatch T-Lisp commands:
  - `/` → `(isearch-forward)`, `?` → `(isearch-backward)`
  - In isearch sub-mode: printable keys → `(isearch-update char)`, Backspace → `(search-incremental-backspace)`, Enter → `(isearch-exit)`, Escape → `(isearch-cancel)`
- Verify: `bun test` passes

### 12. Update Render for Search Highlights
- In `src/frontend/render/buffer-lines.ts`:
  - Accept `searchMatches: Range[]` parameter
  - Apply distinct style (reverse-video or yellow underline) to match ranges
  - First/current match gets additional emphasis (bold or different color)
- In `src/frontend/render/status-line.ts`:
  - Show isearch prompt: `I-search: pattern` during incremental search
- Verify: `bun test` passes

### 13. Write Incremental Search Tests
- `test/unit/incremental-search.test.ts`:
  - Test match finding as pattern grows character by character
  - Test cursor jumps to first match on each keystroke
  - Test wrap-around search (search wraps from end to beginning)
  - Test regex patterns compile and match correctly
  - Test invalid regex shows error, doesn't crash
  - Test cancel clears all search highlights
  - Test backspace shrinks pattern and re-searches

### 14. Build Query-Replace Granular Primitives
- Create `src/editor/api/replace-ops.ts` with granular primitives:
  - `(replace-find-matches PATTERN &optional START END)` — find all match ranges (reuses `search-find-all-matches` internally)
  - `(buffer-replace-range START-LINE START-COL END-LINE END-COL NEW-TEXT)` — replace text in a range (wraps `buffer.delete` + `buffer.insert`)
  - `(replace-apply-current)` — replace current match using `buffer-replace-range`, advance to next
- Replace state: `{ findPattern, replaceText, matches: Range[], currentIndex, count, active }`
- Support regex capture groups (`\1`, `\2`) in replacement text
- Support `g` flag for global
- Register in `src/editor/tlisp-api.ts`
- Verify: `bunx tsc --noEmit` passes

### 15. Create T-Lisp Replace Command in `src/tlisp/core/commands/replace.tlisp`
- Compose query-replace behavior from primitives:
  ```lisp
  (defun query-replace (find replace &optional start end)
    (let ((matches (replace-find-matches find start end)))
      (when (null matches)
        (message "No matches found")
        (return-from query-replace))
      ;; store replace state, enter replace mode
      (replace-state-init find replace matches)
      (editor-set-mode "replace")
      (replace-show-current)))

  (defun replace-yes () (replace-apply-current) (replace-next-or-exit))
  (defun replace-no () (replace-skip) (replace-next-or-exit))
  (defun replace-all () (replace-apply-all) (replace-exit))
  (defun replace-quit () (replace-exit))
  ```
- In `src/editor/handlers/command-handler.ts`:
  - Parse `:s/foo/bar/` and `:s/foo/bar/g` — current line replace, dispatch `(query-replace ...)`
  - Parse `:%s/foo/bar/` and `:%s/foo/bar/g` — whole buffer replace
  - Handle escaped delimiters (`\/` in pattern)
- In replace mode: `y` → `(replace-yes)`, `n` → `(replace-no)`, `a` → `(replace-all)`, `q`/Escape → `(replace-quit)`
- Verify: `bun test` passes

### 16. Update Render for Replace Highlights
- In `src/frontend/render/buffer-lines.ts`:
  - Current replace match: show original in red strikethrough, replacement in green
  - Other pending matches: subtle underline
- In `src/frontend/render/status-line.ts`:
  - Show replace prompt: `Replace foo with bar? (y/n/a/q) [3/7]`
- Verify: `bun test` passes

### 17. Write Query-Replace Tests
- `test/unit/query-replace.test.ts`:
  - Test single replace on current line (`:s/foo/bar/`)
  - Test replace-all in buffer (`:%s/foo/bar/g`)
  - Test y/n/a/q interaction sequence
  - Test replacement count tracking
  - Test regex capture groups in replacement (`\1`, `\2`)
  - Test empty replace string (deletion)
  - Test no-match case (graceful exit with "no matches" message)
  - Test escaped delimiters in pattern

### 18. Build Auto-Indent Granular Primitives
- Create `src/editor/api/indent-ops.ts` with granular primitives:
  - `(buffer-get-line-indent LINE)` — return leading whitespace column count for a line (already added in step 0a)
  - `(buffer-set-line-indent LINE COLUMN)` — set leading whitespace to COLUMN spaces (already added in step 0a)
  - `(buffer-previous-non-blank-line LINE)` — find previous line with content (already added in step 0a)
  - `(indent-calculate-column LINE INCREASE-RULES DECREASE-RULES)` — pure calculation: examine previous non-blank line indent, apply regex rules, return target column
  - `(indent-apply-line LINE)` — calculate indent for a line and apply via `buffer-set-line-indent`
  - `(indent-apply-region START END)` — re-indent a range of lines
  - `(indent-set-rules INCREASE DECREASE)` — store rules for current buffer's mode
  - `(indent-get-rules)` — return current indent rules
- Indent algorithm: examine previous non-blank line's indent, apply adjust rules (regex patterns that increase/decrease indent level)
- Rules format: two lists of regex strings — `increase` patterns (matched against previous line), `decrease` patterns (matched against current line)
- Register in `src/editor/tlisp-api.ts`
- Verify: `bunx tsc --noEmit` passes

### 19. Create T-Lisp Indent Rule Files and Indent Command
- Create `src/tlisp/core/indent/typescript.tlisp`:
  - Increase after `{`, `(`, `[`, `=>`, `else`, `catch`, `finally`
  - Decrease for `}`, `)`, `]` at line start, `else`, `catch`, `finally`
- Create `src/tlisp/core/indent/lisp.tlisp`:
  - Increase after unmatched `(`
  - Align to first argument position for special forms (`defun`, `let`, `if`)
- Create `src/tlisp/core/indent/python.tlisp`:
  - Increase after `:` at line end
  - Decrease for `return`, `break`, `pass`, `else`, `elif` at line start
- Create `src/tlisp/core/indent/generic.tlisp`:
  - Match previous line's indent, increase after `{`, decrease for `}`
- Create `src/tlisp/core/commands/indent.tlisp`:
  ```lisp
  (defun indent-line ()
    (let ((rules (indent-get-rules)))
      (when rules
        (let ((col (indent-calculate-column (cursor-line) (car rules) (cadr rules))))
          (buffer-set-line-indent (cursor-line) col)))))

  (defun indent-region (start end)
    (let ((line start))
      (while (<= line end)
        (let ((col (indent-calculate-column line (car (indent-get-rules)) (cadr (indent-get-rules)))))
          (buffer-set-line-indent line col))
        (set! line (+ line 1)))))
  ```
- Verify: each file loads without T-Lisp errors

### 20. Hook Auto-Indent into Insert Mode
- In `src/editor/handlers/insert-handler.ts`:
  - On Enter key: insert newline, then call `(indent-line)` to position cursor at correct column
  - On `}` or `)`: auto-outdent if line has only whitespace before the bracket (electric indent)
- In `src/editor/handlers/normal-handler.ts`:
  - `==` — indent current line
  - `=` with visual selection — indent region
- Verify: `bun test` passes

### 21. Write Auto-Indent Tests
- `test/unit/auto-indent.test.ts`:
  - Test indent calculation for each language's rules
  - Test Enter key inserts newline with correct indentation
  - Test indent-region re-formats selected text
  - Test empty lines get no indent
  - Test tab/spaces behavior respects `tabSize` config
  - Test electric outdent on `}` and `)`

### 22. Build Major Mode System
- Create `src/editor/api/major-mode-ops.ts`:
  - Mode registry: `Map<string, MajorModeConfig>`
  - `(major-mode-set MODE-NAME)` — activate a major mode for current buffer: set mode name, load syntax rules, load indent rules, load key bindings, run `(run-hooks "mode-activate-hook")` (from Phase 0 hook system)
  - `(major-mode-get)` — return current major mode name
  - `(major-mode-register CONFIG)` — register a new major mode from T-Lisp (stores name, extensions, syntax language, indent rule names, key bindings)
  - `(major-mode-list)` — list all registered modes
  - `(major-mode-auto-detect)` — detect mode from current buffer's file extension (uses `(buffer-filename)`)
  - `(major-mode-hook-add MODE HOOK-FN)` — convenience wrapper around `(add-hook "mode-MODE-activate-hook" HOOK-FN)`
  - `(major-mode-hook-run MODE)` — convenience wrapper around `(run-hooks "mode-MODE-activate-hook")`
- Store mode per buffer (not global) — add `majorMode: string` to buffer metadata
- Register in `src/editor/tlisp-api.ts`
- Verify: `bunx tsc --noEmit` passes

### 23. Ship Default Major Mode Definitions
- Create `src/tlisp/core/modes/fundamental.tlisp` — plain text mode, no syntax, no indent, always available as fallback
- Create `src/tlisp/core/modes/typescript-mode.tlisp` — register with `.ts`/`.tsx`, load TS syntax + indent
- Create `src/tlisp/core/modes/python-mode.tlisp` — register with `.py`/`.pyi`
- Create `src/tlisp/core/modes/lisp-mode.tlisp` — register with `.tlisp`/`.lisp`/`.el`
- Create `src/tlisp/core/modes/go-mode.tlisp` — register with `.go`
- Each mode file calls `(major-mode-register ...)` with name, extensions, syntax rules reference, indent rules reference
- In editor init: load all mode files, register them in the mode registry
- Verify: each mode file loads without T-Lisp errors

### 24. Wire Major Modes into Editor Lifecycle
- In `src/editor/editor.ts`:
  - On `openFile()`: after loading file, call `(major-mode-auto-detect)` to set mode by extension
  - On buffer switch: re-activate mode for the new buffer
  - Mode activation triggers syntax highlight recomputation and indent rule loading
- In `src/frontend/render/status-line.ts`:
  - Display active major mode name (e.g., `TS`, `Py`, `Lisp`, `Go`, `Fund`)
- Verify: open a `.ts` file and confirm status shows `TS` with syntax highlights

### 25. Write Major Mode Tests
- `test/unit/major-mode.test.ts`:
  - Test mode registration and retrieval
  - Test auto-detection by file extension (`.ts` maps to typescript, `.py` maps to python)
  - Test mode hooks fire on activation
  - Test buffer-switch preserves per-buffer mode
  - Test fundamental mode as fallback for unknown extensions
  - Test manual mode override `(major-mode-set "lisp")`

### 26. Add Filesystem Prerequisites for Dired
- Extend `src/core/filesystem.ts`:
  - Add `readDir(path: string): Either<FileSystemError, Dirent[]>` — list directory contents
  - Add `stat(path: string): Either<FileSystemError, FileStats>` — get file metadata
  - Add `remove(path: string): TaskEither<FileSystemError, void>` — delete file
  - Add `mkdir(path: string): TaskEither<FileSystemError, void>` — create directory
- `Dirent` type: `{ name: string; isFile: boolean; isDirectory: boolean; size: number; modified: Date }`
- Verify: `bunx tsc --noEmit` passes

### 27. Build Dired Granular Primitives
- Create `src/editor/api/dired-ops.ts` with granular primitives (most are already in `file-ops.ts` from step 0b, dired-ops adds buffer formatting):
  - `(dired-format-listing PATH ENTRIES)` — format directory entries into display string (columns: permissions, size, date, name, mark prefix)
  - `(dired-parse-current-entry)` — extract filename from current cursor line in `*Dired*` buffer
  - `(dired-is-directory-p ENTRY)` — check if entry is a directory
- Primitives already available from step 0b: `read-dir`, `file-stat`, `file-remove`, `file-mkdir`, `file-copy`
- Register in `src/editor/tlisp-api.ts`
- Verify: `bunx tsc --noEmit` passes

### 28. Create T-Lisp Dired Command in `src/tlisp/core/commands/dired.tlisp`
- Compose dired behavior from primitives:
  ```lisp
  (defun dired (&optional path)
    (let ((dir (or path (buffer-filename) ".")))
      (let ((entries (read-dir dir)))
        (buffer-create "*Dired*")
        (buffer-switch "*Dired*")
        (set-buffer-filename dir)
        ;; insert formatted listing
        (buffer-insert (list 0 0) (dired-format-listing dir entries))
        (set-buffer-modified-p nil)
        (message (concat "Dired: " dir)))))

  (defun dired-open-file ()
    (let ((entry (dired-parse-current-entry)))
      (if (dired-is-directory-p entry)
        (dired (concat (buffer-filename) "/" entry))
        (find-file (concat (buffer-filename) "/" entry)))))

  (defun dired-mark-delete ()
    ;; toggle delete mark on current line, move down
    ...)
  ```
- Wire key bindings in `src/tlisp/core/bindings/normal.tlisp`:
  - When `*Dired*` buffer is active, override keys:
    - `j`/`k` — navigate files (reuse existing line motion)
    - `Enter` → `(dired-open-file)`
    - `^` → `(dired-up-directory)` (navigate to parent)
    - `d` → `(dired-mark-delete)`
    - `u` → `(dired-unmark)`
    - `x` → `(dired-execute-deletions)` (calls `file-remove` for each marked entry)
    - `+` → prompt for name, `(file-mkdir name)`
    - `a` → `(dired-toggle-hidden)`
    - `g` → `(dired-refresh)` (re-reads `read-dir`, reformats buffer)
    - `q` → close `*Dired*` buffer, switch to previous buffer
- In `src/editor/handlers/command-handler.ts`:
  - `:dired` → `(dired)`
  - `:e .` → `(dired)`
  - `:e /path/to/dir` → `(dired "/path/to/dir")`
- Verify: `bun test` passes
- In `src/tlisp/core/bindings/normal.tlisp`:
  - When `*Dired*` buffer is active, add key overrides:
    - `j`/`k` — navigate files (reuse existing line motion)
    - `Enter` — `(dired-open-file)`
    - `^` — `(dired-up-directory)`
    - `d` — `(dired-mark-delete)`
    - `u` — `(dired-unmark)`
    - `x` — `(dired-execute-deletions)`
    - `+` — prompt for name, `(dired-create-directory name)`
    - `a` — `(dired-toggle-hidden)`
    - `g` — `(dired-refresh)`
    - `q` — close `*Dired*` buffer, switch to previous buffer
- In `src/editor/handlers/command-handler.ts`:
  - `:dired` calls `(dired-open)`
  - `:e .` calls `(dired-open)`
  - `:e /path/to/dir` calls `(dired-open "/path/to/dir")`
- Verify: `bun test` passes

### 29. Write Dired Tests
- `test/unit/dired.test.ts`:
- `test/unit/dired.test.ts`:
  - Test directory listing formatting (files, directories, sizes, dates)
  - Test navigation (j/k moves cursor, Enter opens file/enters directory)
  - Test mark/unmark/delete cycle (marks tracked, deletions confirmed)
  - Test opening file creates buffer and switches to it
  - Test parent directory navigation (`^`)
  - Test create directory
  - Test hidden file toggle (dotfiles shown/hidden)
  - Test sort by name, date, size
  - Mock filesystem for deterministic test results

### 30. Integration Test — Full Feature Interaction
- Test: open `.ts` file, verify syntax highlights, run `/` incremental search to highlight matches, run `:%s/old/new/g` to replace all, press Enter in insert mode to verify auto-indent, run `:dired` to open file browser, open another `.py` file, verify mode switches and Python syntax/indent rules apply
- Test: all highlight types (syntax + search + replace) render simultaneously without conflicts
- Test: T-Lisp customization — user calls `(major-mode-register ...)` with custom rules and they activate

### 31. Final Validation
- Run `bun test` — all existing tests pass, all new tests pass, zero regressions
- Run `bunx tsc --noEmit` — zero TypeScript errors
- Run `bun run start examples/demo.ts` — manual verify: syntax colors, `/` incremental search, Enter auto-indents, `:dired` opens file browser, `:%s` replaces text
- Run `bun run tui` — verify TUI client renders all highlights correctly in terminal

## Testing Strategy

### Unit Tests
- **Syntax Tokenizer**: Correct tokens per language, longest match wins, no overlaps, empty input
- **Highlighter**: Token-to-ANSI mapping, theme lookup, unknown types get no styling
- **Incremental Search**: Character-by-character matching, cursor tracking, wrap-around, regex, cancel clears state
- **Query-Replace**: Single/line/buffer replace, y/n/a/q interaction, count, regex groups, no-match case
- **Auto-Indent**: Per-language calculation, Enter inserts indent, electric outdent, tab/spaces config
- **Major Modes**: Registration, retrieval, auto-detection, hooks, per-buffer mode, fundamental fallback
- **Dired**: Listing format, navigation, mark/delete cycle, file open, parent dir, create dir, sort, hidden toggle

### Integration Tests
- Open file, verify syntax highlights, search, replace, indent, open dired, switch buffer, confirm mode change
- All highlight layers (syntax + search + replace) render together correctly
- T-Lisp customization: register new mode, add syntax rules, add indent rules

### Edge Cases
- Empty buffer with any operation
- Binary/non-UTF8 files — dired lists them, editor shows replacement characters
- Very long lines (>terminal width) — syntax highlights within visible viewport only
- Large files (>10K lines) — only tokenize visible viewport
- Nested/unmatched brackets for indent
- Regex special characters in search/replace — correct escaping
- Concurrent highlights — syntax + search + replace all visible
- Dired with permission errors — graceful messages, no crash
- File deleted externally — dired refresh shows updated listing

## Acceptance Criteria

1. **Syntax Highlighting**: TypeScript, Python, Lisp, Go files render with colored keywords, strings, comments, numbers. Updates on every edit. No lag on files under 10K lines.
2. **Incremental Search**: `/` starts search; each character highlights all matches in real-time; cursor jumps to first match; Enter confirms; Escape cancels and clears. Regex supported.
3. **Query-Replace**: `:s/foo/bar/g` replaces on current line. `:%s/foo/bar/g` replaces in whole buffer. Without `g`, prompts per match with y/n/a/q. Shows count. Supports regex capture groups.
4. **Auto-Indentation**: Enter in insert mode inserts newline with correct indent for the active major mode. `==` re-indents line. `=` on visual selection re-indents region.
5. **Major Modes**: Buffer gets correct mode by file extension. Mode activates syntax + indent + hooks. `fundamental-mode` fallback. Status line shows current mode.
6. **Dired**: `:dired` opens directory browser. j/k navigate. Enter opens file/enters directory. `^` goes to parent. `d` marks, `x` deletes with confirmation. `+` creates directory. `q` closes.

## Validation Commands

- `bun test test/unit/syntax-highlighter.test.ts` — Syntax tokenizer and highlighter tests pass
- `bun test test/unit/incremental-search.test.ts` — Incremental search tests pass
- `bun test test/unit/query-replace.test.ts` — Query-replace tests pass
- `bun test test/unit/auto-indent.test.ts` — Auto-indent tests pass
- `bun test test/unit/dired.test.ts` — Dired tests pass
- `bun test test/unit/major-mode.test.ts` — Major mode tests pass
- `bun test` — Full test suite passes with zero regressions
- `bunx tsc --noEmit` — Zero TypeScript errors
- `bun run start examples/demo.ts` — Manual verify: syntax colors visible, `/` incremental search works, Enter auto-indents, `:dired` opens file browser

## Notes

- **Granular primitives, T-Lisp composition**: Every user-visible command (save-buffer, find-file, isearch-forward, query-replace, indent-line, dired) is a T-Lisp function composed from fine-grained TypeScript primitives. Users can override, advise, or replace any command via T-Lisp. The test: "would an Emacs user want to customize this step?" — if yes, it's a T-Lisp-callable primitive.
- **Async pattern**: T-Lisp is synchronous. Async operations (file I/O) use fire-and-forget: the primitive starts the async op and sets status/logs in `.then()`. This matches the existing pattern in `bindings-ops.ts`.
- **Performance**: Syntax tokenization processes only visible viewport lines. Cache tokenized lines and invalidate on edit.
- **No external dependencies**: All syntax highlighting is regex-based in TypeScript/T-Lisp. No tree-sitter or external parsers.
- **Phase ordering matters**: Phase 0 (primitives) comes first because all subsequent T-Lisp commands depend on granular TypeScript primitives. Syntax highlighting comes next because search and replace depend on the highlight rendering infrastructure.
- **Dired uses existing buffer infrastructure**: No special rendering — it's a buffer with formatted text and overridden key bindings.
- **Future extensibility**: The `HighlightSpan` interface and rendering pipeline are designed so a future tree-sitter integration could replace `src/syntax/tokenizer.ts` without changing downstream consumers. The granular primitive pattern means a future tree-sitter mode just replaces `(syntax-tokenize-line)` — the T-Lisp composition above it stays the same.
