# tmax Development Roadmap

This document outlines the development roadmap for tmax, an extensible terminal-based text editor with T-Lisp scripting capabilities.

## 🎯 Primary Goal: Emacs with Evil-Mode Parity

The immediate priority is achieving **basic Emacs with Evil-mode** functionality. This means:

1. **T-Lisp Core**: All functionality implemented as T-Lisp functions
2. **Evil-Mode Editing**: Vim-style modal editing in normal mode
3. **Emacs Integration**: Key Emacs features (kill ring, minibuffer, help) accessible via M-x
4. **Hybrid Model**: Vim motions where they overlap, Emacs features where they're unique

**What "Basic Emacs with Evil-mode Parity" means:**

### Evil-Mode Features (Normal Mode)
- ✅ Modal editing (normal, insert, visual, command modes) - **COMPLETE**
- ✅ File operations (open, save, create) - **COMPLETE**
- ✅ Multiple buffers - **COMPLETE**
- ❌ **Core operators** (delete, yank, change, put) - **PHASE 1.2**
- ❌ **Navigation** (word, line, paragraph) - **PHASE 1.1**
- ❌ **Counts** (3j, 5dd) - **PHASE 1.3**
- ❌ **Search** (/, ?, n, N) - **PHASE 1.5**
- ❌ **Jumps** (gg, G) - **PHASE 1.6**
- ❌ **Undo** (u, C-r) - **PHASE 1.2**

### Emacs Features (All Modes via M-x)
- ✅ T-Lisp interpreter (like Emacs Lisp) - **COMPLETE**
- ✅ M-x command system - **COMPLETE**
- ❌ **Kill Ring** (clipboard history) - **PHASE 1.9**
- ❌ **Minibuffer** (completion, history) - **PHASE 1.10**
- ❌ **Help System** (describe-key, apropos) - **PHASE 1.11**
- ❌ **Emacs Window Commands** (C-x 2, C-x 3) - **PHASE 1.12**

### Architecture Principle
**All implemented in T-Lisp, callable via M-x, keybindings are just shortcuts.**

Example:
```lisp
;; User presses 'd' in normal mode
→ T-Lisp keymap lookup
→ Execute (evil-delete-operator)
→ Function is also callable via M-x evil-delete-operator

;; User presses 'SPC f' (leader key sequence)
→ T-Lisp keymap lookup for SPC
→ T-Lisp keymap lookup for f in *leader-keymap*
→ Execute (find-file)
→ Function is also callable via M-x find-file
```

**Leader Key System (Spacemacs/Doom-style):**
- `SPC` is the primary leader key (configurable)
- Hierarchical keybinding organization (SPC f, SPC b, SPC w, etc.)
- Which-key shows available bindings after each prefix
- All leader key bindings are just T-Lisp keymap entries
- Users can define their own hierarchical keymaps in T-Lisp

**Estimated timeline to basic parity**: 5-6 weeks (Phase 1.1 - 1.13)

### Emacs Features NOT Included

To avoid confusion, here are Emacs features we're **not** implementing:

| Feature | Reason | Alternative |
|---------|--------|-------------|
| **Emacs Navigation** (C-n, C-p, C-f, C-b, C-a, C-e) | Use Vim motions instead | `j`, `k`, `l`, `h`, `0`, `$` |
| **Emacs Word Navigation** (M-f, M-b) | Use Vim motions | `w`, `b` |
| **Mark/Region** (C-SPC, C-x C-x) | Evil visual mode covers this | `v`, `V` |
| **Emacs Buffer Menu** (C-x C-b) | Use command-mode or M-x | `:ls`, `M-x buffer-list` |
| **Recursive Editing** (C-r in minibuffer) | Complexity vs benefit | Use separate minibuffer sessions |
| **Narrowing/Widening** | Can be added later as plugin | User-extensible via T-Lisp |
| **Abbrev Mode** | Can be added later as plugin | User-extensible via T-Lisp |
| **Fill/Paragraph Fill** | Can be added later as plugin | User-extensible via T-Lisp |

**Philosophy**: Keep core minimal, advanced features as T-Lisp plugins/extensions.

### Phase 1 Overview: Evil + Emacs Integration

| Phase | Feature | Type | Priority |
|-------|---------|------|----------|
| 1.1 | Enhanced Navigation (w, b, e, 0, $) | Evil | CRITICAL |
| 1.2 | Basic Operators (dd, dw, yy, p, u) | Evil | CRITICAL |
| 1.3 | Counts (3j, 5dd) | Evil | HIGH |
| 1.4 | Change Operator (cw, cc) | Evil | HIGH |
| 1.5 | Search (/, ?, n, N) | Evil | HIGH |
| 1.6 | Jump Commands (gg, G) | Evil | HIGH |
| 1.7 | Visual Selection | Evil | MEDIUM |
| 1.8 | Basic Text Objects (iw, aw) | Evil | MEDIUM |
| 1.9 | Kill Ring System | Emacs | HIGH |
| 1.10 | Minibuffer + Which-key + Fuzzy Match | Emacs | HIGH |
| 1.11 | Help System | Emacs | MEDIUM |
| 1.12 | Emacs Window Commands | Emacs | LOW |
| 1.13 | Fuzzy Search Commands | Navigation | MEDIUM |

