# RFC-003: Emacs Parity Roadmap

**Author:** Mekael Turner
**Date:** 2026-06-03
**Status:** DRAFT
**Replaces:** Gap analysis derived from `~/.emacs.d/init.el`

## Abstract

This RFC defines the feature work required to bring tmax from its current state (v0.2.0 — modal editing + T-Lisp + daemon) to parity with the author's Emacs workflow as configured in `init.el`. Features are prioritized in four tiers, from essential daily-driver capabilities to nice-to-haves.

## Motivation

The `init.el` configures ~60 packages spanning editing, org-mode, language support, git, email, browsing, and DevOps. tmax currently covers the foundation (evil-style modal editing, T-Lisp extensibility, daemon/client, buffer management). This RFC answers: what must be built, in what order, for tmax to replace Emacs as a daily editor?

## Current State

| Category | Emacs Package(s) | tmax Status |
|---|---|---|
| Modal editing | evil, evil-collection, evil-commentary, evil-surround, evil-goggles, evil-numbers | Done (normal/insert/visual/command/mx) |
| Leader keys / which-key | general, which-key | Done |
| Minibuffer + completion | vertico, corfu, cape, orderless, marginalia | Partial (fuzzy M-x exists; no in-buffer completion) |
| M-x / eval-expression | built-in | Done |
| Daemon / client | built-in server | Done |
| Help system | helpful | Done |
| Syntax highlighting | tree-sitter, tree-sitter-langs | Not started |
| Incremental search | evil-search, consult-line | Basic `/` `?` `n` `N` exists; no real-time highlighting |
| Find/replace | built-in, consult | Not started |
| Auto-indent | built-in, per-mode | Not started |
| Major modes | built-in, per-language packages | Mode system exists but no language modes |
| Window splitting | built-in, ace-window | Not started |
| File browser | dired, projectile | Not started (dired planned in SPEC-035) |
| Relative line numbers | display-line-numbers | Not started |
| Git integration | magit, git-gutter | Not started |
| Undo tree | undo-tree | Basic u/C-r exists; no tree visualization |
| Smartparens | smartparens | Not started |
| Snippets | yasnippet | Not started |
| Org-mode | org, org-roam, org-journal, org-agenda, org-capture, org-babel | Not started |
| LSP | lsp-mode, lsp-ui | Not started |
| Theme / modeline | doom-themes, doom-modeline | Basic status line only |
| Terminal | vterm, eat | Not started |
| Email | mu4e | Out of scope |
| Browser | EWW | Out of scope |
| AI | gptel, claude-code.el | Out of scope |
| RSS | elfeed | Out of scope |

---

## Tier 1: Essential — Cannot daily-drive without these

These are the minimum features a developer needs to edit code productively. Each maps to functionality used dozens of times per hour.

### 1.1 Syntax Highlighting
**Emacs:** tree-sitter + language grammars
**Spec reference:** SPEC-035 Phase 1

Regex-based tokenizer with per-language rule sets. ANSI color rendering in the TUI pipeline. Ship rules for TypeScript, Python, Lisp/T-Lisp, Go initially.

- Add `src/syntax/` module (tokenizer, highlighter, language rules)
- Extend rendering pipeline to apply `HighlightSpan[]`
- T-Lisp API: `syntax-set-language`, `syntax-highlight-toggle`
- Only tokenize visible viewport lines

**Estimated effort:** 2-3 weeks
**Blocks:** search highlighting, replace preview, LSP (future)

### 1.2 Incremental Search with Highlighting
**Emacs:** evil-search (`/` with real-time match highlighting)
**Spec reference:** SPEC-035 Phase 2

Current `/` `?` `n` `N` works but has no real-time highlighting. Extend with:
- Highlight all matches as user types
- Current match emphasized (bold/different color)
- Regex support
- Reuse highlight rendering from 1.1

**Estimated effort:** 1 week
**Depends on:** 1.1 (highlight rendering)

### 1.3 Query-Replace
**Emacs:** `:s/foo/bar/g`, `M-%` (query-replace)
**Spec reference:** SPEC-035 Phase 3

