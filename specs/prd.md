# Product Requirements Document (PRD)

## Executive Summary

**Product Name:** tmax
**Version:** 0.1.0 (Initial Alpha Release)
**Date:** February 3, 2025
**Status:** ✅ FUNCTIONAL ALPHA

tmax is a comprehensive extensible terminal-based text editor with a TypeScript core running on the Bun runtime. Following the Emacs architecture, the system has a clear separation of concerns:

**T-Lisp (Core Engine - like Emacs Lisp):**
- ALL editor functionality and business logic
- Commands, modes, key bindings, and extensibility
- Buffer operations, cursor movement, text manipulation
- File operations, state management
- Complete customization layer

**TypeScript + React/ink (Thin UI Layer):**
- ONLY capture user input (keyboard events)
- Render the current editor state to terminal
- Bridge between terminal and T-Lisp engine
- No business logic - pure presentation layer

**Current Development Focus:** Achieving basic "Emacs with Evil-mode" parity through implementation of core Vim editing commands (operators, navigation, search) and select Emacs features (kill ring, minibuffer, which-key).

The implementation delivers a full-screen terminal editor with Neovim-inspired key motions, Emacs-like extensibility through a complete T-Lisp interpreter, and modern React-based UI rendering via Bun + ink for improved maintainability and declarative component architecture.

## Problem Statement

### Problem Addressed
Developers needed a modern, extensible terminal editor that combines the best aspects of both vim and Emacs approaches. Traditional editors have steep learning curves and complex configuration, while modern editors often lack terminal integration or unlimited extensibility.

### Target Users
- **Primary Users:** Software developers who work primarily in terminal environments
- **Secondary Users:** System administrators, DevOps engineers, and power users who prefer keyboard-driven workflows
- **Achievement:** Successfully provides immediate productivity (vim-like keys) with unlimited extensibility (T-Lisp)

### Pain Points Solved
- ✅ **Intuitive interface**: Familiar vim key bindings work immediately
- ✅ **Unlimited extensibility**: Complete T-Lisp interpreter for customization
- ✅ **Modern architecture**: TypeScript on Deno with zero external dependencies
- ✅ **Simple configuration**: T-Lisp scripts are readable and shareable

## Goals and Objectives

### Primary Goals (All Achieved ✅)
- ✅ **Create a terminal-based editor** with intuitive Neovim-style key motions
- ✅ **Implement full-screen interface** with alternate screen buffer and viewport management
- ✅ **Provide unlimited extensibility** through complete T-Lisp interpreter
- ✅ **Support multiple editing modes** (normal, insert, visual, command, M-x)
- ✅ **Enable easy customization** through .tmaxrc configuration files
- ✅ **Ensure zero dependencies** for security and simplicity
- ✅ **Achieve comprehensive testing** with 131 tests across 8 suites
### Secondary Goals (Foundation Established ✅)
- ✅ **Establish extensibility foundation** for unlimited customization
- ✅ **Create comprehensive API** for T-Lisp integration (25+ functions)
- ✅ **Provide modern development environment** with TypeScript and Deno
- ✅ **Enable community contributions** through shareable T-Lisp configurations
- ✅ **Support development workflows** with proper file operations and terminal integration

## Success Metrics

### Key Performance Indicators (KPIs) - All Achieved ✅
- **✅ Functional Completeness**: 100% - All core features implemented and tested
- **✅ Test Coverage**: 131 tests across 8 comprehensive test suites
- **✅ User Experience**: Immediate productivity with vim-like keys + unlimited extensibility
- **✅ Technical Excellence**: Zero external dependencies, modern TypeScript architecture
- **✅ Documentation**: Complete API reference, usage examples, and configuration guides

### Success Criteria - All Met ✅
- ✅ **Immediate usability**: Users can edit text without learning new concepts
- ✅ **Unlimited extensibility**: T-Lisp provides complete editor customization
- ✅ **Professional quality**: Comprehensive testing and error handling
- ✅ **Modern architecture**: TypeScript on Deno with clean separation of concerns
- ✅ **Community ready**: Shareable configurations and clear documentation

## User Stories and Requirements - All Implemented ✅

### Epic 1: Core Editor Functionality ✅ COMPLETE
**As a** developer  
**I want** basic text editing capabilities with modal interface  
**So that** I can efficiently edit code files in the terminal

#### Acceptance Criteria - All Implemented ✅
- ✅ **Five editing modes**: normal, insert, visual, command, and M-x
- ✅ **Full cursor movement**: hjkl navigation with viewport scrolling
- ✅ **Text operations**: insertion, deletion with proper cursor positioning
- ✅ **File operations**: open, save, create through command interface
- ✅ **Advanced functionality**: M-x commands, configurable key bindings

### Epic 2: Neovim-Compatible Interface 🚧 IN PROGRESS
**As a** Neovim user
**I want** familiar key bindings and interface
**So that** I can use tmax without learning new keybindings

#### Acceptance Criteria - Implementation Status
- ✅ **Modal editing**: Familiar normal/insert/visual mode behavior
- ✅ **Key bindings**: hjkl navigation, i for insert, Escape to exit
- ✅ **Command mode**: vim-style commands (:q, :w, :wq, :e filename)
- ✅ **Status line**: Mode indication and cursor position
- ✅ **Full-screen interface**: Takes over terminal like vim/neovim
- 🚧 **Navigation**: Basic hjkl complete, advanced (w/b/e, 0/$) planned for v0.2.0
- 🚧 **Operators**: Basic editing complete, d/y/c operators planned for v0.2.0
- [ ] **Jump commands**: gg, G, :line_number - Planned for v0.2.0 (Phase 1.6)
- [ ] **Text objects**: ciw, daw, etc. - Planned for v0.2.0 (Phase 1.8)
- [ ] **Visual selection modes**: Basic visual mode implemented, advanced features planned for v0.2.0 (Phase 1.7)
- [ ] **Search functionality**: /, ?, n, N - Planned for v0.2.0 (Phase 1.5)

**Next Steps:** See Phase 1 (Core Editing) in Planned Enhancements below

### Epic 3: T-Lisp Extensibility System ✅ COMPLETE
**As a** power user
**I want** to extend the editor with T-Lisp code
**So that** I can customize all aspects of the editor's behavior

#### Acceptance Criteria - All Implemented ✅
- ✅ **T-Lisp interpreter implementation**: Complete with tokenizer, parser, evaluator
- ✅ **Built-in T-Lisp standard library**: 31 functions for comprehensive functionality
- ✅ **T-Lisp macro definition and execution**: Full quasiquote support
- ✅ **Editor API**: 25+ functions for complete editor control
- ✅ **Configuration system**: .tmaxrc files with T-Lisp scripting
- ✅ **Interactive T-Lisp REPL**: Complete development environment
- 🚧 **Plugin system using T-Lisp** - Foundation complete, full system planned for v0.3.0 (Phase 2.1)
- 🚧 **T-Lisp keybinding architecture** - Functional, refactor in progress (Phase 0.4)

**Next Steps:** See Phase 0.4 (Key Binding Refactor) and Phase 2 (Extensibility) in Planned Enhancements below

---

## Detailed User Stories with Acceptance Criteria

### Phase 0.4: T-Lisp-Centric Key Binding System

#### US-0.4.1: T-Lisp Keymap Data Structures
**As a** power user
**I want** key bindings to be stored as T-Lisp data structures
**So that** I can inspect, modify, and understand the entire key binding system

**Acceptance Criteria:**
- **Given** the T-Lisp environment is initialized
  **When** I query `*normal-mode-keymap*`
  **Then** I should see a hash-map of key bindings
- **Given** a keymap hash-map exists
  **When** I call `(get-binding "i" "normal")`
  **Then** I should receive the bound command as a T-Lisp function