**All implemented as T-Lisp functions, all callable via M-x.**

## Current Status: v0.1.0 - Initial Alpha Release ✅

**Status**: Complete and Functional

This version provides a solid foundation for future development with comprehensive core functionality.

### Completed Features
- ✅ **Core Editor**: A T-Lisp-based terminal editor with vim-style key bindings (hjkl navigation)
- ✅ **T-Lisp Extensibility**: A complete T-Lisp interpreter with tail-call optimization and macro system for unlimited customization
- ✅ **Modal Editing**: Five editing modes: normal, insert, visual, command, and M-x
- ✅ **File Operations**: Open, save, and create files through a command interface
- ✅ **Multiple Buffers**: Efficient buffer management with gap buffer implementation
- ✅ **Zero Dependencies**: A self-contained application for security and simplicity
- ✅ **Key Bindings**: Configurable key bindings through T-Lisp API
- ✅ **Configuration**: .tmaxrc file support for user customization
- ✅ **Testing**: 131+ tests across 8 comprehensive test suites
- ✅ **Functional Programming Guidelines**: Comprehensive guide to functional programming patterns used in the project
- ✅ **Bun Runtime**: Complete migration from Deno to Bun for improved performance

### Test Coverage
- Unit tests: tokenizer, parser, evaluator, editor API
- Integration tests: file operations, buffer management
- UI tests: tmux-based test harness (15 assertions, 93.3% pass rate)

---

## Immediate Priority: Key Binding System Refactor

### Phase 0.4: T-Lisp-Centric Key Binding System [1/4 Complete]

**Objective**: Complete migration from TypeScript-centric to T-Lisp-centric key binding system.

#### 0.4.1 - Implement T-Lisp Keymaps [0/2]
- [ ] Add `hash-map` or `association-list` data type to T-Lisp standard library
- [ ] Define keymap variables for each mode (`*normal-mode-keymap*`, `*insert-mode-keymap*`, etc.)
- [ ] Implement keymap lookup and manipulation functions

#### 0.4.2 - Create Core Bindings File [1/2]
- [x] Default bindings using T-Lisp syntax
- [ ] Create `src/tlisp/core-bindings.tlisp` file
- [ ] Remove `initializeDefaultKeyMappings()` from editor.ts
- [ ] Load core-bindings.tlisp at editor startup

#### 0.4.3 - Refactor TypeScript Key Handler [1/3]
- [x] TypeScript executes T-Lisp commands
- [ ] Remove TypeScript `keyMappings` Map from editor.ts
- [ ] Update `handleKey()` to query T-Lisp environment for command lookup
- [ ] Implement graceful fallback for unbound keys

#### 0.4.4 - Re-implement (key-bind) in T-Lisp [0/2]
- [ ] Remove built-in `(key-bind)` function from TypeScript API
- [ ] Implement `(key-bind)` as pure T-Lisp function in stdlib
- [ ] Add helper functions: `(get-binding)`, `(remove-binding)`, `(list-bindings)`
- [ ] Update tests for T-Lisp key-bind implementation

**Testing Requirements**:
- Unit tests for hash-map/association-list operations
- Integration tests for key binding lookup and execution
- End-to-end tests for complete key binding workflow
- Tests for core-bindings.tlisp loading and error handling

### Phase 0.5: Configuration System Enhancement

- [ ] Support for `init.tlisp` configuration file (replacing `.tmaxrc`)
- [ ] Update all documentation to reference `init.tlisp`
- [ ] Maintain backward compatibility with `.tmaxrc` during transition
- [ ] Add configuration validation and error reporting

---

## Phase 1: Core Editing (v0.2.0)

**Focus**: Implement fundamental editing commands to reach basic "Emacs with Evil-mode" parity.

**Approach**: Hybrid model - Evil-mode in normal mode, Emacs-style bindings in insert/command modes.

### 1.1 - Enhanced Navigation
Priority: CRITICAL | Impact: Non-negotiable for daily use

- [ ] Word navigation: `w` (forward), `b` (backward), `e` (end of word)
- [ ] Line navigation: `0` (start), `$` (end), `^` (first non-blank)
- [ ] Paragraph navigation: `{` (previous), `}` (next)
- [ ] Screen navigation: `H` (top), `M` (middle), `L` (bottom)
- [ ] Tests for all navigation commands

