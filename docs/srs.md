# Software Requirements Specification (SRS)

**Product:** tmax — T-Lisp Powered Terminal Editor  
**Version:** 0.2.0  
**Date:** 2026-05-16  

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [Functional Requirements — User Stories](#3-functional-requirements)
   - [Phase 0: Infrastructure](#30-phase-0-infrastructure)
   - [Phase 1: Core Editing](#31-phase-1-core-editing)
   - [Phase 2: Extensibility](#32-phase-2-extensibility)
   - [Phase 3: Advanced Features](#33-phase-3-advanced-features)
   - [Phase 4: Community](#34-phase-4-community)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [Constraints](#5-constraints)

---

## 1. Introduction

tmax is a terminal-based text editor with an Emacs-style split-brain architecture: TypeScript handles low-level operations (terminal I/O, file system, buffer management) while T-Lisp (tmax Lisp) handles all editor logic including commands, modes, key bindings, and extensibility.

**Interchangeable Frontends:** Two rendering backends:
- **Steep** (default) — Elm Architecture with direct ANSI output, zero dependencies
- **Ink** (`--ink` flag) — React/Ink reconciler

**Target Users:** Developers, system administrators, and power users who prefer keyboard-driven terminal workflows with unlimited customization.

---

## 2. Overall Description

### System Architecture

```
User Input → Frontend (Steep or Ink)
  → Editor.handleKey(key) → EditorState
  → T-Lisp interpreter → editor API (25+ ops modules)
  → Frontend renders new state
```

### Editor Modes

Five modes: **normal**, **insert**, **visual**, **command**, **M-x**

### Key Components

| Component | Location | Responsibility |
|-----------|----------|---------------|
| T-Lisp Interpreter | `src/tlisp/` | Parse, evaluate, macro-expand |
| Editor Core | `src/editor/` | State machine, key dispatch, API registry |
| Editor API | `src/editor/api/` | 25+ operation modules (buffer, cursor, delete, yank, etc.) |
| Core | `src/core/` | Terminal I/O, filesystem, buffer (gap buffer) |
| Frontend | `src/frontend/` | Steep (direct ANSI) and Ink (React) renderers |
| Shared Render | `src/frontend/render/` | Pure render functions used by both frontends |

---

## 3. Functional Requirements

### Status Key
- ✅ Implemented
- 🚧 Partially implemented
- 📋 Planned

---

### 3.0 Phase 0: Infrastructure

#### US-0.4.1: T-Lisp Keymap Data Structures
**As a** power user  
**I want** key bindings stored as T-Lisp data structures  
**So that** I can inspect, modify, and understand the entire key binding system  

**Status:** ✅ Implemented (`src/editor/api/bindings-ops.ts`, `src/editor/api/keymap-ops.ts`, `src/editor/keymap-sync.ts`)

**Acceptance Criteria:**
- ✅ Given the T-Lisp environment is initialized, when I query `*normal-mode-keymap*`, then I should see a hash-map of key bindings
- ✅ Given a keymap hash-map exists, when I call `(get-binding "i" "normal")`, then I should receive the bound command as a T-Lisp function
- ✅ Given the keybinding system, when I inspect keymap inheritance, then I should see context → mode → global precedence

#### US-0.4.2: Core Bindings in T-Lisp Files
**As a** developer  
**I want** default key bindings defined in T-Lisp files  
**So that** I can understand and modify default behavior  

**Status:** 🚧 Partially implemented (bindings load from T-Lisp, some fallback to TypeScript)

**Acceptance Criteria:**
- ✅ Given a fresh tmax installation, when tmax starts, then it should load core T-Lisp bindings
- ✅ Given the core bindings file, when I read its contents, then I should see all default bindings in T-Lisp syntax
- 🚧 Given a modified core-bindings file, when I restart tmax, then my modifications should be active

#### US-0.4.3: Pure T-Lisp Key Bind Function
**As a** power user  
**I want** the `(key-bind)` function implemented in pure T-Lisp  
**So that** I can customize it or extend it  

**Status:** ✅ Implemented (`src/editor/api/bindings-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I evaluate `(key-bind "zz" "(center-cursor)" "normal")`, then pressing `zz` should execute my custom function
- ✅ Given a custom key binding, when I call `(remove-binding "zz" "normal")`, then the binding should be removed
- ✅ Given multiple key bindings, when I call `(list-bindings "normal")`, then I should see all active bindings for that mode

#### US-0.5.1: Core Testing Framework MVP
**As a** developer  
**I want** a basic T-Lisp testing framework  
**So that** I can write and run tests in T-Lisp itself  

**Status:** ✅ Implemented (`src/tlisp/test-registry.ts`, `src/tlisp/test-coverage.ts`)

**Acceptance Criteria:**
- ✅ Given the TRT framework is loaded, when I define a test with `(deftest test-name ...)`, then it should be registered and executable
- ✅ Given a TRT test, when I use `(should-equal expected actual)`, then it should pass if values are equal, fail otherwise
- ✅ Given the test runner CLI, when I run tests, then all test files should be discovered and executed
- ✅ Given test execution completes, when tests pass, then exit code should be 0
- ✅ Given test execution completes, when tests fail, then exit code should be 1
- ✅ Given test execution, when tests complete, then I should see summary: "Passed: X, Failed: Y, Total: Z"

#### US-0.5.2: Essential Assertions
**As a** developer  
**I want** basic assertion helpers  
**So that** I can validate test behavior  

**Status:** ✅ Implemented

**Acceptance Criteria:**
- ✅ Given a test with values, when I use `(should-equal expected actual)`, then it should pass if values are equal, fail with clear message otherwise
- ✅ Given a test with truthy value, when I use `(should-be-truthy value)`, then it should pass if value is truthy
- ✅ Given a test with falsy value, when I use `(should-be-falsy value)`, then it should pass if value is nil/false
- ✅ Given a test with error-throwing code, when I use `(should-throw ...)`, then it should pass if error is thrown

#### US-0.5.3: Basic Test Isolation
**As a** developer  
**I want** tests isolated from each other  
**So that** tests don't interfere  

**Status:** ✅ Implemented (`clearTestRegistry()`)

**Acceptance Criteria:**
- ✅ Given two tests that modify global state, when tests run sequentially, then second test should not see state from first test
- ✅ Given a test with setup hook, when I define before-test, then setup code should run before test executes
- ✅ Given a test with teardown hook, when I define after-test, then cleanup code should run after test completes

#### US-0.6.6: Basic Coverage
**As a** developer  
**I want** code coverage reporting  
**So that** I can measure test completeness  

**Status:** ✅ Implemented (`src/tlisp/test-coverage.ts`)

**Acceptance Criteria:**
- ✅ Given running tests with coverage, when I execute tests, then I should see line coverage percentage for each function
- ✅ Given coverage report, when tests complete, then I should see summary with total coverage percentage
- ✅ Given coverage thresholds, when coverage is below threshold, then build should report warning

---

### 3.1 Phase 1: Core Editing

#### US-1.1.1: Word Navigation
**As a** developer  
**I want** to navigate by words using `w`, `b`, `e`  
**So that** I can quickly move through code  

**Status:** ✅ Implemented (`src/editor/api/word-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode on any line, when I press `w`, then cursor should move to start of next word
- ✅ Given I'm in normal mode, when I press `b`, then cursor should move to start of previous word
- ✅ Given I'm in normal mode, when I press `e`, then cursor should move to end of current word
- ✅ Given I'm in normal mode, when I press `3w`, then cursor should move forward 3 words
- ✅ Given word navigation keys, when I reach the end of a line, then navigation should continue to next line

#### US-1.1.2: Line Navigation
**As a** developer  
**I want** to navigate to line start/end using `0`, `$`, `^`  
**So that** I can quickly position cursor on a line  

**Status:** ✅ Implemented (`src/editor/api/line-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `0`, then cursor should move to column 0
- ✅ Given I'm in normal mode, when I press `$`, then cursor should move to last character of line
- ✅ Given I'm in normal mode, when I press `^`, then cursor should move to first non-whitespace character

#### US-1.2.1: Delete Operator
**As a** developer  
**I want** to delete text using `d`, `dd`, `dw`, `x`  
**So that** I can remove unwanted text  

**Status:** ✅ Implemented (`src/editor/api/delete-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `dd`, then current line should be deleted
- ✅ Given I'm in normal mode, when I press `dw`, then word under cursor should be deleted
- ✅ Given I'm in normal mode, when I press `x`, then character under cursor should be deleted
- ✅ Given I'm in normal mode, when I press `3dd`, then 3 lines starting from current should be deleted
- ✅ Given deleted text, when I delete more text, then previous deletions should be stored in kill ring

#### US-1.2.2: Yank (Copy) Operator
**As a** developer  
**I want** to yank (copy) text using `yy`, `yw`  
**So that** I can duplicate text  

**Status:** ✅ Implemented (`src/editor/api/yank-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `yy`, then current line should be yanked to register
- ✅ Given I'm in normal mode, when I press `yw`, then word under cursor should be yanked
- ✅ Given yanked text, when I move cursor and press `p`, then yanked text should be pasted after cursor
- ✅ Given yanked text, when I press `P`, then yanked text should be pasted before cursor

#### US-1.2.3: Undo/Redo
**As a** developer  
**I want** to undo and redo changes using `u`, `C-r`  
**So that** I can correct mistakes  

**Status:** ✅ Implemented (`src/editor/api/undo-redo-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I've made text changes, when I press `u` in normal mode, then last change should be undone
- ✅ Given undone changes, when I press `C-r` in normal mode, then undone change should be redone
- ✅ Given multiple edits, when I press `5u`, then last 5 changes should be undone
- ✅ Given undo history, when I make new changes after undo, then redo history should be cleared

#### US-1.3.1: Count Prefix
**As a** developer  
**I want** to prefix commands with counts  
**So that** I can repeat operations efficiently  

**Status:** ✅ Implemented (`src/editor/api/count-ops.ts`, `src/editor/editor.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `3j`, then cursor should move down 3 lines
- ✅ Given I'm in normal mode, when I press `5dd`, then 5 lines should be deleted
- ✅ Given I'm in normal mode, when I press `10x`, then 10 characters should be deleted
- ✅ Given a count prefix, when I press a command without count, then command should execute once (default count of 1)

#### US-1.4.1: Change Operator
**As a** developer  
**I want** to change text using `c`, `cw`, `cc`, `C`  
**So that** I can delete and enter insert mode in one action  

**Status:** ✅ Implemented (`src/editor/api/change-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `cw`, then word under cursor should be deleted and insert mode entered
- ✅ Given I'm in normal mode, when I press `cc`, then entire line should be cleared and insert mode entered
- ✅ Given I'm in normal mode, when I press `C`, then from cursor to end of line should be deleted and insert mode entered
- ✅ Given change operator, when I complete typing and press Escape, then I should return to normal mode with changes applied

#### US-1.5.1: Search Forward/Backward
**As a** developer  
**I want** to search using `/pattern` and `?pattern`  
**So that** I can find text in my buffer  

**Status:** ✅ Implemented (`src/editor/api/search-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `/` and type a pattern, then cursor should jump to first match after current position
- ✅ Given I'm in normal mode, when I press `?` and type a pattern, then cursor should jump to first match before current position
- ✅ Given an active search, when I press `n`, then cursor should jump to next match
- ✅ Given an active search, when I press `N`, then cursor should jump to previous match
- 🚧 Given search results, when multiple matches exist, then they should be highlighted in the buffer

#### US-1.5.2: Word Under Cursor Search
**As a** developer  
**I want** to search for word under cursor using `*` and `#`  
**So that** I can quickly find other occurrences  

**Status:** ✅ Implemented (`src/editor/api/search-ops.ts`)

**Acceptance Criteria:**
- ✅ Given cursor is on a word in normal mode, when I press `*`, then search should start for that word forward
- ✅ Given cursor is on a word in normal mode, when I press `#`, then search should start for that word backward
- ✅ Given word search active, when I press `n` or `N`, then cursor should jump to next/previous occurrence

#### US-1.6.1: Jump Commands
**As a** developer  
**I want** to jump to specific lines using `gg`, `G`, `:line_number`  
**So that** I can quickly navigate large files  

**Status:** ✅ Implemented (`src/editor/api/jump-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `gg`, then cursor should jump to first line of buffer
- ✅ Given I'm in normal mode, when I press `G`, then cursor should jump to last line of buffer
- ✅ Given I'm in normal mode, when I press `:50` and Enter, then cursor should jump to line 50
- ✅ Given jump commands, when I jump to a line, then viewport should scroll to show that line

#### US-1.7.1: Visual Mode Selection
**As a** developer  
**I want** to select text in visual mode using `v`, `V`  
**So that** I can perform operations on selected regions  

**Status:** ✅ Implemented (`src/editor/api/visual-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `v`, then characterwise visual mode should start
- ✅ Given I'm in normal mode, when I press `V`, then linewise visual mode should start
- ✅ Given visual mode active, when I navigate with hjkl, then selection should expand from start position
- ✅ Given visual selection active, when I press `d`, then selected text should be deleted
- ✅ Given visual selection active, when I press `y`, then selected text should be yanked
- ✅ Given visual selection active, when I press `c`, then selected text should be deleted and insert mode entered

#### US-1.8.1: Basic Text Objects
**As a** developer  
**I want** to operate on text objects like `iw`, `aw`, `is`, `as`  
**So that** I can edit with semantic precision  

**Status:** ✅ Implemented (`src/editor/api/text-objects-ops.ts`, `src/editor/api/text-objects.ts`)

**Acceptance Criteria:**
- ✅ Given cursor is on a word in normal mode, when I press `diw`, then inner word (excluding surrounding space) should be deleted
- ✅ Given cursor is on a word in normal mode, when I press `daw`, then outer word (including trailing space) should be deleted
- ✅ Given cursor is in a sentence, when I press `dis`, then inner sentence should be deleted
- ✅ Given cursor is in a sentence, when I press `das`, then outer sentence (including trailing space) should be deleted
- ✅ Given text object commands, when I use `ciw` instead of `diw`, then text object should be deleted and insert mode entered

#### US-1.9.1: Kill Ring Storage
**As a** power user  
**I want** deleted and yanked text stored in a kill ring  
**So that** I can access recent kills  

**Status:** ✅ Implemented (`src/editor/api/kill-ring.ts`)

**Acceptance Criteria:**
- ✅ Given I delete or yank text, when the operation completes, then text should be added to kill ring
- ✅ Given kill ring with 10 items, when I kill new text, then oldest kill should be removed if ring is full
- ✅ Given kill ring state, when I query `(kill-ring-latest)`, then I should receive the most recent kill

#### US-1.9.2: Yank Pop
**As a** power user  
**I want** to cycle through kills using `M-y` after yanking  
**So that** I can access previous kills  

**Status:** ✅ Implemented (`src/editor/api/yank-pop-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I just yanked text, when I press `M-y`, then yanked text should be replaced with previous kill
- ✅ Given I'm cycling kills, when I press `M-y` multiple times, then I should cycle through older kills
- ✅ Given I cycle past oldest kill, when I press `M-y` again, then I should wrap around to newest kill

#### US-1.9.3: Evil Integration
**As a** user familiar with both Emacs and Vim  
**I want** Evil delete/yank operations to use kill ring  
**So that** both paradigms work together  

**Status:** ✅ Implemented (`src/editor/api/evil-integration.ts`)

**Acceptance Criteria:**
- ✅ Given I delete with `dd` or `dw`, when I check kill ring, then deleted text should be in kill ring
- ✅ Given I yank with `yy` or `yw`, when I check kill ring, then yanked text should be in kill ring
- ✅ Given Evil and Emacs operations mixed, when I kill then delete, then both should be accessible via kill ring

#### US-1.10.1: Minibuffer Input
**As a** user  
**I want** a dedicated minibuffer for command input  
**So that** I have a consistent interface for commands  

**Status:** ✅ Implemented (`src/editor/api/minibuffer-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I press `SPC ;` (M-x), when minibuffer appears, then it should show prompt "M-x:" at bottom of screen
- ✅ Given minibuffer is active, when I type a command name, then my input should appear in minibuffer
- ✅ Given minibuffer with input, when I press `C-g`, then minibuffer should close without executing
- ✅ Given minibuffer with input, when I press Enter, then command should execute and minibuffer close

#### US-1.10.2: Fuzzy Command Completion
**As a** power user  
**I want** fuzzy matching for command names  
**So that** I can quickly find commands without exact typing  

**Status:** 🚧 Partially implemented (command history exists, fuzzy matching planned)

**Acceptance Criteria:**
- 🚧 Given I'm in M-x mode, when I type "sw", then I should see commands matching "save-window", "switch-window"
- 🚧 Given fuzzy matches found, when multiple matches exist, then they should be ranked by prefix matches first
- 📋 Given completion list, when I press Tab, then first match should be selected
- 📋 Given selected completion, when I press Enter, then selected command should execute

#### US-1.10.3: Which-key Popup
**As a** user learning tmax  
**I want** to see available keybindings after pressing a prefix  
**So that** I can discover bindings without memorizing  

**Status:** ✅ Implemented (`src/editor/utils/which-key.ts`)

**Acceptance Criteria:**
- ✅ Given I press `SPC` (leader key), when I wait 0.5 seconds, then which-key popup should show available bindings
- ✅ Given which-key popup visible, when I see "f File operations", then I should understand `f` is a prefix key
- ✅ Given I press `SPC f`, when submenu popup appears, then I should see file operation bindings
- ✅ Given which-key popup, when I press any bound key, then popup should disappear and command execute
- ✅ Given which-key popup, when I press `C-g`, then popup should cancel and return to normal mode

#### US-1.10.4: Command Documentation Preview
**As a** user  
**I want** to see command documentation in completion  
**So that** I understand what commands do  

**Status:** ✅ Implemented (`src/editor/api/documentation.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in M-x mode, when I select a command in completion list, then its first docstring line should be visible
- ✅ Given command with documentation, when I view it in M-x completion, then I should see docstring
- ✅ Given command with keybinding, when I view it in M-x completion, then I should see "Binding: X" if it has one

#### US-1.11.1: Describe Key
**As a** user  
**I want** to see what function a key runs using `describe-key`  
**So that** I can understand keybindings  

**Status:** ✅ Implemented

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I execute M-x `describe-key` and press a key, then I should see the function bound to that key
- ✅ Given I describe `w` in normal mode, when help buffer appears, then I should see it runs the forward-word function
- ✅ Given describe-key output, when function has documentation, then I should see its docstring

#### US-1.11.2: Describe Function
**As a** user  
**I want** to see function documentation using `describe-function`  
**So that** I can learn what functions do  

**Status:** ✅ Implemented

**Acceptance Criteria:**
- ✅ Given I execute M-x `describe-function`, when I enter a function name, then I should see its full documentation
- ✅ Given function documentation, when I view it, then I should see signature, docstring, and keybindings

#### US-1.11.3: Apropos Command
**As a** power user  
**I want** to search commands by regex using `apropos-command`  
**So that** I can discover relevant commands  

**Status:** ✅ Implemented

**Acceptance Criteria:**
- ✅ Given I execute M-x `apropos-command`, when I enter "save", then I should see all commands with "save" in their name
- ✅ Given I enter "save.*buffer", then I should see commands matching both words
- 📋 Given apropos results, when I select a command, then I should view its documentation

---

### 3.2 Phase 2: Extensibility

#### US-2.1.1: Plugin Directory Structure
**As a** plugin developer  
**I want** a standard plugin directory structure  
**So that** my plugins can be discovered and loaded  

**Status:** ✅ Implemented (`src/editor/api/plugin-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I install a plugin, when I place it in `~/.config/tmax/tlpa/plugin-name/`, then tmax should discover it on startup
- ✅ Given a plugin directory, when it contains `plugin.tlisp`, then tmax should load it automatically
- 📋 Given plugin with dependencies, when I specify them in manifest, then tmax should load dependencies first

#### US-2.1.2: Plugin Lifecycle Hooks
**As a** plugin developer  
**I want** lifecycle hooks for initialization  
**So that** my plugin can set up properly  

**Status:** 🚧 Partially implemented (load/unload works, enable/disable hooks planned)

**Acceptance Criteria:**
- ✅ Given a plugin defines `(plugin-init)`, when plugin loads, then init function should execute
- 📋 Given a plugin defines `(plugin-enable)`, when I enable the plugin, then enable hook should execute
- 📋 Given a plugin defines `(plugin-disable)`, when I disable the plugin, then cleanup code should execute
- 📋 Given a plugin defines `(plugin-unload)`, when plugin is unloaded, then resources should be freed

#### US-2.4.1: Macro Recording
**As a** power user  
**I want** to record keyboard macros  
**So that** I can automate repetitive tasks  

**Status:** ✅ Implemented (`src/editor/api/macro-recording.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `qa` (q followed by register name), then recording should start for register `a`
- ✅ Given recording is active, when I execute commands, then they should be recorded
- ✅ Given recording active, when I press `q`, then recording should stop and save to register
- ✅ Given recorded macro in register `a`, when I press `@a`, then macro should execute
- ✅ Given I just executed a macro, when I press `@@`, then last macro should execute again

#### US-2.4.2: Macro Persistence
**As a** power user  
**I want** macros to persist across sessions  
**So that** I don't lose recorded macros  

**Status:** ✅ Implemented (`src/editor/api/macro-persistence.ts`)

**Acceptance Criteria:**
- ✅ Given I recorded a macro in register `a`, when I quit and restart tmax, then macro in register `a` should still be available
- ✅ Given persistent macros, when I edit `~/.config/tmax/macros.tlisp`, then I should be able to modify recorded macros
- ✅ Given edited macro file, when I restart tmax, then my edits should be loaded

---

### 3.3 Phase 3: Advanced Features

#### US-3.1.1: LSP Client Connection
**As a** developer  
**I want** tmax to connect to language servers  
**So that** I can have IDE features  

**Status:** 🚧 Partially implemented (`src/lsp/client.ts` — framework exists, not production-ready)

**Acceptance Criteria:**
- 🚧 Given I open a TypeScript file, when tmax starts, then it should attempt to connect to language server
- 🚧 Given LSP server running, when connection succeeds, then "LSP connected" should appear in status line
- ✅ Given LSP connection fails, when server is not available, then error should be logged but editor remain functional

#### US-3.1.2: LSP Diagnostics
**As a** developer  
**I want** to see LSP diagnostics (errors, warnings)  
**So that** I can fix problems in my code  

**Status:** 🚧 Partially implemented (`src/editor/api/lsp-diagnostics.ts` — state tracking exists, display incomplete)

**Acceptance Criteria:**
- 🚧 Given LSP connected and file has errors, when I open the file, then error indicators should appear in gutter
- 🚧 Given diagnostics available, when I navigate to line with error, then error message should appear in status line
- 🚧 Given multiple diagnostics, when I list diagnostics, then I should see all errors and warnings

#### US-3.2.1: Window Splitting
**As a** developer  
**I want** to split windows horizontally and vertically  
**So that** I can view multiple files simultaneously  

**Status:** ✅ Implemented (`src/editor/api/window-ops.ts` — data structures and management, rendering in progress)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I execute `:split`, then window should split horizontally
- ✅ Given I'm in normal mode, when I execute `:vsplit`, then window should split vertically
- ✅ Given split windows, when I press `C-w w`, then focus should move to next window
- ✅ Given split windows, when I press `C-w q`, then current window should close

#### US-3.2.2: Window Resizing
**As a** developer  
**I want** to resize split windows  
**So that** I can adjust the layout  

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given two horizontal windows, when I press `C-w +` multiple times, then current window height should increase
- 📋 Given two horizontal windows, when I press `C-w -` multiple times, then current window height should decrease
- 📋 Given two vertical windows, when I press `C-w >` multiple times, then current window width should increase
- 📋 Given two vertical windows, when I press `C-w <` multiple times, then current window width should decrease

#### US-3.4.1: Undo Tree
**As a** developer  
**I want** a branching undo tree  
**So that** I can explore alternative edit histories  

**Status:** ✅ Implemented (`src/editor/api/undo-tree.ts`)

**Acceptance Criteria:**
- ✅ Given I make edits A, B, C, undo to A, then make D, when I view undo tree, then I should see branch: A → B → C and A → D
- ✅ Given undo tree with branches, when I navigate to a branch point, then I can choose which branch to follow
- 🚧 Given undo tree visualization, when I open it, then I should see a visual representation of branches

---

### 3.4 Phase 4: Community

#### US-4.1.1: Plugin Repository
**As a** user  
**I want** to discover plugins in a central repository  
**So that** I can find useful extensions  

**Status:** 📋 Planned (`src/editor/api/plugin-repository.ts` — stub exists)

**Acceptance Criteria:**
- 📋 Given I execute M-x `plugin-list`, when command runs, then I should see available plugins from repository
- 📋 Given plugin list, when I select a plugin, then I should see description, author, and install command
- 📋 Given selected plugin, when I choose to install, then it should download to `~/.config/tmax/tlpa/`

#### US-4.1.2: Plugin Submission
**As a** plugin developer  
**I want** to submit my plugin to the repository  
**So that** others can discover and use it  

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given I've created a plugin, when I submit to repository, then it should undergo review process
- 📋 Given submitted plugin, when review passes, then plugin should be published to repository
- 📋 Given published plugin, when users list plugins, then my plugin should appear in results

#### US-4.2.1: Documentation Website
**As a** user  
**I want** comprehensive online documentation  
**So that** I can learn tmax features thoroughly  

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given I visit documentation website, when I navigate to API reference, then I should see all T-Lisp functions documented
- 📋 Given documentation site, when I search for "key bindings", then I should find relevant tutorials and guides
- 📋 Given API documentation, when I view a function, then I should see signature, description, examples, and related functions

#### US-4.3.1: Test Coverage Metrics
**As a** developer  
**I want** to see test coverage metrics  
**So that** I can ensure code quality  

**Status:** ✅ Implemented (`src/tlisp/test-coverage.ts`)

**Acceptance Criteria:**
- ✅ Given I run tests with coverage, when tests complete, then I should see percentage coverage for each module
- ✅ Given coverage report, when I view it, then I should see which functions are covered
- ✅ Given coverage below threshold, when tests run, then build should report warning

---

### Phase 0.8: Server/Client Architecture

#### US-0.8.1: Basic Server/Client Infrastructure
**As a** developer  
**I want** to control a running tmax instance from the command line  
**So that** I can open files instantly and execute T-Lisp commands  

**Status:** ✅ Implemented (`src/server/server.ts`, `tmax --daemon`)

**Acceptance Criteria:**
- ✅ Given I want to start tmax as a server, when I execute `tmax --daemon`, then server should start listening
- ✅ Given the server is running, when I connect, then file operations should work instantly
- 🚧 Given I want to evaluate T-Lisp code from command line, when I execute eval command, then I should receive output
- 📋 Given I open a file with wait mode, when I execute client command, then client should block until buffer is closed
- 📋 Given server is not running, when I execute client command, then I should see error message

#### US-0.8.2: Advanced Client Commands
**As a** power user  
**I want** advanced client commands  
**So that** I can use tmaxclient in scripts and integrations  

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given I want to list all buffers, when I execute `tmaxclient --list-buffers`, then I should see list of buffers
- 📋 Given I want to kill a buffer, when I execute `tmaxclient --kill-buffer name`, then buffer should be closed
- 📋 Given I want to use tmax as git editor, when I set `GIT_EDITOR`, then commit message should open in tmax

#### US-0.8.3: AI Agent Control
**As an** AI agent  
**I want** full programmatic control over the tmax editor  
**So that** I can explore codebases and make changes  

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given I want to query full editor state, when I send query, then I should receive JSON with buffers, cursor, variables
- 📋 Given I want to understand a function, when I send describe command, then I should receive documentation
- 📋 Given I want to execute and verify changes, when I send T-Lisp code, then I should receive results

---

## 4. Non-Functional Requirements

### Performance
- ✅ Fast startup (<500ms cold start)
- ✅ Responsive editing with efficient gap buffer implementation
- ✅ Steep frontend renders in ~1-2ms per keystroke (no React overhead)

### Security
- ✅ Zero external runtime dependencies (Steep frontend)
- ✅ Sandboxed T-Lisp execution environment
- ✅ No network access from editor core

### Portability
- ✅ Cross-platform: macOS, Linux (Windows planned)
- ✅ Bun runtime and Node.js compatibility (via tsx)
- ✅ Standard ANSI terminal support

### Reliability
- ✅ Comprehensive error handling with graceful degradation
- ✅ Terminal state restored on exit (alternate screen buffer cleanup)
- ✅ 1230+ passing tests across 118 test files

### Extensibility
- ✅ 25+ T-Lisp API modules for complete editor control
- ✅ 31 built-in T-Lisp standard library functions
- ✅ Macro system with quasiquote support
- ✅ Plugin loading from `~/.config/tmax/tlpa/`

---

## 5. Constraints

### Technical Constraints
- **Runtime:** Bun (primary) or Node.js with tsx (secondary)
- **Terminal:** Requires alternate screen buffer and raw mode support
- **Language:** TypeScript core with T-Lisp scripting layer
- **Frontend:** Steep (default, direct ANSI) or Ink (optional, React/Ink)

### Design Constraints
- T-Lisp handles all editor logic; frontends are thin view layers
- Editor API operations mutate state through `EditorStateAccess` proxy
- `Editor.handleKey()` returns `EditorState` (Elm Architecture bridge)
- All T-Lisp functions are registered via `createEditorAPI()` factory

### Development Constraints
- Sequential phase development (architecture before features)
- Zero breaking changes to T-Lisp API
- All new key bindings must go through T-Lisp keymaps
- UI tests via tmux harness for terminal behavior validation