- **Given** the keybinding system
  **When** I inspect keymap inheritance
  **Then** I should see context → mode → global precedence

#### US-0.4.2: Core Bindings in T-Lisp Files
**As a** developer
**I want** default key bindings defined in T-Lisp files
**So that** I can understand and modify default behavior

**Acceptance Criteria:**
- **Given** a fresh tmax installation
  **When** tmax starts
  **Then** it should load `src/tlisp/core-bindings.tlisp`
- **Given** the core-bindings.tlisp file
  **When** I read its contents
  **Then** I should see all default bindings in T-Lisp syntax
- **Given** a modified core-bindings.tlisp
  **When** I restart tmax
  **Then** my modifications should be active

#### US-0.4.3: Pure T-Lisp Key Bind Function
**As a** power user
**I want** the `(key-bind)` function implemented in pure T-Lisp
**So that** I can customize it or extend it

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I evaluate `(key-bind "zz" "(center-cursor)" "normal")`
  **Then** pressing `zz` should execute my custom function
- **Given** a custom key binding
  **When** I call `(remove-binding "zz" "normal")`
  **Then** the binding should be removed
- **Given** multiple key bindings
  **When** I call `(list-bindings "normal")`
  **Then** I should see all active bindings for that mode

---

### Phase 1: Core Editing Features

#### US-1.1.1: Word Navigation
**As a** developer
**I want** to navigate by words using `w`, `b`, `e`
**So that** I can quickly move through code

**Acceptance Criteria:**
- **Given** I'm in normal mode on any line
  **When** I press `w`
  **Then** cursor should move to start of next word
- **Given** I'm in normal mode
  **When** I press `b`
  **Then** cursor should move to start of previous word
- **Given** I'm in normal mode
  **When** I press `e`
  **Then** cursor should move to end of current word
- **Given** I'm in normal mode
  **When** I press `3w`
  **Then** cursor should move forward 3 words
- **Given** word navigation keys
  **When** I reach the end of a line
  **Then** navigation should continue to next line

#### US-1.1.2: Line Navigation
**As a** developer
**I want** to navigate to line start/end using `0`, `$`, `^`
**So that** I can quickly position cursor on a line

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I press `0`
  **Then** cursor should move to column 0
- **Given** I'm in normal mode
  **When** I press `$`
  **Then** cursor should move to last character of line
- **Given** I'm in normal mode
  **When** I press `^`
  **Then** cursor should move to first non-whitespace character

#### US-1.2.1: Delete Operator
**As a** developer
**I want** to delete text using `d`, `dd`, `dw`, `x`
**So that** I can remove unwanted text

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I press `dd`
  **Then** current line should be deleted
- **Given** I'm in normal mode
  **When** I press `dw`
  **Then** word under cursor should be deleted
- **Given** I'm in normal mode
  **When** I press `x`
  **Then** character under cursor should be deleted
- **Given** I'm in normal mode
  **When** I press `3dd`
  **Then** 3 lines starting from current should be deleted
- **Given** deleted text
  **When** I delete more text
  **Then** previous deletions should be stored (for future yank ring integration)

#### US-1.2.2: Yank (Copy) Operator
**As a** developer
**I want** to yank (copy) text using `yy`, `yw`
**So that** I can duplicate text

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I press `yy`
  **Then** current line should be yanked to register
- **Given** I'm in normal mode
  **When** I press `yw`
  **Then** word under cursor should be yanked
- **Given** yanked text
  **When** I move cursor and press `p`
  **Then** yanked text should be pasted after cursor
- **Given** yanked text
  **When** I press `P`
  **Then** yanked text should be pasted before cursor

#### US-1.2.3: Undo/Redo
**As a** developer
**I want** to undo and redo changes using `u`, `C-r`
**So that** I can correct mistakes

**Acceptance Criteria:**
- **Given** I've made text changes
  **When** I press `u` in normal mode
  **Then** last change should be undone
- **Given** undone changes
  **When** I press `C-r` in normal mode
  **Then** undone change should be redone
- **Given** multiple edits
  **When** I press `5u`
  **Then** last 5 changes should be undone
- **Given** undo history
  **When** I make new changes after undo
  **Then** redo history should be cleared

#### US-1.3.1: Count Prefix
**As a** developer
**I want** to prefix commands with counts
**So that** I can repeat operations efficiently

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I press `3j`
  **Then** cursor should move down 3 lines
- **Given** I'm in normal mode
  **When** I press `5dd`
  **Then** 5 lines should be deleted
- **Given** I'm in normal mode
  **When** I press `10x`
  **Then** 10 characters should be deleted
- **Given** a count prefix
  **When** I press a command without count
  **Then** command should execute once (default count of 1)

#### US-1.4.1: Change Operator
**As a** developer
**I want** to change text using `c`, `cw`, `cc`, `C`
**So that** I can delete and enter insert mode in one action

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I press `cw`
  **Then** word under cursor should be deleted and insert mode entered
- **Given** I'm in normal mode
  **When** I press `cc`
  **Then** entire line should be cleared and insert mode entered
- **Given** I'm in normal mode
  **When** I press `C`
  **Then** from cursor to end of line should be deleted and insert mode entered
- **Given** change operator
  **When** I complete typing and press Escape
  **Then** I should return to normal mode with changes applied

#### US-1.5.1: Search Forward/Backward
**As a** developer
**I want** to search using `/pattern` and `?pattern`
**So that** I can find text in my buffer

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I press `/` and type a pattern
  **Then** cursor should jump to first match after current position
- **Given** I'm in normal mode
  **When** I press `?` and type a pattern
  **Then** cursor should jump to first match before current position
- **Given** an active search
  **When** I press `n`
  **Then** cursor should jump to next match
- **Given** an active search
  **When** I press `N`
  **Then** cursor should jump to previous match
- **Given** search results
  **When** multiple matches exist
  **Then** they should be highlighted in the buffer

#### US-1.5.2: Word Under Cursor Search
**As a** developer
**I want** to search for word under cursor using `*` and `#`
**So that** I can quickly find other occurrences

**Acceptance Criteria:**
- **Given** cursor is on a word in normal mode
  **When** I press `*`
  **Then** search should start for that word forward
- **Given** cursor is on a word in normal mode
  **When** I press `#`
  **Then** search should start for that word backward
- **Given** word search active
  **When** I press `n` or `N`
  **Then** cursor should jump to next/previous occurrence of that word

#### US-1.6.1: Jump Commands
**As a** developer
**I want** to jump to specific lines using `gg`, `G`, `:line_number`
**So that** I can quickly navigate large files

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I press `gg`
  **Then** cursor should jump to first line of buffer
- **Given** I'm in normal mode
  **When** I press `G`
  **Then** cursor should jump to last line of buffer
- **Given** I'm in normal mode
  **When** I press `:50` and Enter
  **Then** cursor should jump to line 50
- **Given** jump commands
  **When** I jump to a line
  **Then** viewport should scroll to show that line

#### US-1.7.1: Visual Mode Selection
**As a** developer
**I want** to select text in visual mode using `v`, `V`, `C-v`
**So that** I can perform operations on selected regions

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I press `v`
  **Then** characterwise visual mode should start
- **Given** I'm in normal mode
  **When** I press `V`
  **Then** linewise visual mode should start
- **Given** visual mode active
  **When** I navigate with hjkl
  **Then** selection should expand from start position
- **Given** visual selection active
  **When** I press `d`
  **Then** selected text should be deleted
- **Given** visual selection active
  **When** I press `y`
  **Then** selected text should be yanked
- **Given** visual selection active
  **When** I press `c`
  **Then** selected text should be deleted and insert mode entered

#### US-1.8.1: Basic Text Objects
**As a** developer
**I want** to operate on text objects like `iw`, `aw`, `is`, `as`
**So that** I can edit with semantic precision