**Rationale**: Without word and line navigation, you can't efficiently edit code or text.

### 1.2 - Basic Operators
Priority: CRITICAL | Impact: Core editing capability

- [ ] Delete operator: `dd` (line), `dw` (word), `x` (character), `D` (to end of line)
- [ ] Yank (copy) operator: `yy` (line), `yw` (word)
- [ ] Put (paste): `p` (after cursor), `P` (before cursor)
- [ ] Undo: `u` (undo), `C-r` (redo)
- [ ] Operator framework: Parse `operator + count + motion` sequences
- [ ] Tests for operator combinations

**Rationale**: These are the absolute minimum for text manipulation. Without these, tmax is just a viewer, not an editor.

### 1.3 - Counts & Multipliers
Priority: HIGH | Impact: Vim's compositional power

- [ ] Parse count prefix: `3j`, `5dd`, `2w`
- [ ] Apply count to motions: `10j` (down 10 lines)
- [ ] Apply count to operators: `3dd` (delete 3 lines), `5x` (delete 5 chars)
- [ ] Default count of 1 when omitted
- [ ] Tests for count combinations

**Rationale**: Counts are what makes Vim efficient. Without them, every operation is tedious.

### 1.4 - Change Operator
Priority: HIGH | Impact: Distinguish delete vs change workflow

- [ ] Change operator: `cw` (change word), `cc` (change line), `C` (to end of line)
- [ ] Change deletes and enters insert mode
- [ ] Change with text objects: `ci"`, `ca{`
- [ ] Tests for change operations

**Rationale**: The distinction between delete (d) and change (c) is core to Vim workflow.

### 1.5 - Search Functionality
Priority: HIGH | Impact: Essential for code navigation

- [ ] `/pattern` - Forward search
- [ ] `?pattern` - Backward search
- [ ] `n` - Next search result
- [ ] `N` - Previous search result
- [ ] `*` - Search word under cursor (forward)
- [ ] `#` - Search word under cursor (backward)
- [ ] Highlight search matches
- [ ] Incremental search with real-time feedback
- [ ] Search history navigation
- [ ] Tests for search operations

**Rationale**: Can't efficiently navigate codebases without search.

### 1.6 - Jump Commands
Priority: HIGH | Impact: Quick file navigation

- [ ] `gg` - Jump to first line of buffer
- [ ] `G` - Jump to last line of buffer
- [ ] `:line_number` - Jump to specific line
- [ ] `C-u` + `j/k` - Jump by screen lines
- [ ] Line number display in gutter (optional)
- [ ] Tests for jump command accuracy

**Rationale**: Essential for quickly moving through files.

### 1.7 - Visual Selection Operations
Priority: MEDIUM | Impact: Improved text manipulation

- [ ] Characterwise visual mode (v) + operations (d, y, c)
- [ ] Linewise visual mode (V) + operations (d, y, c)
- [ ] Blockwise visual mode (C-v) + operations
- [ ] Visual selection indicators
- [ ] Visual text operations (delete, yank, change, indent)
- [ ] Tests for visual mode operations

**Rationale**: Visual mode is important but you can work around it with operators + motions.

### 1.8 - Basic Text Objects
Priority: MEDIUM | Impact: Faster editing workflows

- [ ] Inner word: `iw` (inside word)
- [ ] Outer word: `aw` (including space)
- [ ] Inner sentence: `is`
- [ ] Outer sentence: `as`
- [ ] Tests for basic text objects

**Rationale**: Text objects are powerful but advanced. Can start with basic ones.

### 1.9 - Kill Ring System (Emacs Integration)
Priority: HIGH | Impact: Enhanced clipboard with history

- [ ] Kill ring data structure in T-Lisp (stack with max size)
- [ ] `(kill-ring-add text)` - Add text to kill ring
- [ ] `(kill-ring-latest)` - Get most recent kill
- [ ] `(kill-ring-previous)` - Get previous kill (for yank-pop)
- [ ] `(kill-region start end)` - Cut region to kill ring
- [ ] `(copy-region-as-kill start end)` - Copy region to kill ring
- [ ] `(yank)` - Insert latest kill at cursor
- [ ] `(yank-pop)` - Replace last yank with previous kill
- [ ] Integration: Evil's delete/yank operations also use kill ring
- [ ] Kill ring persistence across sessions
- [ ] Keybindings: `C-w`, `M-w`, `C-y`, `M-y`
- [ ] Tests for kill ring operations

**Rationale**: Kill ring is Emacs' signature feature. More sophisticated than simple clipboard - provides history and cycling. Complements Evil-mode perfectly.

