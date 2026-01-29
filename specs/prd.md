# Product Requirements Document (PRD)

## Executive Summary

**Product Name:** tmax
**Version:** 1.1 (Complete Implementation)
**Date:** January 29, 2026
**Status:** ✅ COMPLETE AND FUNCTIONAL

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

### Epic 2: Neovim-Compatible Interface ✅ COMPLETE
**As a** Neovim user  
**I want** familiar key bindings and interface  
**So that** I can use tmax without learning new keybindings

#### Acceptance Criteria - Implementation Status
- ✅ **Modal editing**: Familiar normal/insert/visual mode behavior
- ✅ **Key bindings**: hjkl navigation, i for insert, Escape to exit
- ✅ **Command mode**: vim-style commands (:q, :w, :wq, :e filename)
- ✅ **Status line**: Mode indication and cursor position
- ✅ **Full-screen interface**: Takes over terminal like vim/neovim
- ✅ **Jump commands**: gg, G, :line_number
- [ ] Text objects (ciw, daw, etc.) - Planned for v1.2.0
- [ ] Visual selection modes - Basic visual mode implemented, advanced features planned

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
- [ ] Plugin system using T-Lisp - Planned for v1.4.0

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

tmax has successfully achieved its primary design goals and represents a functional, production-ready terminal-based text editor. It successfully combines the immediate productivity of vim-like modal editing with T-Lisp extensibility, providing both beginner-friendly operation and customization capabilities.

The implementation demonstrates technical excellence through comprehensive testing, modern architecture, and clean code practices. Users can immediately begin editing text with familiar key bindings while exploring the T-Lisp customization system.

**Status: ✅ FUNCTIONAL AND READY FOR USE**

## Planned Enhancements

### Bun + ink UI Migration ✅ COMPLETE (v1.1.0)
**Status:** Completed January 29, 2026

**Achievements:**
- ✅ Migrated to Bun runtime for modern JavaScript execution
- ✅ Implemented React-based declarative UI using ink
- ✅ Created Editor, BufferView, StatusLine, CommandInput components (dumb components)
- ✅ Full-screen layout with proper flexbox positioning
- ✅ Character insertion persistence bug fixes
- ✅ Mode switching improvements
- ✅ Command execution fixes (:q, :w, :wq)
- ✅ Clean console output (removed debug logs)
- ✅ All 131+ unit tests passing
- ✅ All UI tests passing

**Architecture:**
- **T-Lisp = Core Engine** (like Emacs Lisp) - ALL editor logic
- **React/ink = Thin UI Layer** - ONLY capture input + render state
- **Dumb Components** - React components contain NO business logic
- **T-Lisp Execution** - All operations go through T-Lisp function calls

**Key Benefits Delivered:**
- Declarative component-based UI (vs. manual ANSI escape sequences)
- Improved maintainability with clear separation of concerns
- T-Lisp-first architecture (like Emacs)
- Enhanced testing with blackbox UI tests
- Better layout capabilities with Flexbox

**T-Lisp Keybinding Architecture: 🚧 PARTIALLY COMPLETE** (see [specification](SPEC-004-tlisp-core-bindings-migration.md) for full requirements)
- ✅ Core Neovim motions (hjkl, w/b/e, gg/G) - **COMPLETE**
- ✅ Basic commands (i, a, o, dd, yy, p) - **COMPLETE**
- [ ] Search functionality (/, n, N)
- [ ] Plugin loading system in T-Lisp

### Post-v1.1 Releases

#### v1.2.0 - Enhanced Editing (Future)
- Advanced text objects (ciw, daw, etc.)
- Visual selection modes
- Syntax highlighting framework
- Search functionality (/, n, N)
- Advanced navigation (marks, jumplist)

#### v1.3.0 - T-Lisp Keybinding Architecture (Future)
- Complete T-Lisp-centric keybinding system (see [SPEC-004](SPEC-004-tlisp-core-bindings-migration.md))
- Pure T-Lisp keymap data structures
- Default bindings in T-Lisp files
- Enhanced keybinding customization

#### v1.4.0 - Extensibility (Future)
- Plugin ecosystem foundation
- Advanced T-Lisp features
- Macro recording/playback
- Performance optimizations
- Plugin loading system

### Dependencies and Blockers
- **v1.1.0:** Deno-ink migration must preserve all T-Lisp API functionality
- **v1.2.0:** Visual mode foundation required for text objects
- **v1.3.0:** Keybinding architecture requires T-Lisp data structure enhancements
- **External:** Deno runtime stability for TypeScript performance

## Risks and Assumptions

### Risks
- **Risk 1: Deno-ink Migration Complexity** - *Mitigation: Comprehensive user stories with acceptance criteria, incremental migration with testing at each step*
- **Risk 2: Performance Regression** - *Mitigation: Performance benchmarks in migration spec, parity requirements, profiling during migration*
- **Risk 3: T-Lisp API Breaking Changes** - *Mitigation: All 25+ functions must work, zero test regression requirement, comprehensive test suite (131 tests)*

### Assumptions
- Deno-ink will provide sufficient performance for text editing operations
- React component model will integrate cleanly with functional programming patterns
- ink-testing-library will provide adequate testing capabilities for TUI components

## Dependencies

### Internal Dependencies
- **Deno-ink Migration:** Requires stable T-Lisp API (✅ complete)
- **Component Testing:** Requires ink-testing-library compatibility with Deno
- **State Management:** Requires bridge between React state and EditorState interface

### External Dependencies
- **Bun:** Modern JavaScript runtime with optimal TypeScript and JSX support
- **ink:** npm package for React-based terminal UI (cliui)
- **React:** UI component library for terminal rendering
- **TypeScript:** Type-safe development with strict mode

## Out of Scope

Items that are explicitly not included in current releases:
- GUI components or web-based interfaces (terminal-only maintained)
- Breaking changes to T-Lisp API (zero breaking changes requirement)
- Changes to T-Lisp interpreter or standard library (stable since v1.0)

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