- `:s/pattern/replacement/flags` for current line
- `:%s/pattern/replacement/flags` for whole buffer
- Interactive y/n/a/q per-match confirmation
- Regex capture group support (`\1`, `\2`)
- Highlight current match with replacement preview

**Estimated effort:** 1 week
**Depends on:** 1.2 (match finding + highlighting)

### 1.4 Auto-Indentation
**Emacs:** per-mode indent rules, electric indent
**Spec reference:** SPEC-035 Phase 4

- Enter key inserts newline + correct indent for active mode
- Indent rules defined per-language in T-Lisp
- `==` re-indent line, `=` on visual selection re-indents region
- Electric outdent on `}`, `)`
- Ship rules: TypeScript, Python, Lisp, generic

**Estimated effort:** 1.5 weeks
**Depends on:** 1.5 (major modes to carry indent rules)

### 1.5 Major Modes
**Emacs:** fundamental-mode, typescript-mode, python-mode, etc.
**Spec reference:** SPEC-035 Phase 5

Each buffer gets a major mode (auto-detected from file extension). Modes carry:
- Syntax rules (for highlighting)
- Indent rules (for auto-indent)
- Key bindings (mode-specific overrides)
- Mode hooks (activate/deactivate)

Ship modes: TypeScript, Python, Lisp, Go, fundamental (fallback).

**Estimated effort:** 1.5 weeks
**Depends on:** 1.1 (syntax rules), SPEC-035 Phase 0 (hook system)

### 1.6 Directory Editor (Dired)
**Emacs:** dired
**Spec reference:** SPEC-035 Phase 6

- `:dired` or `:e .` opens directory listing as a buffer
- `j`/`k` navigate, Enter opens file/enters directory
- `^` goes to parent, `d` marks for delete, `x` executes deletions
- `+` creates directory, `g` refreshes, `q` closes
- Uses existing buffer infrastructure (special buffer with overridden keys)

**Estimated effort:** 1.5 weeks
**Depends on:** filesystem primitives from SPEC-035 Phase 0

### 1.7 Window Splitting
**Emacs:** `C-x 2`, `C-x 3`, ace-window
**Roadmap reference:** Phase 1.12, Phase 3.2

- `(split-window-below)` / `(split-window-right)`
- `(delete-window)` / `(delete-other-windows)`
- `(other-window)` to cycle focus
- Vim-style `:split` / `:vsplit` aliases
- SPC w prefix for window commands (Spacemacs-style)

**Estimated effort:** 2-3 weeks (viewport rewrite)
**Blocks:** ace-window, file tree sidebar

### 1.8 Relative Line Numbers
**Emacs:** `display-line-numbers-type 'relative`

- Gutter column showing relative line numbers
- Toggleable via T-Lisp: `(line-numbers-mode 'relative)`
- Current line shows absolute number
- Configurable width

**Estimated effort:** 3-5 days
**No dependencies**

---

## Tier 2: Important — Significant quality-of-life improvements

These features make the difference between "works" and "works well." A developer can function without them but will notice their absence constantly.

### 2.1 Git Integration
**Emacs:** magit (status), git-gutter (diff markers in gutter)

**Git-gutter equivalent:**
- Show added/modified/deleted indicators in gutter (next to line numbers)
- Stage/unstage hunks, navigate between changes
- Update on save and on toggle

**Magit-lite (future):**
- `:magit` or `SPC g` opens a git status buffer
- Stage, unstage, commit, diff, log from within editor
- This is a large feature; start with gutter markers only

**Estimated effort:** 1-2 weeks (gutter), 3-4 weeks (magit-lite)
**Depends on:** 1.8 (gutter rendering)

### 2.2 Undo Tree Visualization
**Emacs:** undo-tree (visual branching undo)

Current u/C-r provides linear undo/redo. Add:
- Branching undo (edit after undo creates a new branch)
- Tree visualization buffer (`:undotree`)
- Navigate between branches visually
- Persist undo history to disk

**Estimated effort:** 2-3 weeks
**No dependencies**

### 2.3 Structural Editing
**Emacs:** smartparens, rainbow-delimiters, lispy