**Implementation Note**: All implemented as T-Lisp functions, callable via M-x, keybindings are just shortcuts to these functions.

### 1.10 - Minibuffer Framework with Which-key and Fuzzy Matching
Priority: HIGH | Impact: Enhanced command experience (Spacemacs/Doom-style)

#### Core Minibuffer
- [ ] Minibuffer UI component (separate input area at bottom)
- [ ] `(minibuffer-read prompt)` - Basic input reading
- [ ] `(minibuffer-read-command prompt)` - With command completion
- [ ] `(minibuffer-read-file prompt)` - With file path completion
- [ ] Command history tracking (up/down arrow)
- [ ] `C-g` - Abort/minibuffer cancel mechanism
- [ ] Integration: M-x mode uses minibuffer
- [ ] Integration: Command mode (`:`) uses minibuffer

#### Fuzzy Matching (Spacemacs/Doom-style)
- [ ] Fuzzy matching algorithm for command completion
  - Type "sw" → matches "save-window", "switch-window", "swap-windows"
  - Type "buf" → matches "buffer-list", "switch-to-buffer", "kill-buffer"
  - Type "ff" → matches "find-file"
- [ ] Scoring system for fuzzy matches (prefix matches score higher)
- [ ] Frequency-based ranking (recent/frequent commands appear first)
- [ ] Fuzzy matching for file paths (fuzzy-find-file)
- [ ] Fuzzy matching for buffer names
- [ ] Tab completion as fallback (exact prefix match)
- [ ] `C-s`/`C-r` for incremental search in completion list
- [ ] Tests for fuzzy matching

#### Which-key System
- [ ] `(which-key-show prefix-key)` - Show available bindings after prefix
- [ ] Popup menu displays after 0.5s delay (configurable)
- [ ] Hierarchical menu display:
  ```
  SPC → Shows:
    ;  M-x execute-extended-command
    f  File operations
    b  Buffer operations
    w  Window operations
    h  Help
  ```
- [ ] Nested which-key for submenus:
  ```
  SPC f → Shows:
    f  find-file
    s  save-file
    R  recent-files
  ```
- [ ] Integration with all keymaps (normal, insert, global, etc.)
- [ ] Keybinding hints in status line
- [ ] Tests for which-key system

#### Command Documentation Preview
- [ ] Show function docstring in minibuffer completion
- [ ] Display keybinding next to command name:
  ```
  M-x kill-region
    Kill region between point and mark
    Binding: C-w
  ```
- [ ] Preview first line of docstring in which-key
- [ ] Full doc available via `C-h f` (describe-function)

#### Enhanced M-x Experience
- [ ] `(execute-extended-command)` - Read and execute command
- [ ] M-x binding: `SPC ;` (simple, single binding)
- [ ] Context-aware command suggestions
- [ ] Command categories/groupings in completion
- [ ] Hide internal/undocumented commands (optional)
- [ ] Custom command groups (e.g., user-defined vs built-in)

#### Hierarchical Keybinding System (Leader Key)
- [ ] Define leader key hierarchy in T-Lisp:
  ```lisp
  ;; Leader key definition
  (define-key *global-keymap* "SPC" *leader-keymap*)

  ;; M-x is the primary entry point
  (define-key *leader-keymap* ";" 'execute-extended-command)

  ;; File operations submenu
  (define-key *leader-keymap* "f" *file-keymap*)
  (define-key *file-keymap* "f" 'find-file)
  (define-key *file-keymap* "s" 'save-file)

  ;; Buffer operations submenu
  (define-key *leader-keymap* "b" *buffer-keymap*)
  (define-key *buffer-keymap* "b" 'switch-to-buffer)
  (define-key *buffer-keymap* "k" 'kill-buffer)
  ```
- [ ] Leader key for each mode (normal mode uses SPC, others can differ)
- [ ] Customizable leader key (user can change from SPC in config)
- [ ] Nested keymaps support (arbitrary depth)
- [ ] Keymap conflict detection and resolution

#### Tests
- [ ] Minibuffer input/output tests
- [ ] Fuzzy matching algorithm tests (edge cases, scoring)
- [ ] Which-key popup tests (timing, display)
- [ ] Command history tests (persistence, ranking)
- [ ] Integration tests (M-x → which-key → fuzzy match)

**Rationale**: Spacemacs and Doom Emacs show that which-key + fuzzy matching are essential for the Emacs experience. M-x without these feels primitive. Which-key provides discoverability, fuzzy matching provides efficiency.

**Implementation Note**: All implemented in T-Lisp. Minibuffer is a T-Lisp UI component. Which-key and fuzzy matching are pure T-Lisp functions. Keybindings are T-Lisp data structures.

### 1.11 - Help System
Priority: MEDIUM | Impact: Discoverability for T-Lisp extensibility

