# Product Requirements Document (PRD)

## Executive Summary

**Product Name:** tmax  
**Version:** 1.0 (Complete Implementation)  
**Date:** July 9, 2025  
**Status:** ✅ COMPLETE AND FUNCTIONAL  

tmax is a comprehensive extensible terminal-based text editor with a TypeScript core running on the Bun runtime. Following the Emacs architecture, TypeScript handles low-level operations (terminal I/O via ink, file system, memory management, display rendering) while T-Lisp (tmax Lisp) handles all higher-level editor functionality including commands, modes, key bindings, and extensibility. The implementation delivers a full-screen terminal editor with vim-style key bindings as the interface layer, complete Emacs-like extensibility through a T-Lisp interpreter (like Emacs Lisp), and modern features like command mode and M-x functionality. The UI layer uses ink (React for CLI) for improved maintainability and declarative component-based rendering.

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
- ✅ **Deno runtime**: Complete implementation on Deno 2.0+ (tested with 2.3.7)
- ✅ **Terminal-only**: Full-screen terminal interface with alternate screen buffer
- ✅ **TypeScript core**: Handles low-level operations (I/O, buffers, terminal)
- ✅ **T-Lisp interpreter**: Complete interpreter for all editor functionality
- ✅ **Cross-platform**: Works on Linux, macOS, Windows (key normalization handles differences)
- ✅ **Zero dependencies**: Self-contained implementation for security and simplicity

### Architecture Overview - Implemented ✅
**TypeScript Core Responsibilities (All Implemented ✅, Deno-ink Migration Planned 🚧):**
- ✅ **Terminal I/O**: Full-screen interface with alternate screen buffer
- 🚧 **Deno-ink UI Migration**: Migrating from manual ANSI escape sequences to React-based declarative UI (see [SPEC-009](SPEC-009-migrate-ui-to-deno-ink.md))
- ✅ **File system operations**: Async file reading/writing with error handling
- ✅ **Memory management**: Efficient buffer operations and cursor tracking
- ✅ **T-Lisp interpreter runtime**: Complete interpreter with tail-call optimization
- ✅ **Buffer management**: Gap buffer implementation for efficient text editing
- ✅ **Viewport management**: Scrolling and cursor positioning for large files
- ✅ **Key handling**: Raw mode input with proper key normalization

**T-Lisp Engine Responsibilities (All Implemented ✅):**
- ✅ **Editor commands**: All functionality exposed through T-Lisp API (25+ functions)
- ✅ **Mode management**: Modal editing state and transitions
- ✅ **Key binding definitions**: Configurable key mappings with mode-specific behavior
- ✅ **Configuration management**: .tmaxrc file loading and execution
- ✅ **User interface logic**: Status line, command input, M-x functionality
- ✅ **Extensibility**: Custom functions, macros, and commands through T-Lisp
- ✅ **Standard library**: 31 built-in functions for comprehensive functionality
- ✅ **Macro system**: Full quasiquote support for code generation

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

#### Phase 4: Deno-ink UI Migration 🚧 PLANNED
**Purpose:** Migrate from manual ANSI escape sequences to declarative React-based UI

**Deliverables:**
- 🚧 **Deno-ink adapter**: Implements `FunctionalTerminalIO` interface using Deno-ink
- 🚧 **React component structure**: Editor, BufferView, StatusLine, CommandInput components
- 🚧 **State management**: React hooks bridging EditorState with T-Lisp API
- 🚧 **Test migration**: Adapt 131+ tests for React component rendering
- 🚧 **Performance parity**: Maintain or improve current rendering performance

**Success Criteria:**
- All existing features work with Deno-ink UI
- All 131+ tests pass after migration
- Performance is ≥ current manual rendering
- T-Lisp integration preserved (no API changes)

**See [SPEC-009](SPEC-009-migrate-ui-to-deno-ink.md) for detailed user stories and acceptance criteria**

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
- **Modern TypeScript architecture** on Deno runtime
- **Clean separation of concerns** between TypeScript core and T-Lisp
- **Efficient text editing** with gap buffer implementation
- **Proper error handling** with graceful degradation
- **Cross-platform compatibility** with key normalization
- **Professional documentation** with API reference and examples
- 🚧 **Deno-ink UI migration planned** for improved maintainability (36-52 hours)

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

## T-Lisp Keybinding System Status

The tmax editor includes a comprehensive specification for T-Lisp centric key bindings (see [`specs/tlisp-centric-keybindings.md`](tlisp-centric-keybindings.md)) but the implementation is currently only partially complete.

### Current Status - Functional but Violates Core Philosophy
- ✅ **Functional**: All key bindings work and execute T-Lisp commands
- ✅ **Runtime modification**: Can change key bindings through T-Lisp at runtime
- ✅ **T-Lisp integration**: (key-bind) function available and working
- ❌ **Philosophy violation**: Uses TypeScript Map instead of T-Lisp keymaps as the core data structure
- ❌ **Architectural gap**: Key binding logic split between TypeScript and T-Lisp instead of pure T-Lisp
- ❌ **Default bindings**: Hardcoded in TypeScript instead of pure T-Lisp files
- ❌ **Standard library**: Missing specialized keymap data types and manipulation functions