- Auto-insert closing delimiter on `(`, `{`, `[`, `"`, `'`
- Delete matching pair when deleting opener
- Wrap/unwrap selection with delimiters
- Rainbow delimiters: color nesting depth for parens
- Barf/slurp for T-Lisp editing

**Estimated effort:** 1-2 weeks
**Depends on:** 1.1 (ANSI color for rainbow)

### 2.4 In-Buffer Completion
**Emacs:** corfu, cape, company

- Completion popup while typing (after configurable delay)
- Sources: buffer words (dabbrev), file paths, buffer names, T-Lisp functions
- Cycle with Tab/Shift-Tab
- `C-SPC` or Tab to trigger manually
- Required foundation for future LSP completion

**Estimated effort:** 2 weeks
**No hard dependencies**

### 2.5 Projectile / Project Awareness
**Emacs:** projectile

- Detect project root (git, `.tmax-project`, etc.)
- `SPC p f` — find file in project (fuzzy)
- `SPC p s` — search in project (ripgrep)
- `SPC p b` — switch project buffer
- Project-local configuration

**Estimated effort:** 1.5-2 weeks
**Depends on:** 2.4 (fuzzy completion UI), ripgrep CLI

### 2.6 Evil Commentary
**Emacs:** evil-commentary (`gcc`, `gc` + motion)