- [ ] Function documentation storage in T-Lisp (docstrings)
- [ ] `(describe-key key)` - Show function bound to key
- [ ] `(describe-function name)` - Show function documentation
- [ ] `(describe-variable name)` - Show variable documentation
- [ ] `(apropos-command pattern)` - Search commands by regex
- [ ] `(apropos-function pattern)` - Search all functions
- [ ] Help buffer display system
- [ ] Keybindings: `C-h k`, `C-h f`, `C-h v`, `C-h a`
- [ ] Integration: Show docstrings in M-x completion
- [ ] Tests for help system

**Rationale**: Help system is crucial for discoverability in an extensible editor. Makes T-Lisp API accessible to users.

**Implementation Note**: All help functions are T-Lisp, documentation stored in function definitions.

### 1.12 - Emacs Window Commands
Priority: LOW | Impact: Alternative keybindings to window features

- [ ] `(split-window-below)` - Split window horizontally (create new pane below)
- [ ] `(split-window-right)` - Split window vertically (create new pane right)
- [ ] `(delete-window)` - Close current window
- [ ] `(delete-other-windows)` - Close all other windows (make current fullscreen)
- [ ] `(other-window n)` - Switch focus to next window (n=1 for next, n=-1 for prev)
- [ ] Keybindings: `C-x 2`, `C-x 3`, `C-x 0`, `C-x 1`, `C-x o`
- [ ] Share infrastructure with Vim split commands (`:split`, `:vsplit`)
- [ ] Tests for Emacs window commands

**Rationale**: Provides Emacs-style keybindings for window management. Same underlying feature as Vim splits, just different interface.

**Implementation Note**: These are T-Lisp wrapper functions that call the same window-management primitives as Vim splits.

### 1.13 - Fuzzy Search Commands (Document Navigation)
Priority: MEDIUM | Impact: Efficient document navigation

- [ ] `(fuzzy-search-line pattern)` - Fuzzy search lines in current buffer
- [ ] `(fuzzy-switch-buffer)` - Fuzzy search and switch buffers
- [ ] `(fuzzy-find-file)` - Fuzzy search for files
- [ ] `(fuzzy-goto-line)` - Jump to line with preview
- [ ] All commands use same fuzzy matching engine from minibuffer
- [ ] Integration with which-key (show available actions on match)
- [ ] Integration with minibuffer history
- [ ] Preview: show line/context before selecting
- [ ] Keybindings:
  - `SPC l` - Search lines in buffer
  - `SPC b b` - Switch buffer (fuzzy version of :b)
  - `SPC f f` - Find file (fuzzy version)
  - `SPC j` - Jump to line
- [ ] Tests for fuzzy search operations

**Rationale**: Fuzzy search makes large documents and projects navigable. Instead of exact matches, type fragments and see all matching lines/buffers/files. This is how modern editors (VS Code, Spacemacs) handle navigation.

**Example usage:**
```
SPC l (fuzzy-search-line)
Type: "init"
↓
Shows all lines matching "init":
  (defun init ()              10:23  Buffer: main.ts
  (setq init-var)            15:4   Buffer: main.ts
  (init-config)              42:10  Buffer: config.tlisp

Select → jumps to that line (with preview)
```

**Implementation Note**: All implemented in T-Lisp using the fuzzy matching engine from Phase 1.10. These are T-Lisp functions callable via M-x.

---

## Future Enhancements (Post-Phase 1)

The following features enhance the editing experience but are not required for basic "Emacs with Evil-mode" parity. These can be implemented as user needs emerge or as the T-Lisp ecosystem matures.

### Context Actions (Embark-style)
Priority: LOW | Impact: Power user feature

Allow actions on completion candidates based on their type.

- [ ] `(embark-act)` - Show actions for selected candidate
- [ ] Context-aware actions based on candidate type:
  - Files: open, delete, rename, copy, chmod
  - Buffers: switch, kill, save, rename
  - Functions: describe, execute, view source
  - Variables: describe, set, customize
- [ ] Works from: minibuffer completion, buffers, file lists
- [ ] Action menu via which-key
- [ ] Custom action definitions in T-Lisp
- [ ] Keybinding: `C-h e` or `SPC e` after selection
- [ ] Tests

**Example:**
```
SPC b (fuzzy-switch-buffer)
Select: main.ts
Press: SPC e (embark-act)
Shows actions:
  s  Switch to buffer
  k  Kill buffer
  w  Save buffer
  r  Rename buffer
```

**Rationale**: Embark provides context-aware actions everywhere. Powerful but advanced. Can be added after core editing is solid.

**Implementation Note**: Pure T-Lisp system. Type-based action dispatch. Users can define custom actions in their config.

### In-Buffer Completion (Corfu-style)
Priority: LOW | Impact: LSP prerequisite