### Impact on Product Status
- **User Experience**: ✅ **No impact** - all key binding functionality works as expected
- **Developer Experience**: 🚧 **Partial** - customization works but doesn't follow the pure T-Lisp architecture
- **Specification Compliance**: ❌ **Incomplete** - does not fully implement the T-Lisp centric design
- **Extensibility**: 🚧 **Good but not optimal** - works but could be more T-Lisp native

### Completion Requirements
1. Create `src/tlisp/stdlib.ts` with hash-map/association-list data types
2. Implement T-Lisp keymap variables (e.g., `*normal-mode-keymap*`)
3. Create `src/tlisp/core-bindings.tlisp` with default key bindings
4. Refactor handleKey() to query T-Lisp environment instead of TypeScript Map
5. Move (key-bind) to pure T-Lisp implementation

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

### Current Implementation Gap

The current tmax implementation violates this philosophy by:
- Using TypeScript Map for key storage instead of T-Lisp keymaps
- Hardcoding default bindings in TypeScript instead of T-Lisp files
- Implementing (key-bind) as TypeScript built-in instead of pure T-Lisp

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

### Deno-ink UI Migration 🚧
**Reference:** [SPEC-009 - Migrate UI to Deno-ink](SPEC-009-migrate-ui-to-deno-ink.md)

**Purpose:** Improve code maintainability through declarative React-based UI components

**Timeline:** 36-52 hours

**Key Benefits:**
- Declarative component-based UI (vs. manual ANSI escape sequences)
- Improved maintainability with React patterns
- Enhanced testing with ink-testing-library
- Better layout capabilities with Flexbox (Yoga-powered)
- Built-in accessibility support

**Migration Approach:**
- Zero breaking changes to T-Lisp API (25+ functions)
- All 131+ tests must pass after migration
- Performance parity with current implementation
- Functional programming patterns preserved

**User Stories:** 12 comprehensive user stories with acceptance criteria (see SPEC-009)

**T-Lisp Keybinding Architecture: 🚧 PARTIALLY COMPLETE** (see [specification](SPEC-004-tlisp-core-bindings-migration.md) for full requirements)
- ✅ Core Neovim motions (hjkl, w/b/e, gg/G) - **COMPLETE**
- ✅ Basic commands (i, a, o, dd, yy, p) - **COMPLETE**
- [ ] Search functionality (/, n, N)
- [ ] Plugin loading system in T-Lisp

### Post-v1.0 Releases

#### v1.1.0 - Deno-ink UI Migration (Planned)
- 🚧 Migrate to React-based declarative UI using Deno-ink
- 🚧 Improve maintainability with component architecture
- 🚧 Enhanced testing with ink-testing-library
- **Timeline:** 36-52 hours (see [SPEC-009](SPEC-009-migrate-ui-to-deno-ink.md))

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
- **Deno-ink:** JSR package `@deno-ink/core` for React-based CLI UI
- **ink-testing-library:** npm package for testing React components
- **Deno 2.3.7+:** Runtime support for JSX compilation

## Out of Scope

Items that are explicitly not included in v1.1 Deno-ink migration:
- GUI components or web-based interfaces (terminal-only maintained)
- Breaking changes to T-Lisp API (zero breaking changes requirement)
- New editor features during UI migration (feature freeze during migration)
- Changes to T-Lisp interpreter or standard library

## Appendices

### Appendix A: Related Specifications
- [SPEC-009: Migrate UI to Deno-ink](SPEC-009-migrate-ui-to-deno-ink.md) - Complete migration plan with 12 user stories
- [SPEC-004: T-Lisp Core Bindings Migration](SPEC-004-tlisp-core-bindings-migration.md) - T-Lisp-centric keybinding architecture
- [functional-patterns-guidelines.md](../functional-patterns-guidelines.md) - Functional programming patterns used in codebase

### Appendix B: Technical Architecture
Current architecture uses manual ANSI escape sequences for terminal I/O. Migration to Deno-ink will:
- Replace manual rendering with declarative React components
- Maintain `FunctionalTerminalIO` interface for backward compatibility
- Preserve all functional programming patterns (TaskEither, functional interfaces)
- Keep T-Lisp interpreter and API completely unchanged

### Appendix C: Migration Timeline
**Total Estimated Time:** 36-52 hours

**Breakdown:**
- Story 1 (Deno-ink Adapter): 4-6 hours
- Story 2 (React Structure): 2-3 hours
- Story 3 (Buffer View): 3-5 hours
- Story 4 (Status Line): 2-3 hours
- Story 5 (Command Input): 2-3 hours
- Story 6 (State Management): 4-6 hours
- Story 7 (Editor Migration): 4-6 hours
- Story 8 (Test Migration): 4-6 hours
- Story 9 (Type System): 2-3 hours
- Story 10 (Performance): 3-5 hours
- Story 11 (Error Handling): 2-3 hours
- Story 12 (Documentation): 2-3 hours