- `gcc` — toggle comment for current line
- `gc` + motion — toggle comment for motion target (e.g., `gciw`, `gcj`)
- Visual mode `gc` — toggle comment for selection
- Per-mode comment syntax (//, #, --, etc.)

**Estimated effort:** 3-5 days
**Depends on:** 1.5 (major modes carry comment syntax)

### 2.7 Evil Surround
**Emacs:** evil-surround (`cs" '`, `ds"`, `ysiw"`)

- `cs OLD NEW` — change surrounding delimiter
- `ds DELIM` — delete surrounding delimiter
- `ys MOTION DELIM` — add surrounding around motion
- Works with `(`, `{`, `[`, `"`, `'`, `` ` ``, `<tag>`

**Estimated effort:** 1 week
**No dependencies**

### 2.8 Evil Numbers
**Emacs:** evil-numbers (`C-c =`, `C-c -`)

- `C-a` / `SPC =` — increment number under cursor
- `C-x` / `SPC -` — decrement number under cursor
- With count: `5C-a` increments by 5

**Estimated effort:** 2-3 days
**No dependencies**

### 2.9 Olivetti / Distraction-Free Mode
**Emacs:** olivetti-mode

- Toggle centering text in viewport with configurable margin
- Hide line numbers and gutter
- Useful for writing prose or focusing on code

**Estimated effort:** 2-3 days
**Depends on:** 1.8 (gutter to hide)

### 2.10 Theme System
**Emacs:** doom-themes (doom-dracula)

- Define color themes as T-Lisp data structures
- Apply theme to syntax highlighting, status line, gutter, UI elements
- Ship with a dark theme inspired by doom-dracula
- `load-theme` T-Lisp function
- Theme file: `~/.config/tmax/themes/<name>.tlisp`

**Estimated effort:** 1-1.5 weeks
**Depends on:** 1.1 (syntax colors), 1.8 (gutter colors)

---

## Tier 3: Nice-to-have — Ecosystem features that enrich the experience

These make tmax competitive with Emacs for specific workflows. They can be built incrementally as T-Lisp packages once Tier 1 and 2 are solid.

### 3.1 Org-mode Equivalent
**Emacs:** org-mode, org-roam, org-journal, org-agenda, org-capture, org-babel

This is the single largest missing feature by scope. Break into sub-features:

**3.1a — Core Org syntax** (2-3 weeks)
- Headlines with `*`, `**`, etc.
- TODO keywords, priority cookies, tags
- Markup: bold, italic, code, verbatim, links
- Property drawers, logbook drawers
- Folding/cycling visibility (`TAB`, `S-TAB`)

**3.1b — Org Agenda** (1.5-2 weeks)
- Collect TODO items from agenda files
- Custom agenda views (like the GTD view in init.el)
- TODO state transitions with timestamps

**3.1c — Org Capture** (1 week)
- Capture templates with expansion (`%?`, `%U`, `%a`, `%i`)
- Capture from external sources (clipboard, protocol)
- Refile to any headline in agenda files

**3.1d — Org Roam / Notes** (2-3 weeks)
- Node-based note system with backlinks
- Daily notes (like org-roam-dailies)
- Node find, insert, random

**3.1e — Org Babel** (3-4 weeks)
- Code block execution (`#+begin_src ... `)
- Results insertion
- Language support: TypeScript, Python, shell, Lisp
- Session-based evaluation

**Total estimated effort:** 10-14 weeks
**Depends on:** Tier 1 complete, folding infrastructure

### 3.2 LSP Integration
**Emacs:** lsp-mode, lsp-ui

- LSP client communicating over stdio/socket
- Diagnostics (errors, warnings) in gutter and inline
- Go-to-definition, find-references
- Hover documentation
- Code actions / quick fixes
- Symbol search / workspace symbols
- Completion from language server (extends 2.4)

**Estimated effort:** 4-6 weeks
**Depends on:** 1.1 (diagnostics rendering), 2.4 (completion popup), 1.7 (go-to-definition may open splits)

### 3.3 Snippet System
**Emacs:** yasnippet, yasnippet-snippets

- Template expansion with tab stops and placeholders
- Snippet files in T-Lisp syntax
- Per-mode snippet directories
- Nested tab stops, mirror stops, transforms
- Built-in snippets for common languages

**Estimated effort:** 2-3 weeks
**Depends on:** 1.5 (per-mode snippet dirs)

### 3.4 Embark-style Context Actions
**Emacs:** embark, embark-consult

- Act on completion candidates based on type
- File candidates: open, delete, rename, copy
- Buffer candidates: switch, kill, save
- Function candidates: describe, execute, view source
- Action menu via which-key popup

**Estimated effort:** 2 weeks
**Depends on:** 2.4 (completion system), which-key (already done)

### 3.5 Avy-style Jump
**Emacs:** avy (`SPC /`, `SPC '`)

- Jump to any visible character on screen with 2-3 keystrokes
- `SPC /` — avy-goto-char-timer (type chars, see matches, jump)
- Works across all visible windows

**Estimated effort:** 1 week
**Depends on:** 1.7 (multi-window for cross-window jumps)

### 3.6 Built-in Terminal
**Emacs:** vterm, eat

- Terminal pane using PTY
- Toggle with a keybinding (e.g., `SPC t`)
- Runs in a split window
- Copy from terminal to editor

**Estimated effort:** 2-3 weeks
**Depends on:** 1.7 (window splitting)

### 3.7 Magit (Full Git Status)
**Emacs:** magit

Full git status buffer with:
- Stage/unstage files and hunks
- Commit with message editing
- Branch management
- Diff viewing
- Log browsing
- Interactive rebase

**Estimated effort:** 4-6 weeks (large feature)
**Depends on:** 2.1 (git-gutter foundation), 1.7 (splits for diff view)

### 3.8 Session Persistence
**Emacs:** desktop-save-mode

- Save open buffers, cursor positions, window layout on exit
- Restore session on daemon start
- Configurable: `desktop-save-mode` T-Lisp toggle

**Estimated effort:** 1-1.5 weeks
**No hard dependencies**

### 3.9 Outshine / Outline Minor Mode
**Emacs:** outshine, outorg

- Code folding by comment-delimited sections (e.g., `// * Section`)
- Navigate by outline headings
- Edit section in isolation (narrowing)

**Estimated effort:** 1-2 weeks
**Depends on:** folding infrastructure (shared with 3.1a)

### 3.10 Fountain Mode
**Emacs:** fountain-mode

Screenplay formatting with auto-completion for scene headings, character names, and transitions.

**Estimated effort:** 2 weeks
**Depends on:** 1.5 (major mode system)

---

## Tier 4: Out of scope for tmax core

These exist in the Emacs config but are applications *built inside* Emacs rather than editor features. tmax should not implement these — they belong in external tools or future T-Lisp plugins.

| Feature | Emacs Package | Recommendation |
|---|---|---|
| Email client | mu4e, smtpmail | Use external email client |
| Web browser | EWW | Use external browser |
| RSS reader | elfeed | Use external reader |
| AI assistant | gptel, claude-code.el | Integrate via daemon JSON-RPC |
| Password store | pass, auth-source | Use external tool |
| HTTP client | restclient | Use curl/httpie |
| LaTeX export | ox-beamer | Use pandoc |
| Hyperbole | hyperbole | Evaluate for T-Lisp plugin later |
| Atomic Chrome | atomic-chrome | Not applicable (no browser extension) |
| Elfeed | elfeed | Use external RSS reader |

---

## Recommended Implementation Order

```
Phase A (6-8 weeks) — Tier 1 essentials:
  1.8  Relative line numbers          (3-5 days)
  1.1  Syntax highlighting            (2-3 weeks)
  1.2  Incremental search highlighting (1 week)
  1.3  Query-replace                  (1 week)
  1.5  Major modes                    (1.5 weeks)
  1.4  Auto-indentation               (1.5 weeks)
  1.6  Dired                          (1.5 weeks)
  1.7  Window splitting               (2-3 weeks)

Phase B (8-12 weeks) — Tier 2 quality-of-life:
  2.10 Theme system                   (1-1.5 weeks)
  2.6  Evil commentary                (3-5 days)
  2.7  Evil surround                  (1 week)
  2.8  Evil numbers                   (2-3 days)
  2.3  Structural editing             (1-2 weeks)
  2.1  Git gutter                     (1-2 weeks)
  2.2  Undo tree                      (2-3 weeks)
  2.4  In-buffer completion           (2 weeks)
  2.5  Projectile / project awareness (1.5-2 weeks)
  2.9  Olivetti mode                  (2-3 days)

Phase C (ongoing) — Tier 3 ecosystem:
  3.1  Org-mode (incremental)
  3.2  LSP integration
  3.3  Snippet system
  3.5  Avy jump
  3.8  Session persistence
  ... (build as T-Lisp packages)
```

## Design Principles

1. **T-Lisp surface, TypeScript substrate.** Every user-visible command is a T-Lisp function composed from fine-grained TypeScript primitives. The test: "would an Emacs user want to advise/override this?" If yes, T-Lisp-callable.

2. **Zero external dependencies.** All syntax highlighting is regex-based. No tree-sitter, no external parsers. Future tree-sitter integration replaces the tokenizer module without changing downstream consumers.

3. **Performance by default.** Syntax tokenization processes only visible viewport. Cache tokenized lines and invalidate on edit. Search/replace highlighting limited to visible range.

4. **Incremental delivery.** Each Tier 1 item is independently shippable. No big-bang release — each feature lands and is usable immediately.

5. **SPEC-035 alignment.** Tier 1 features align with SPEC-035 (Daily Driver Essentials). Where this RFC and SPEC-035 overlap, SPEC-035's step-by-step task breakdown governs implementation.

## Success Metrics

**After Phase A:** A developer can open a TypeScript project, navigate with hjkl, see syntax colors, search with real-time highlighting, find/replace across the buffer, have correct auto-indent, switch between files via dired, and work in split windows. This is a viable daily editor.

**After Phase B:** The editing experience matches or exceeds Emacs+evil for core code editing workflows. Git integration, structural editing, completion, and themes make it comfortable for extended use.

**After Phase C (ongoing):** Org-mode, LSP, and the T-Lisp plugin ecosystem make tmax competitive with Emacs for the author's full workflow.

## Open Questions

1. **Window splitting architecture:** The current rendering pipeline assumes a single viewport. Splitting requires a significant rewrite. Should we prototype with a fixed 2-split first, or design for N-splits from the start?

2. **Org-mode scope:** Should tmax implement its own org-like format (`.torg`?) or aim for Emacs org-file compatibility? Compatibility is more useful but constrains design.

3. **LSP: stdio or socket?** Stdio is simpler (single language server per filetype). Socket enables multi-server architectures. Recommendation: start with stdio, add socket later.

4. **Syntax highlighting: regex vs tree-sitter?** Regex is zero-dependency and ships fast. Tree-sitter is more accurate but requires C bindings and per-language WASM grammars. Recommendation: regex now, tree-sitter as a future swap-in.