Auto-completion popup while typing (similar to VS Code/IntelliJ).

- [ ] Completion-at-point (CAP) framework
- [ ] `(completion-start)` - Start completion manually
- [ ] Auto-trigger after delay (configurable)
- [ ] Completion popup UI component
- [ ] Completion sources:
  - Buffer words (dabbrev-style)
  - File names
  - Buffer names
  - T-Lisp functions
- [ ] Cycle through candidates with Tab/Shift-Tab
- [ ] Preview documentation in popup
- [ ] Keybinding: `C-SPC` or `Tab` (configurable)
- [ ] Tests

**Rationale**: In-buffer completion is essential for LSP integration (Phase 3). Can implement basic version now, extend for LSP later.

**Implementation Note**: T-Lisp completion sources. UI component in TypeScript. Hooks for LSP completion in Phase 3.

### Advanced Navigation
Priority: LOW | Impact: Power user features

- [ ] `imenu` - Jump to function/section definitions
- [ ] `tags` - Navigate using ctags/etags
- [ ] `bookmark` - Persistent file positions
- [ ] `registers` - Save positions, text, window configs
- [ ] `mark-ring` - Jump between saved positions
- [ ] `global-mark` - Marks across files

### Search Enhancement
Priority: LOW | Impact: Multi-file search

- [ ] `ripgrep integration` - Fast text search with ripgrep
- [ ] `grep-find` - Traditional grep/find
- [ ] `project-search` - Search across project files
- [ ] `replace-in-files` - Multi-file search/replace
- [ ] `search-results-buffer` - Navigate search results

### Text Objects Library
Priority: LOW | Impact: More editing power

- [ ] Advanced text objects:
  - `ai`, `ii` - around/inside indentation
  - `a<`, `i<` - around/inside angle brackets
  - `at`, `it` - around/inside HTML tags
  - `af`, `if` - around/inside function
- [ ] Custom text object definitions in T-Lisp
- [ ] Text object composition (combine objects)

### Editing Enhancements
Priority: LOW | Impact: Convenience features

- [ ] `multiple-cursors` - Edit multiple locations simultaneously
- [ ] `sort-lines` - Sort selected lines
- [ ] `delete-duplicate-lines` - Remove duplicates
- [ ] `reverse-region` - Reverse selected lines
- [ ] `indent-rigidly` - Change indentation of region
- [ ] `format-code` - Format buffer/region

### Project Integration
Priority: LOW | Impact: Project-aware editing

- [ ] `project-find` - Find files in project
- [ ] `project-search` - Search in project files
- [ ] `project-switch` - Switch between projects
- [ ] `.project` file` - Project configuration
- [ ] `project-root` detection (git, mercurial, etc.)

### UI/UX Enhancements
Priority: LOW | Impact: Visual polish

- [ ] `mode-line` enhancements - Git branch, LSP status, time
- [ ] `tab-bar` - Visual tab bar for buffers
- [ ] `breadcrumb` - Show current location in header
- [ ] `line-numbers` - Toggleable line number display
- [ ] `color-themes` - Multiple color schemes
- [ ] `cursor-indicators` - Show multiple cursors visually

### Performance Optimizations
Priority: LOW | Impact: Large file handling

- [ ] `lazy-rendering` - Only render visible viewport
- [ ] `incremental-highlighting` - Syntax highlight on scroll
- [ ] `buffer-lazy-loading` - Load large files on demand
- [ ] `operation-coalescing` - Batch edits for performance

### Extensibility Features
Priority: LOW | Impact: Plugin ecosystem

- [ ] `package-manager` - Install/manage T-Lisp packages
- [ ] `lazy-loading` - Load packages on demand
- [ ] `package-hooks` - Load/save/activate hooks
- [ ] `package-config` - Per-package configuration
- [ ] `package-documentation` - Generate docs from packages

---

## Phase 1.5: Enhanced Editing Features (v0.2.1)

## Phase 1.5: Enhanced Editing Features (v0.2.1)

**Focus**: Advanced features that build on core editing foundation.

### 1.9 - Advanced Text Objects
Priority: MEDIUM | Impact: Power user features

- [ ] Paragraph objects: `cip`, `dip`, `yip`
- [ ] Block objects: `ci"`, `da'`, `ya{`, `ci(`
- [ ] Tag objects for XML/HTML: `cit`, `dat`, `yat`
- [ ] Indent objects: `ai`, `ii` (around/inside indentation)
- [ ] Tests for all text objects

### 1.10 - Visual Selection Enhancements
Priority: MEDIUM | Impact: Improved visual mode

- [ ] Visual text objects: `vi"`, `va'`, `vap`
- [ ] Visual indent operations
- [ ] Visual block append/g-insert