**Acceptance Criteria:**
- **Given** cursor is on a word in normal mode
  **When** I press `diw`
  **Then** inner word (excluding surrounding space) should be deleted
- **Given** cursor is on a word in normal mode
  **When** I press `daw`
  **Then** outer word (including trailing space) should be deleted
- **Given** cursor is in a sentence
  **When** I press `dis`
  **Then** inner sentence should be deleted
- **Given** cursor is in a sentence
  **When** I press `das`
  **Then** outer sentence (including trailing space) should be deleted
- **Given** text object commands
  **When** I use `ciw` instead of `diw`
  **Then** text object should be deleted and insert mode entered

---

### Phase 1.9: Kill Ring System (Emacs Integration)

#### US-1.9.1: Kill Ring Storage
**As a** power user
**I want** deleted and yanked text stored in a kill ring
**So that** I can access recent kills

**Acceptance Criteria:**
- **Given** I delete or yank text
  **When** the operation completes
  **Then** text should be added to kill ring
- **Given** kill ring with 10 items
  **When** I kill new text
  **Then** oldest kill should be removed if ring is full
- **Given** kill ring state
  **When** I query `(kill-ring-latest)`
  **Then** I should receive the most recent kill

#### US-1.9.2: Yank Pop
**As a** power user
**I want** to cycle through kills using `M-y` after yanking
**So that** I can access previous kills

**Acceptance Criteria:**
- **Given** I just yanked text with `C-y`
  **When** I press `M-y`
  **Then** yanked text should be replaced with previous kill
- **Given** I'm cycling kills
  **When** I press `M-y` multiple times
  **Then** I should cycle through older kills
- **Given** I cycle past oldest kill
  **When** I press `M-y` again
  **Then** I should wrap around to newest kill

#### US-1.9.3: Evil Integration
**As a** user familiar with both Emacs and Vim
**I want** Evil delete/yank operations to use kill ring
**So that** both paradigms work together

**Acceptance Criteria:**
- **Given** I delete with `dd` or `dw`
  **When** I check kill ring
  **Then** deleted text should be in kill ring
- **Given** I yank with `yy` or `yw`
  **When** I check kill ring
  **Then** yanked text should be in kill ring
- **Given** Evil and Emacs operations mixed
  **When** I kill with `C-w` then delete with `dw`
  **Then** both should be accessible via kill ring

---

### Phase 1.10: Minibuffer + Which-key + Fuzzy Match

#### US-1.10.1: Minibuffer Input
**As a** user
**I want** a dedicated minibuffer for command input
**So that** I have a consistent interface for commands

**Acceptance Criteria:**
- **Given** I press `SPC ;` (M-x)
  **When** minibuffer appears
  **Then** it should show prompt "M-x:" at bottom of screen
- **Given** minibuffer is active
  **When** I type a command name
  **Then** my input should appear in minibuffer
- **Given** minibuffer with input
  **When** I press `C-g`
  **Then** minibuffer should close without executing
- **Given** minibuffer with input
  **When** I press Enter
  **Then** command should execute and minibuffer close

#### US-1.10.2: Fuzzy Command Completion
**As a** power user
**I want** fuzzy matching for command names
**So that** I can quickly find commands without exact typing

**Acceptance Criteria:**
- **Given** I'm in M-x mode
  **When** I type "sw"
  **Then** I should see commands matching "save-window", "switch-window"
- **Given** fuzzy matches found
  **When** multiple matches exist
  **Then** they should be ranked by prefix matches first
- **Given** completion list
  **When** I press Tab
  **Then** first match should be selected
- **Given** selected completion
  **When** I press Enter
  **Then** selected command should execute

#### US-1.10.3: Which-key Popup
**As a** user learning tmax
**I want** to see available keybindings after pressing a prefix
**So that** I can discover bindings without memorizing

**Acceptance Criteria:**
- **Given** I press `SPC` (leader key)
  **When** I wait 0.5 seconds
  **Then** which-key popup should show available bindings
- **Given** which-key popup visible
  **When** I see "f  File operations"
  **Then** I should understand `f` is a prefix key
- **Given** I press `SPC f`
  **When** submenu popup appears
  **Then** I should see file operation bindings like "f  find-file"
- **Given** which-key popup
  **When** I press any bound key
  **Then** popup should disappear and command execute
- **Given** which-key popup
  **When** I press `C-g`
  **Then** popup should cancel and return to normal mode

#### US-1.10.4: Command Documentation Preview
**As a** user
**I want** to see command documentation in completion
**So that** I understand what commands do

**Acceptance Criteria:**
- **Given** I'm in M-x mode
  **When** I select a command in completion list
  **Then** its first docstring line should be visible
- **Given** command with documentation
  **When** I view it in M-x completion
  **Then** I should see "Kill region between point and mark"
- **Given** command with keybinding
  **When** I view it in M-x completion
  **Then** I should see "Binding: C-w" if it has one

---

### Phase 1.11: Help System

#### US-1.11.1: Describe Key
**As a** user
**I want** to see what function a key runs using `describe-key`
**So that** I can understand keybindings

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I execute M-x `describe-key` and press a key
  **Then** I should see the function bound to that key
- **Given** I describe `w` in normal mode
  **When** help buffer appears
  **Then** I should see it runs `evil-forward-word-begin`
- **Given** describe-key output
  **When** function has documentation
  **Then** I should see its docstring

#### US-1.11.2: Describe Function
**As a** user
**I want** to see function documentation using `describe-function`
**So that** I can learn what functions do

**Acceptance Criteria:**
- **Given** I execute M-x `describe-function`
  **When** I enter a function name
  **Then** I should see its full documentation
- **Given** function documentation
  **When** I view it
  **Then** I should see signature, docstring, and keybindings

#### US-1.11.3: Apropos Command
**As a** power user
**I want** to search commands by regex using `apropos-command`
**So that** I can discover relevant commands

**Acceptance Criteria:**
- **Given** I execute M-x `apropos-command`
  **When** I enter "save"
  **Then** I should see all commands with "save" in their name
- **Given** I enter "save.*buffer"
  **Then** I should see commands matching both words
- **Given** apropos results
  **When** I select a command
  **Then** I should view its documentation

---

### Phase 2: Extensibility & Plugin System

#### US-2.1.1: Plugin Directory Structure
**As a** plugin developer
**I want** a standard plugin directory structure
**So that** my plugins can be discovered and loaded

**Acceptance Criteria:**
- **Given** I install a plugin
  **When** I place it in `~/.config/tmax/tlpa/plugin-name/`
  **Then** tmax should discover it on startup
- **Given** a plugin directory
  **When** it contains `plugin.tlisp`
  **Then** tmax should load it automatically
- **Given** plugin with dependencies
  **When** I specify them in `plugin.toml`
  **Then** tmax should load dependencies first

#### US-2.1.2: Plugin Lifecycle Hooks
**As a** plugin developer
**I want** lifecycle hooks for initialization
**So that** my plugin can set up properly

**Acceptance Criteria:**
- **Given** a plugin defines `(plugin-init)`
  **When** plugin loads
  **Then** init function should execute
- **Given** a plugin defines `(plugin-enable)`
  **When** I enable the plugin
  **Then** enable hook should execute
- **Given** a plugin defines `(plugin-disable)`
  **When** I disable the plugin
  **Then** cleanup code should execute
- **Given** a plugin defines `(plugin-unload)`
  **When** plugin is unloaded
  **Then** resources should be freed

#### US-2.4.1: Macro Recording
**As a** power user
**I want** to record keyboard macros
**So that** I can automate repetitive tasks

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I press `qa` (q followed by register name)
  **Then** recording should start for register `a`
- **Given** recording is active
  **When** I execute commands
  **Then** they should be recorded without executing