### 1.11 - Syntax Highlighting Framework
Priority: LOW | Impact: Improved code readability (can use external tools initially)

- [ ] Syntax highlighting engine architecture
- [ ] Token-based highlighting system
- [ ] Language definitions for common languages (JavaScript, TypeScript, Python, etc.)
- [ ] Color scheme system
- [ ] Performance optimization for large files
- [ ] User-defined syntax rules via T-Lisp

### 1.12 - Improved Buffer Management
Priority: MEDIUM | Impact: Better multi-file workflows

- [ ] Buffer list command (`:ls`)
- [ ] Buffer switching by number (`:b<number>`)
- [ ] Buffer deletion (`:bd`)
- [ ] Modified buffer indicators
- [ ] Auto-save functionality
- [ ] Buffer persistence across sessions

---

## Phase 2: Extensibility & Customization (v0.3.0)

**Focus**: Enhance T-Lisp capabilities and plugin ecosystem.

### 2.1 - Plugin System
Priority: HIGH | Impact: Unlimited extensibility

- [ ] Plugin directory structure (`~/.config/tmax/tlpa/`)
- [ ] Plugin loading and initialization system
- [ ] Plugin dependency management
- [ ] Plugin isolation and sandboxing
- [ ] Plugin lifecycle hooks (load, enable, disable, unload)
- [ ] Plugin API documentation

### 2.2 - Advanced T-Lisp Features
Priority: MEDIUM | Impact: More powerful customization

- [ ] Module system for T-Lisp
- [ ] Namespace support
- [ ] Advanced string manipulation functions
- [ ] Regular expression integration
- [ ] File system operations
- [ ] Process spawning capabilities
- [ ] HTTP request support (for plugin ecosystem)

### 2.3 - Key Binding System Completion
Priority: HIGH | Impact: Core extensibility feature

- [ ] Complete Phase 0.4 refactor (see Immediate Priority above)
- [ ] Key binding validation and conflict detection
- [ ] Key binding documentation and examples
- [ ] Mode-specific key binding override system

### 2.4 - Macro Recording & Playback
Priority: MEDIUM | Impact: Productivity enhancement

- [ ] `q{register}` - Start recording macro
- [ ] `q` - Stop recording macro
- [ ] `@{register}` - Play back macro
- [ ] `@@` - Repeat last macro
- [ ] Macro editing capabilities
- [ ] Macro persistence across sessions

### 2.5 - Configuration System
Priority: MEDIUM | Impact: Better user experience

- [ ] Configuration file validation
- [ ] Configuration error reporting with line numbers
- [ ] Configuration profiles (work, personal, etc.)
- [ ] Configuration file hot-reloading
- [ ] Example configurations for popular workflows

### 2.6 - Performance Optimizations
Priority: LOW | Impact: Better responsiveness

- [ ] Lazy rendering for large files
- [ ] Incremental syntax highlighting
- [ ] Optimized buffer operations
- [ ] Memory usage profiling and optimization

---

## Phase 3: Advanced Features (v0.4.0)

**Focus**: Professional-grade features for power users.

### 3.1 - LSP Integration
Priority: HIGH | Impact: Modern development experience

- [ ] LSP client architecture
- [ ] Language server initialization and management
- [ ] Diagnostics display (errors, warnings, hints)
- [ ] Code completion (autocomplete)
- [ ] Go to definition
- [ ] Find references
- [ ] Symbol search
- [ ] Code actions (quick fixes)
- [ ] Signature help
- [ ] Document symbols outline

### 3.2 - Multiple Windows/Panes
Priority: HIGH | Impact: Advanced multi-file editing

- [ ] Window splitting (horizontal, vertical)
- [ ] Window navigation and management
- [ ] Window resizing
- [ ] Multiple buffers per window
- [ ] Window layout persistence
- [ ] Tmux-like pane management

### 3.3 - File Tree Explorer
Priority: MEDIUM | Impact: Project navigation

- [ ] File tree sidebar
- [ ] File and directory operations
- [ ] File filtering and search
- [ ] Git integration indicators
- [ ] Toggleable file tree panel
- [ ] Project root detection

### 3.4 - Undo/Redo System
Priority: MEDIUM | Impact: Essential safety feature

- [ ] Undo tree implementation
- [ ] Persistent undo history
- [ ] Branching undo/redo
- [ ] Undo timeline visualization
- [ ] Undo persistence across sessions
- [ ] Configuration for undo limits

### 3.5 - Terminal Integration
Priority: LOW | Impact: Convenient workflow

- [ ] Built-in terminal panel
- [ ] Terminal pane management
- [ ] Terminal command execution from editor
- [ ] Quick terminal toggle

---

## Phase 4: Community & Ecosystem (v0.5.0)

**Focus**: Build sustainable community and plugin ecosystem.

### 4.1 - Community Infrastructure
Priority: MEDIUM | Impact: Growth and adoption

- [ ] Plugin repository and registry
- [ ] Plugin submission and review process
- [ ] Community contribution guidelines
- [ ] Plugin showcase and examples

### 4.2 - Documentation Portal
Priority: HIGH | Impact: Accessibility and onboarding

- [ ] Dedicated documentation website
- [ ] API reference for T-Lisp functions
- [ ] Plugin development tutorials
- [ ] Video tutorials and walkthroughs
- [ ] Interactive examples
- [ ] Community-contributed guides

### 4.3 - Testing & Quality Assurance
Priority: MEDIUM | Impact: Stability and reliability

- [ ] Increase test coverage to 90%+
- [ ] Automated UI testing across platforms
- [ ] Performance benchmarking suite
- [ ] Continuous integration improvements
- [ ] Automated release testing

### 4.4 - Distribution & Packaging
Priority: LOW | Impact: Accessibility

- [ ] Homebrew formula
- [ ] Arch Linux AUR package
- [ ] Debian/Ubuntu packages
- [ ] RPM packages for Fedora
- [ ] Windows installer
- [ ] Installation scripts

---

## Future Considerations

### Potential Features (Beyond v0.5.0)
- Collaborative editing (multi-user)
- Remote file editing (SSH, SFTP)
- Cloud synchronization
- AI integration (code completion, refactoring)
- Advanced vim script compatibility layer
- Emacs keybinding emulation mode
- GUI version (optional)
- Mobile version (experimental)

### Technical Debt & Maintenance
- Ongoing dependency updates
- Security audits and fixes
- Code quality improvements
- Documentation maintenance
- Community issue triage and support

---

## Development Philosophy

tmax follows the principle of **"powerful core, extensible surface"**:

1. **TypeScript Core**: Provides efficient, low-level operations (terminal I/O, file system, buffer management)
2. **T-Lisp Engine**: Handles all high-level functionality and customization
3. **Community-First**: Plugins and configurations shared as T-Lisp scripts
4. **Stability-First**: Comprehensive testing before feature releases
5. **Documentation-Driven**: Clear docs alongside code development

### Feature Selection Criteria

Features are prioritized based on:
- **User Impact**: How much does this improve daily editing workflows?
- **Extensibility**: Does this enable new possibilities through T-Lisp?
- **Maintainability**: Can we support this long-term without excessive complexity?
- **Test Coverage**: Can we adequately test this feature?
- **Community Demand**: Is there significant user interest or requests?

---

## Contributing

We welcome contributions! See the main README.md for contribution guidelines.

### How to Get Involved

1. **Pick a task**: Choose an item from this roadmap
2. **Open an issue**: Discuss the implementation approach
3. **Write tests**: Follow TDD workflow
4. **Submit PR**: Include tests and documentation
5. **Join discussion**: Engage with the community

### Areas Seeking Contributors

- T-Lisp standard library extensions
- Language syntax definitions
- Plugin development
- Documentation improvements
- Test coverage expansion
- Performance optimization
- Platform-specific packaging

---

## Release Schedule

**Note**: Dates are approximate and subject to change based on development progress.

- **v0.1.0** ✅ - Released (Current) - Core editor with T-Lisp engine
- **v0.2.0** - Q1 2025 (Core Editing) - Basic Evil-mode parity: operators, navigation, search, jumps
  - **v0.2.0-alpha** - Core operators and navigation (1.1, 1.2, 1.3)
  - **v0.2.0-beta** - Change operator, search, jumps (1.4, 1.5, 1.6)
  - **v0.2.0** - Visual mode and basic text objects (1.7, 1.8)
- **v0.2.1** - Q1 2025 (Enhanced Editing) - Advanced text objects, visual features
- **v0.3.0** - Q2 2025 (Extensibility) - Plugin system, advanced T-Lisp, macros
- **v0.4.0** - Q3 2025 (Advanced Features) - LSP integration, multiple windows
- **v0.5.0** - Q4 2025 (Community & Ecosystem) - Documentation, packaging, community

### Versioning Policy

tmax follows semantic versioning (SemVer):
- **Major version**: Incompatible API changes
- **Minor version**: New features, backward compatible
- **Patch version**: Bug fixes, backward compatible

Until v1.0.0, minor versions may include breaking changes as we refine the API.

---

## References

- **Main README**: `/README.md`
- **TODO List**: `/TODO.org`
- **Functional Patterns**: `/functional-patterns-guidelines.md`
- **Specs**: `/specs/` directory
- **Test Documentation**: `/test/README.md`

---

**Last Updated**: 2025-02-03

For the latest updates and discussions, visit the project repository.