- **Given** recording active
  **When** I press `q`
  **Then** recording should stop and save to register
- **Given** recorded macro in register `a`
  **When** I press `@a`
  **Then** macro should execute
- **Given** I just executed a macro
  **When** I press `@@`
  **Then** last macro should execute again

#### US-2.4.2: Macro Persistence
**As a** power user
**I want** macros to persist across sessions
**So that** I don't lose recorded macros

**Acceptance Criteria:**
- **Given** I recorded a macro in register `a`
  **When** I quit and restart tmax
  **Then** macro in register `a` should still be available
- **Given** persistent macros
  **When** I edit `~/.config/tmax/macros.tlisp`
  **Then** I should be able to modify recorded macros
- **Given** edited macro file
  **When** I restart tmax
  **Then** my edits should be loaded

---

### Phase 3: Advanced Features

#### US-3.1.1: LSP Client Connection
**As a** developer
**I want** tmax to connect to language servers
**So that** I can have IDE features like autocomplete

**Acceptance Criteria:**
- **Given** I open a TypeScript file
  **When** tmax starts
  **Then** it should attempt to connect to `typescript-language-server`
- **Given** LSP server running
  **When** connection succeeds
  **Then** "LSP connected" should appear in status line
- **Given** LSP connection fails
  **When** server is not available
  **Then** error should be logged but editor remain functional

#### US-3.1.2: LSP Diagnostics
**As a** developer
**I want** to see LSP diagnostics (errors, warnings)
**So that** I can fix problems in my code

**Acceptance Criteria:**
- **Given** LSP connected and file has errors
  **When** I open the file
  **Then** error indicators should appear in gutter
- **Given** diagnostics available
  **When** I navigate to line with error
  **Then** error message should appear in status line
- **Given** multiple diagnostics
  **When** I list diagnostics
  **Then** I should see all errors and warnings

#### US-3.2.1: Window Splitting
**As a** developer
**I want** to split windows horizontally and vertically
**So that** I can view multiple files simultaneously

**Acceptance Criteria:**
- **Given** I'm in normal mode
  **When** I execute `:split`
  **Then** window should split horizontally
- **Given** I'm in normal mode
  **When** I execute `:vsplit`
  **Then** window should split vertically
- **Given** split windows
  **When** I press `C-w w`
  **Then** focus should move to next window
- **Given** split windows
  **When** I press `C-w q`
  **Then** current window should close

#### US-3.2.2: Window Resizing
**As a** developer
**I want** to resize split windows
**So that** I can adjust the layout

**Acceptance Criteria:**
- **Given** two horizontal windows
  **When** I press `C-w +` multiple times
  **Then** current window height should increase
- **Given** two horizontal windows
  **When** I press `C-w -` multiple times
  **Then** current window height should decrease
- **Given** two vertical windows
  **When** I press `C-w >` multiple times
  **Then** current window width should increase
- **Given** two vertical windows
  **When** I press `C-w <` multiple times
  **Then** current window width should decrease

#### US-3.4.1: Undo Tree
**As a** developer
**I want** a branching undo tree
**So that** I can explore alternative edit histories

**Acceptance Criteria:**
- **Given** I make edits A, B, C, undo to A, then make D
  **When** I view undo tree
  **Then** I should see branch: A → B → C and A → D
- **Given** undo tree with branches
  **When** I navigate to a branch point
  **Then** I can choose which branch to follow
- **Given** undo tree visualization
  **When** I open it
  **Then** I should see a visual representation of branches

---

### Phase 4: Community & Ecosystem

#### US-4.1.1: Plugin Repository
**As a** user
**I want** to discover plugins in a central repository
**So that** I can find useful extensions

**Acceptance Criteria:**
- **Given** I execute M-x `plugin-list`
  **When** command runs
  **Then** I should see available plugins from repository
- **Given** plugin list
  **When** I select a plugin
  **Then** I should see description, author, and install command
- **Given** selected plugin
  **When** I choose to install
  **Then** it should download to `~/.config/tmax/tlpa/`

#### US-4.1.2: Plugin Submission
**As a** plugin developer
**I want** to submit my plugin to the repository
**So that** others can discover and use it

**Acceptance Criteria:**
- **Given** I've created a plugin
  **When** I submit to repository
  **Then** it should undergo review process
- **Given** submitted plugin
  **When** review passes
  **Then** plugin should be published to repository
- **Given** published plugin
  **When** users list plugins
  **Then** my plugin should appear in results

#### US-4.2.1: Documentation Website
**As a** user
**I want** comprehensive online documentation
**So that** I can learn tmax features thoroughly

**Acceptance Criteria:**
- **Given** I visit documentation website
  **When** I navigate to API reference
  **Then** I should see all T-Lisp functions documented
- **Given** documentation site
  **When** I search for "key bindings"
  **Then** I should find relevant tutorials and guides
- **Given** API documentation
  **When** I view a function
  **Then** I should see signature, description, examples, and related functions

#### US-4.3.1: Test Coverage Metrics
**As a** developer
**I want** to see test coverage metrics
**So that** I can ensure code quality

**Acceptance Criteria:**
- **Given** I run tests with coverage
  **When** tests complete
  **Then** I should see percentage coverage for each module
- **Given** coverage report
  **When** I view it
  **Then** I should see which lines are covered
- **Given** coverage below threshold
  **When** CI runs tests
  **Then** build should fail with coverage report

## Technical Requirements

### Functional Requirements - Implementation Status
- ✅ **Modal editing**: Complete with normal, insert, visual, command, and M-x modes
- ✅ **File operations**: open, save, create through command interface
- ✅ **Text editing**: insert, delete with proper cursor positioning and newline handling
- 🚧 **Key bindings**: Partial T-Lisp integration - functions work but architecture incomplete (see [T-Lisp Keybinding Status](#t-lisp-keybinding-system-status))
- ✅ **T-Lisp interpreter**: Complete with tokenizer, parser, evaluator, macros, stdlib
- ✅ **Command interfaces**: Both vim-style (:q, :w) and M-x (SPC ;) commands
- ✅ **Extensibility**: 25+ T-Lisp API functions for complete editor control
- ✅ **Buffer management**: Multiple buffers with gap buffer implementation
- ✅ **Full-screen interface**: Alternate screen buffer with viewport management

### Non-Functional Requirements - Achievement Status
- ✅ **Performance**: Fast startup, responsive editing with efficient gap buffer implementation
- ✅ **Security**: Zero external dependencies, sandboxed T-Lisp execution
- ✅ **Scalability**: Multiple buffer support with proper memory management
- ✅ **Reliability**: Comprehensive error handling, graceful degradation
- ✅ **Usability**: Intuitive vim-like bindings, clear status feedback
- ✅ **Testing**: 131 tests across 8 suites ensuring reliability
- ✅ **Documentation**: Complete API reference and usage examples

### Technical Constraints - All Met ✅
- ✅ **Bun runtime**: Complete implementation on Bun (modern JavaScript runtime)
- ✅ **Terminal-only**: Full-screen terminal interface with alternate screen buffer
- ✅ **TypeScript core**: Handles low-level operations (I/O, buffers, terminal)
- ✅ **T-Lisp interpreter**: Complete interpreter for all editor functionality
- ✅ **Cross-platform**: Works on Linux, macOS, Windows (key normalization handles differences)
- ✅ **Minimal dependencies**: Self-contained implementation using ink for React-based terminal UI

### Architecture Overview - Implemented ✅

**T-Lisp Engine (Core - All Editor Logic ✅):**
- ✅ **Editor commands**: All functionality exposed through T-Lisp API (25+ functions)
- ✅ **Mode management**: Modal editing state and transitions
- ✅ **Key binding definitions**: Configurable key mappings with mode-specific behavior
- ✅ **Buffer operations**: Insert, delete, cursor movement via T-Lisp
- ✅ **File operations**: Open, save, create files via T-Lisp
- ✅ **Configuration management**: .tmaxrc file loading and execution
- ✅ **User interface logic**: Status line, command input, M-x functionality
- ✅ **Extensibility**: Custom functions, macros, and commands through T-Lisp
- ✅ **Standard library**: 31 built-in functions for comprehensive functionality
- ✅ **Macro system**: Full quasiquote support for code generation

**TypeScript + React/ink (Thin UI Layer ✅):**
- ✅ **Terminal I/O**: Full-screen interface via ink render()
- ✅ **Input capture**: Keyboard event handling via useInput hook
- ✅ **State rendering**: Declarative React components display editor state
- ✅ **Bridge pattern**: Connects T-Lisp state changes to React re-renders
- ✅ **File system operations**: Async file reading/writing (called by T-Lisp)
- ✅ **Memory management**: Efficient buffer operations (called by T-Lisp)
- ✅ **Viewport management**: Scrolling and cursor positioning (computed by T-Lisp)
- ✅ **Key normalization**: Cross-platform key handling (delegated to T-Lisp)

**Critical Architecture Principle:**
```
User Input (Keyboard)
  ↓
React/ink (Capture ONLY)
  ↓
T-Lisp Function (ALL LOGIC HERE)
  ↓
Editor State Update
  ↓
React/ink (Render NEW State)
```

React components NEVER contain business logic. They ONLY:
1. Capture keyboard input
2. Call T-Lisp functions
3. Render the resulting state

## Implementation Status - COMPLETE ✅

### Release v1.0 - All Phases Complete
**Achievement:** Fully functional terminal editor with comprehensive T-Lisp extensibility

#### Phase 1: Core Infrastructure ✅ COMPLETE
**Deliverables - All Implemented:**
- ✅ **Terminal I/O system**: Full-screen interface with alternate screen buffer
- ✅ **File system operations**: open, save, create with proper error handling
- ✅ **Text buffer implementation**: Gap buffer for efficient text editing
- ✅ **Viewport management**: Scrolling and cursor positioning for large files
- ✅ **Key handling**: Raw mode input with cross-platform key normalization
- ✅ **T-Lisp interpreter foundation**: Complete interpreter architecture

**Success Criteria Met:** ✅ Can open, edit, and save text files with full-screen interface

#### Phase 2: T-Lisp Engine ✅ COMPLETE
**Deliverables - All Implemented:**
- ✅ **T-Lisp tokenizer and parser**: Complete lexical analysis and AST generation
- ✅ **Evaluation engine**: Full interpreter with lexical scoping
- ✅ **Standard library**: 31 built-in functions (arithmetic, lists, strings, control flow)
- ✅ **Macro system**: Full quasiquote support with compile-time expansion
- ✅ **Interactive REPL**: Complete development environment for T-Lisp
- ✅ **Tail-call optimization**: Trampoline pattern prevents stack overflow

**Success Criteria Met:** ✅ Can execute T-Lisp code, define functions, and create macros

#### Phase 3: Modal Editor ✅ COMPLETE
**Deliverables - All Implemented:**
- ✅ **Modal editing system**: Five modes (normal, insert, visual, command, M-x)
- ✅ **Key binding system**: Configurable mappings with mode-specific behavior
- ✅ **Editor API**: 25+ T-Lisp functions for complete editor control
- ✅ **Command interfaces**: Both vim-style (:q, :w) and M-x (SPC ;) commands
- ✅ **Buffer management**: Multiple buffers with efficient switching
- ✅ **Configuration system**: .tmaxrc files with T-Lisp scripting

**Success Criteria Met:** ✅ Full modal editor with unlimited extensibility through T-Lisp

#### Phase 4: Bun + ink UI Migration ✅ COMPLETE
**Purpose:** Migrate from manual ANSI escape sequences to declarative React-based UI while maintaining T-Lisp-as-core architecture

**Architecture Principle (CRITICAL):**
- **T-Lisp is the engine** - ALL editor logic lives in T-Lisp
- **React/ink is the view** - Thin UI layer that captures input and renders state
- **No mixing** - React components don't contain business logic

**Deliverables - All Implemented:**
- ✅ **ink adapter**: Full-screen interface using ink render()
- ✅ **React component structure**: Editor, BufferView, StatusLine, CommandInput components (dumb components)
- ✅ **State management**: React hooks bridging EditorState with T-Lisp execution
- ✅ **Test infrastructure**: Unit tests test T-Lisp API, frontend tests test React rendering
- ✅ **UI test suite**: Blackbox tests simulate user typing, test entire system
- ✅ **Performance parity**: Fast rendering with proper layout management
- ✅ **Full-screen layout**: Proper flex layout with status bar at bottom
- ✅ **Clean console output**: Removed debug logs that interfered with display

**Success Criteria - All Met:**
- ✅ All existing features work with Bun + ink UI
- ✅ All 131+ unit tests pass (test T-Lisp API and Editor class)
- ✅ All UI tests pass (blackbox integration tests)
- ✅ React components are DUMB (no business logic)
- ✅ ALL operations go through T-Lisp functions
- ✅ T-Lisp API preserved (no breaking changes)

**Implementation Details:**
- Migrated to Bun runtime for modern JavaScript execution
- Using ink (React for CLI) for declarative terminal UI
- Full-screen mode with alternate screen buffer
- Proper flex layout for dynamic viewport sizing
- Character insertion bug fixes
- Mode switching improvements
- Command execution fixes (:q, :w, :wq)

## Current Capabilities Summary

### ✅ Complete Feature Set
- **Full-screen terminal editor** with alternate screen buffer
- **Five editing modes**: normal, insert, visual, command, and M-x
- **Vim-compatible key bindings** with hjkl navigation
- **Complete T-Lisp interpreter** with tail-call optimization
- **Comprehensive standard library** (31 functions)
- **Macro system** with full quasiquote support
- **Interactive REPL** for T-Lisp development
- **Editor API** with 25+ functions for complete control
- **Command interfaces**: vim-style (:q, :w) and M-x (SPC ;)
- **Multiple buffer management** with efficient switching
- **Configuration system** through .tmaxrc files
- **Comprehensive testing** (131 tests across 8 suites)
- **Zero external dependencies** for security and simplicity

### ✅ Technical Excellence
- **Modern TypeScript architecture** on Bun runtime
- **React-based terminal UI** using ink for declarative component rendering
- **Clean separation of concerns** between TypeScript core and T-Lisp
- **Efficient text editing** with gap buffer implementation
- **Proper error handling** with graceful degradation
- **Cross-platform compatibility** with key normalization
- **Professional documentation** with API reference and examples
- **Full-screen layout** with proper flexbox-based positioning

### ✅ User Experience
- **Immediate productivity** with familiar vim key bindings
- **Unlimited extensibility** through T-Lisp scripting
- **Intuitive command interfaces** for both beginners and power users
- **Responsive editing** with proper cursor positioning
- **Clear feedback** through status line and error messages
- **Shareable configurations** through T-Lisp scripts

### ✅ Development Quality
- **Test-driven development** with comprehensive test coverage
- **Clean codebase** with proper TypeScript typing
- **Maintainable architecture** with clear component boundaries
- **Extensible design** for future enhancements
- **Security-conscious** with sandboxed T-Lisp execution
- ✅ **Modular UI test harness** with tmux automation and AI-friendly API (see [UI Test Harness](#ui-test-harness))

## T-Lisp Keybinding System Status

The tmax editor includes a comprehensive T-Lisp-centric key binding system following the Emacs architecture.

### Current Status - Functional and Aligned with Core Philosophy ✅
- ✅ **Functional**: All key bindings work and execute T-Lisp commands
- ✅ **Runtime modification**: Can change key bindings through T-Lisp at runtime
- ✅ **T-Lisp integration**: (key-bind) function available and working
- ✅ **Architecture aligned**: React UI captures keys, delegates to T-Lisp for execution
- ✅ **Clear separation**: UI layer doesn't contain binding logic
- 🚧 **Default bindings**: Currently defined in TypeScript, should migrate to T-Lisp files
- 🚧 **Enhancement needed**: More sophisticated keymap data structures in T-Lisp stdlib

### Architecture Flow (Current)
```
User presses key 'i'
  ↓
React Editor.tsx captures input via useInput()
  ↓
Editor.executeTlisp("(editor-set-mode 'insert')")
  ↓
T-Lisp interpreter executes editor-set-mode function
  ↓
Function updates Editor.state.mode = 'insert'
  ↓
Editor notifies React via callback
  ↓
React re-renders with new mode
```

### Impact on Product Status
- **User Experience**: ✅ **Excellent** - all key binding functionality works correctly
- **Developer Experience**: ✅ **Good** - clear separation between UI and logic
- **Architecture Compliance**: ✅ **Aligned** - follows T-Lisp-first principle
- **Extensibility**: ✅ **Strong** - users can customize via T-Lisp

### Completion Requirements (Future Enhancement)
1. Create T-Lisp keymap data types (hash-map/association-list in stdlib)
2. Move default key bindings from TypeScript to T-Lisp files
3. Add keymap composition functions for advanced customization
4. Implement keymap inheritance and override mechanisms

## Design Philosophy

### Core Architecture Philosophy

tmax follows the principle of **"Minimal Core, Maximum Extensibility"** where the absolute lowest level operations are implemented in TypeScript, but the vast majority of editor functionality—including the entire key binding system—should be implemented in T-Lisp itself.

#### 1. Core Implementation (TypeScript & T-Lisp)
The absolute lowest level of terminal I/O, file system operations, and buffer management is written in TypeScript. However, **the key binding logic should be implemented entirely in T-Lisp**. The core data structure is not a simple TypeScript Map, but specialized T-Lisp objects called keymaps.

A keymap is essentially a T-Lisp data structure (hash-map or association-list) that maps key sequences to commands (which are T-Lisp functions).

#### 2. The Keymap System (The "Engine")
The key architectural principle is hierarchical keymaps rather than a single global map:

- **Global Keymap**: Contains all default bindings that work everywhere (hjkl navigation, basic commands)
- **Mode-Specific Keymaps**: Each editor mode (normal, insert, visual, command, mx) has its own keymap with higher precedence
- **Context Keymaps**: Future extensibility for context-specific bindings (file-type specific, plugin-specific)

When a key is pressed, tmax should search these keymaps in order (context → mode → global) to find the command to execute, **all implemented in T-Lisp**.

#### 3. Default Bindings (Pure T-Lisp)
**Unlike the current hybrid approach**, default key bindings should be defined entirely in T-Lisp files that ship with tmax. The `core-bindings.tlisp` file should define all basic bindings by directly manipulating T-Lisp keymap variables. TypeScript should only bootstrap the T-Lisp environment and load these files.

#### 4. User Configuration (Pure T-Lisp)
Users configure key bindings in their `.tmaxrc` files using pure T-Lisp functions:

```lisp
;; Bind key to command in specific mode
(key-bind "C-c n" 'my-new-note-function "normal")

;; Global binding across all modes  
(global-set-key "C-x C-s" 'save-buffer)
```

### Current Implementation Status

The current tmax implementation follows this philosophy:
- ✅ **T-Lisp as core engine**: All editor functionality exposed as T-Lisp functions
- ✅ **React as thin UI**: Components capture input and render state only
- ✅ **Clear data flow**: Input → T-Lisp → State Update → React Render
- 🚧 **Default bindings**: Currently in TypeScript, should migrate to T-Lisp files (future enhancement)
- ✅ **Runtime customization**: (key-bind) function works for user customization

### Target Architecture Benefits

This pure T-Lisp approach enables:
- **Complete customization**: Every aspect of key handling in user-accessible T-Lisp
- **Consistent mental model**: All editor behavior follows the same T-Lisp paradigm
- **Maximum extensibility**: Complex key binding behaviors (sequences, prefix maps, conditional bindings) possible through T-Lisp
- **Community sharing**: Key binding configurations are pure T-Lisp scripts
- **Debugging transparency**: Users can inspect and modify the entire key binding system

The editor is designed to be both approachable for beginners (familiar vim bindings work immediately) and infinitely powerful for advanced users who want to craft their perfect editing environment through pure T-Lisp customization.

## Conclusion

tmax has successfully achieved its foundational design goals and represents a functional terminal-based text editor with a clear path forward. It successfully combines the initial productivity of vim-like modal editing with T-Lisp extensibility, providing both beginner-friendly operation and customization capabilities.

The implementation demonstrates technical excellence through comprehensive testing, modern architecture, and clean code practices. Users can immediately begin editing text with familiar key bindings while exploring the T-Lisp customization system.

**Current Status: ✅ FUNCTIONAL v0.1.0 ALPHA**
**Next Milestone: v0.2.0 - Basic Evil-Mode Parity** (Phase 1: Core Editing)

The immediate development focus is implementing core Vim-style editing operators (delete, yank, change), enhanced navigation (word/line movements), and select Emacs features (kill ring, minibuffer with which-key, fuzzy search) to achieve basic "Emacs with Evil-mode" parity. This will transform tmax from a functional alpha into a practical daily editor.

**Development Roadmap:** See `docs/ROADMAP.md` for complete implementation plan spanning:
- Phase 0.4: Key Binding System Refactor (immediate priority)
- Phase 1: Core Editing (v0.2.0) - Evil-mode fundamentals + Emacs integration
- Phase 1.5: Enhanced Features (v0.2.1)
- Phase 2-4: Extensibility, Advanced Features, Community ecosystem

## Planned Enhancements

### Immediate Priority: Key Binding System Refactor (Phase 0.4)

**Status:** 🚧 IN PROGRESS (1/4 Complete)

**Objective:** Complete migration from TypeScript-centric to T-Lisp-centric key binding system.

**Progress:**
- [x] T-Lisp keybinding functions work
- [x] Runtime modification via (key-bind)
- [ ] Implement T-Lisp keymaps (hash-map/association-list)
- [ ] Create `src/tlisp/core-bindings.tlisp` file
- [ ] Remove TypeScript `keyMappings` Map
- [ ] Update `handleKey()` to query T-Lisp environment
- [ ] Re-implement `(key-bind)` in pure T-Lisp

**See:** `docs/ROADMAP.md` for detailed breakdown (Phase 0.4.1 - 0.4.4)

---

### Phase 1: Core Editing (v0.2.0) - Basic Evil-Mode Parity

**Focus:** Implement fundamental Vim-style editing commands to reach basic "Emacs with Evil-mode" functionality.

**Target Timeline:** 5-6 weeks

#### 1.1 - Enhanced Navigation (CRITICAL)
- Word navigation: `w`, `b`, `e`
- Line navigation: `0`, `$`, `^`
- Paragraph navigation: `{`, `}`

#### 1.2 - Basic Operators (CRITICAL)
- Delete: `dd`, `dw`, `x`
- Yank (copy): `yy`, `yw`
- Put (paste): `p`, `P`
- Undo: `u`, `C-r`

#### 1.3 - Counts (HIGH)
- Parse count prefix: `3j`, `5dd`
- Apply to motions and operators

#### 1.4 - Change Operator (HIGH)
- `cw`, `cc`, `C`
- Change with text objects: `ci"`, `ca{`

#### 1.5 - Search Functionality (HIGH)
- `/pattern`, `?pattern`
- `n`, `N` for next/previous
- `*`, `#` for word under cursor

#### 1.6 - Jump Commands (HIGH)
- `gg`, `G`, `:line_number`

#### 1.7 - Visual Selection Operations (MEDIUM)
- Characterwise, linewise, blockwise
- Visual operations: d, y, c

#### 1.8 - Basic Text Objects (MEDIUM)
- `iw`, `aw` (word)
- `is`, `as` (sentence)

#### 1.9 - Kill Ring System (Emacs Integration - HIGH)
- Emacs-style clipboard with history
- `C-w`, `M-w`, `C-y`, `M-y`
- Integration with Evil yank/delete

#### 1.10 - Minibuffer + Which-key + Fuzzy Match (Emacs Integration - HIGH)
- Fuzzy matching for commands
- Which-key popup for keybindings
- Command documentation preview
- Hierarchical leader key system

#### 1.11 - Help System (Emacs Integration - MEDIUM)
- `describe-key`, `describe-function`
- `apropos-command`
- Documentation storage

#### 1.12 - Emacs Window Commands (Emacs Integration - LOW)
- `C-x 2`, `C-x 3`, `C-x 1`, `C-x 0`
- Emacs-style window management

#### 1.13 - Fuzzy Search Commands (MEDIUM)
- `fuzzy-search-line` - Search buffer lines
- `fuzzy-switch-buffer` - Fuzzy buffer switch
- `fuzzy-find-file` - Fuzzy file finding
- `fuzzy-goto-line` - Jump with preview

---

### Phase 1.5: Enhanced Editing Features (v0.2.1)

Advanced features that build on core editing foundation:
- Advanced text objects (paragraphs, blocks, tags)
- Visual selection enhancements
- Syntax highlighting framework
- Improved buffer management

---

### Phase 2: Extensibility & Customization (v0.3.0)

**Focus:** Enhance T-Lisp capabilities and plugin ecosystem.

#### 2.1 - Plugin System
- Plugin directory structure (`~/.config/tmax/tlpa/`)
- Plugin loading and initialization
- Plugin dependency management
- Plugin lifecycle hooks

#### 2.2 - Advanced T-Lisp Features
- Module system for T-Lisp
- Namespace support
- Regular expression integration
- Process spawning capabilities

#### 2.3 - Key Binding System Completion
- Complete Phase 0.4 refactor
- Key binding validation
- Mode-specific override system

#### 2.4 - Macro Recording & Playback
- `q{register}` recording
- `@{register}` playback
- Macro editing and persistence

#### 2.5 - Configuration System
- Configuration file validation
- Error reporting
- Configuration profiles
- Hot-reloading

---

### Phase 3: Advanced Features (v0.4.0)

**Focus:** Professional-grade features for power users.

#### 3.1 - LSP Integration
- LSP client architecture
- Diagnostics display
- Code completion
- Go to definition
- Find references

#### 3.2 - Multiple Windows/Panes
- Window splitting (horizontal/vertical)
- Window navigation and management
- Window layout persistence

#### 3.3 - File Tree Explorer
- File tree sidebar
- File and directory operations
- Git integration indicators

#### 3.4 - Undo/Redo System
- Undo tree implementation
- Persistent undo history
- Branching undo/redo

---

### Phase 4: Community & Ecosystem (v0.5.0)

**Focus:** Build sustainable community and plugin ecosystem.

#### 4.1 - Community Infrastructure
- Plugin repository and registry
- Plugin submission and review process
- Community contribution guidelines

#### 4.2 - Documentation Portal
- Dedicated documentation website
- API reference for T-Lisp functions
- Plugin development tutorials
- Video tutorials and walkthroughs

#### 4.3 - Testing & Quality Assurance
- Increase test coverage to 90%+
- Automated UI testing
- Performance benchmarking
- Continuous integration

#### 4.4 - Distribution & Packaging
- Homebrew formula
- Arch Linux AUR package
- Debian/Ubuntu packages
- Windows installer

---

### Future Enhancements (Post-Phase 1)

Additional features that complement basic editing but are not required for basic Evil-mode parity:

#### Context Actions (Embark-style)
- Actions on completion candidates based on type
- Context-aware menus for files, buffers, functions

#### In-Buffer Completion (Corfu-style)
- Auto-completion popup while typing
- Prerequisite for LSP integration

#### Advanced Navigation
- imenu (jump to definitions)
- tags (ctags/etags)
- bookmarks
- registers
- mark rings

#### Search Enhancement
- ripgrep integration
- project search
- replace-in-files

#### Editing Enhancements
- multiple cursors
- sort lines
- delete duplicates
- indent operations

**See:** `docs/ROADMAP.md` for complete "Future Enhancements" section

---

### Dependencies and Blockers
- **Phase 0.4:** Must complete before extensive keybinding customization
- **Phase 1:** Foundation for all future features
- **Phase 2:** Requires Phase 0.4 completion for full plugin system
- **Phase 3:** LSP integration requires Phase 1.9 (kill ring) and in-buffer completion
- **External:** Bun runtime stability for TypeScript performance

## Risks and Assumptions

### Risks
- **Risk 1: Performance at Scale** - *Mitigation: Profile with large files, optimize rendering pipeline*
- **Risk 2: T-Lisp API Breaking Changes** - *Mitigation: All 25+ functions must work, zero test regression requirement, comprehensive test suite (131 tests)*
- **Risk 3: Cross-platform Compatibility** - *Mitigation: Test on Linux, macOS, Windows with different terminal emulators*

### Assumptions
- Bun runtime will provide stable performance for text editing operations
- React/ink component model will integrate cleanly with functional programming patterns
- Terminal emulators will properly support alternate screen buffer and input modes

## Dependencies

### Internal Dependencies
- **UI Testing:** Requires tmux for blackbox testing (✅ complete)
- **State Management:** Requires bridge between React state and EditorState interface (✅ complete)
- **Component Architecture:** Clean separation between UI (React) and logic (T-Lisp) (✅ complete)

### External Dependencies
- **Bun:** Modern JavaScript runtime with optimal TypeScript and JSX support
- **ink:** npm package for React-based terminal UI (cliui)
- **React:** UI component library for terminal rendering
- **TypeScript:** Type-safe development with strict mode

## Out of Scope

Items that are explicitly not included in alpha releases:
- GUI components or web-based interfaces (terminal-only maintained)
- Breaking changes to T-Lisp API (zero breaking changes requirement)
- Changes to T-Lisp interpreter or standard library (stable since v0.1.0)

## Appendices

### Appendix A: Related Specifications
- [SPEC-009: Migrate UI to Deno-ink](SPEC-009-migrate-ui-to-deno-ink.md) - Complete migration plan with 12 user stories
- [SPEC-004: T-Lisp Core Bindings Migration](SPEC-004-tlisp-core-bindings-migration.md) - T-Lisp-centric keybinding architecture
- [functional-patterns-guidelines.md](../functional-patterns-guidelines.md) - Functional programming patterns used in codebase
- [UI Test Harness](../test/ui/README.md) - Modular tmux-based UI testing framework with AI-friendly API

### Appendix B: Technical Architecture
Current architecture uses React-based terminal UI with ink for declarative component rendering. The completed Bun + ink migration:
- ✅ Replaced manual ANSI escape sequences with declarative React components
- ✅ Maintained clean separation between UI (React) and logic (T-Lisp)
- ✅ Preserved all functional programming patterns (TaskEither, functional interfaces)
- ✅ Kept T-Lisp interpreter and API completely unchanged
- ✅ Implemented full-screen layout with proper flexbox positioning
- ✅ Fixed character insertion persistence bugs
- ✅ Improved mode switching and command execution

### Appendix C: Migration Timeline
**Status:** ✅ COMPLETE

**Total Time:** ~40 hours across multiple sessions

**Completed Work:**
- Bun runtime integration: 4 hours
- React component structure (Editor, BufferView, StatusLine, CommandInput): 6 hours
- State management with useEditorState hook: 5 hours
- Full-screen layout implementation: 4 hours
- Character insertion bug fixes: 3 hours
- Mode switching improvements: 2 hours
- Command execution fixes (:q, :w, :wq): 2 hours
- Console output cleanup: 1 hour
- UI test suite implementation: 6 hours
- Frontend unit tests: 4 hours
- Error handling and edge cases: 3 hours

### Appendix D: UI Test Harness

**Status:** ✅ COMPLETE AND OPERATIONAL

tmax includes a comprehensive, modular UI test harness designed for automated testing via tmux and AI assistant integration. The harness provides a high-level API for controlling editor instances programmatically and validating UI behavior.

#### Architecture

The test harness follows a layered architecture designed for modularity and AI assistant usage:

**Core Layer** (`test/ui/core/`)
- `session.sh` - Tmux session management (create, destroy, list windows)
- `input.sh` - Key/command input (send keys, type text, send commands)
- `query.sh` - State queries (get mode, check text visibility, cursor position)
- `editor.sh` - Editor lifecycle (start, stop, restart, reset)

**Operations Layer** (`test/ui/ops/`)
- `editing.sh` - Editing operations (mode changes, typing, deletion, undo/redo)
- `navigation.sh` - Cursor movement (hjkl, word movement, line navigation, paging)
- `files.sh` - File operations (save, open, create, read, write)

**Assertion Layer** (`test/ui/assert/`)
- `assertions.sh` - Test assertions (text visibility, mode checks, file verification)

**API Layer** (`test/ui/lib/`)
- `api.sh` - Main public API with `tmax_*` functions for AI assistants
- `config.sh` - Configuration and environment variables
- `debug.sh` - Debug utilities and logging

#### Key Features

**AI-Friendly Design**
- All public functions prefixed with `tmax_*` for easy discovery
- Single-responsibility functions (e.g., `tmax_insert`, `tmax_type`, `tmax_save`)
- Clear return values: queries return data, commands return status
- Built-in waiting functions handle timing complexity

**Modular Composition**
```bash
# Simple, composable operations
tmax_start
tmax_insert
tmax_type "Hello World"
tmax_normal
tmax_save_quit
```

**Comprehensive Query Interface**
```bash
mode=$(tmax_mode)              # Returns: INSERT
visible=$(tmax_visible "text") # Returns: 0 (true)
text=$(tmax_text)              # Returns all visible text
running=$(tmax_running)        # Check if editor alive
```

**Built-in Assertions**
```bash
tmax_assert_text "Hello"       # Assert text visible
tmax_assert_mode "INSERT"      # Assert current mode
tmax_assert_no_errors          # Assert no errors present
tmax_summary                   # Print test results (passed/failed)
```

**Debug Support**
- `tmax_debug` - Enable verbose logging of all operations
- `tmax_state` - Show current editor state
- `tmax_dump` - Dump state to file for debugging
- `tmax_screenshot` - Capture tmux window output

#### Usage Examples

**Basic Test**
```bash
source test/ui/lib/api.sh

tmax_init
tmax_start test-file.txt

tmax_type "Hello World"
tmax_assert_text "Hello World"

tmax_save_quit
tmax_cleanup
```

**AI Assistant Integration**
The harness is designed specifically for AI assistants like Claude Code:
- Intent-revealing function names (`tmax_type` not `input_send_text`)
- Automatic state tracking (active window, session management)
- Graceful error handling with clear error messages
- Self-documenting: `tmax_list_functions` shows all available commands

**Test Execution**
```bash
# Run all UI tests
bash test/ui/run-tests.sh

# Run individual test
bash test/ui/tests/01-startup.test.sh
```

#### File Structure
```
test/ui/
├── README.md              # Full documentation
├── QUICKSTART.md          # Quick reference for AI assistants
├── run-tests.sh           # Test runner script
├── lib/
│   ├── api.sh            # Main API (tmax_* functions)
│   ├── config.sh         # Configuration
│   └── debug.sh          # Debug utilities
├── core/
│   ├── session.sh        # Tmux session management
│   ├── input.sh          # Sending keys/commands
│   ├── query.sh          # State queries
│   └── editor.sh         # Editor lifecycle
├── ops/
│   ├── editing.sh        # Editing operations
│   ├── navigation.sh     # Navigation operations
│   └── files.sh          # File operations
├── assert/
│   └── assertions.sh     # Test assertions
└── tests/
    ├── 01-startup.test.sh
    ├── 02-basic-editing.test.sh
    └── 03-mode-switching.test.sh
```

#### Benefits for Deno-ink Migration

The UI test harness directly supports the Deno-ink migration (SPEC-009) by:

1. **Enabling Automated Regression Testing**: Every UI change can be tested automatically
2. **Supporting AI-Assisted Development**: Claude Code can control and test the editor
3. **Providing Visual Feedback**: Manual inspection via tmux attachment
4. **Capturing Failures**: Automatic state dumps on test failures
5. **Modifying Without Breaking Changes**: Tests validate behavior preservation

#### Configuration

Environment variables for customization:

```bash
export TMAX_SESSION="my-test-session"     # Tmux session name
export TMAX_DEBUG=true                    # Enable debug logging
export TMAX_DEFAULT_TIMEOUT=15            # Wait timeout
export TMAX_PROJECT_ROOT="/path/to/tmax"  # Project directory
```

#### Documentation

- **Full Documentation**: `test/ui/README.md` - Comprehensive API reference
- **Quick Reference**: `test/ui/QUICKSTART.md` - Quick start for AI assistants
- **Example Tests**: `test/ui/tests/*.test.sh` - Working test examples
- **API Discovery**: `tmax_list_functions` - Shows all available commands

#### Integration with CI/CD

The test harness supports continuous integration:
- Non-interactive execution (no TTY required in tmux)
- Assertion tracking with exit codes
- Test result summaries (passed/failed counts)
- Easy integration with test runners

This UI test harness ensures the Deno-ink migration maintains full functional parity with the current implementation while enabling automated, reproducible testing of all editor features.

### Test Philosophy for T-Lisp First Architecture

The test suite is organized into three distinct layers, each testing a different aspect of the system:

**1. Unit Tests (test/unit/) - Test T-Lisp Core**
- Test T-Lisp interpreter (tokenizer, parser, evaluator)
- Test Editor class methods with mocks
- Test buffer operations, functional patterns
- Test T-Lisp API functions
- **Fast, isolated, no UI involved**
- **Example**: Testing `(buffer-insert "text")` function works correctly

**2. Frontend Tests (test/frontend/) - Test React Integration**
- Test React components render correctly
- Test state synchronization between Editor and React
- Test useEditorState hook
- Test Ink adapter functionality
- **Tests the bridge between T-Lisp and React**
- **Example**: Testing `<Editor />` renders mode indicator from state

**3. UI Tests (test/ui/tests/) - Blackbox Integration**
- Simulate real user typing in terminal via tmux
- Test ENTIRE system from keyboard to rendered output
- No access to internals - like a real user
- **Tests complete system integration**
- **Example**: Type 'i', type 'hello', press Escape, verify "NORMAL" mode shows

**Critical Principle**: UI tests don't care HOW the system works, only THAT it works:
```
Input: User types 'i' then 'hello' then Escape
Expected: Screen shows "hello" and "NORMAL" mode indicator
How: T-Lisp, React, buffers - irrelevant to the test
```

This three-layer approach ensures:
- T-Lisp core logic is thoroughly tested (unit tests)
- React rendering integration works (frontend tests)
- Complete user workflows function correctly (UI tests)
- Changes to one layer don't break others