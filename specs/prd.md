# Product Requirements Document (PRD)

## Executive Summary

**Product Name:** tmax  
**Version:** MVP 1.0  
**Date:** July 8, 2025  
**Author:** [Author Name]  

tmax is an extensible terminal-based text editor with a TypeScript core running on the Deno runtime. Following the Emacs architecture, TypeScript handles low-level operations (terminal I/O, file system, memory management, display rendering) while T-Lisp (tmax Lisp) handles all higher-level editor functionality including commands, modes, key bindings, and extensibility. The MVP delivers a terminal-only editor with Neovim-inspired key motions and Emacs-like extensibility through the T-Lisp interpreter.

## Problem Statement

### Current State
Developers currently face a choice between powerful but complex editors like Emacs, efficient modal editors like Neovim, or modern GUI editors that lack terminal integration. There's a gap for a modern, extensible terminal editor that combines the best aspects of both traditional approaches.

### Target Users
- **Primary Users:** Software developers who work primarily in terminal environments
- **Secondary Users:** System administrators, DevOps engineers, and power users who prefer keyboard-driven workflows

### Pain Points
- Steep learning curve for traditional editors like Emacs and Vim
- Limited extensibility in modern terminal editors
- Lack of modern language support and tooling integration
- Configuration complexity in existing editors

## Goals and Objectives

### Primary Goals
- Create a terminal-based editor with intuitive Neovim-style key motions
- Implement Emacs-like extensibility through T-Lisp (tmax Lisp) interpreter
- Deliver a modern TypeScript codebase running on Deno for better performance and security

### Secondary Goals
- Establish a foundation for future GUI integration
- Create a plugin ecosystem for community contributions
- Provide seamless integration with modern development workflows

## Success Metrics

### Key Performance Indicators (KPIs)
- **Metric 1:** [Description and target]
- **Metric 2:** [Description and target]
- **Metric 3:** [Description and target]

### Success Criteria
- Criteria 1
- Criteria 2
- Criteria 3

## User Stories and Requirements

### Epic 1: Core Editor Functionality
**As a** developer  
**I want** basic text editing capabilities with modal interface  
**So that** I can efficiently edit code files in the terminal

#### Acceptance Criteria
- [ ] Normal, insert, and visual modes
- [ ] Basic cursor movement (h, j, k, l)
- [ ] Text insertion and deletion
- [ ] File open/save operations
- [ ] Basic search functionality

### Epic 2: Neovim-Compatible Motions
**As a** Neovim user  
**I want** familiar key bindings and motions  
**So that** I can use tmax without learning new keybindings

#### Acceptance Criteria
- [ ] Word-wise movement (w, b, e)
- [ ] Line-wise operations (dd, yy, p)
- [ ] Text objects (ciw, daw, etc.)
- [ ] Jump commands (gg, G, :line_number)
- [ ] Visual selection modes

### Epic 3: T-Lisp Extensibility System
**As a** power user  
**I want** to extend the editor with T-Lisp code  
**So that** I can customize all aspects of the editor's behavior

#### Acceptance Criteria
- [ ] T-Lisp interpreter implementation
- [ ] Built-in T-Lisp standard library
- [ ] T-Lisp macro definition and execution
- [ ] Plugin system using T-Lisp
- [ ] Configuration system in T-Lisp
- [ ] Interactive T-Lisp REPL

## Technical Requirements

### Functional Requirements
- Modal editing with Neovim-compatible key bindings
- File operations (open, save, create, delete)
- Basic text editing operations (insert, delete, copy, paste)
- Search and replace functionality
- Syntax highlighting for common programming languages
- Extensible macro system using T-Lisp (tmax Lisp) interpreter
- Command palette for discoverable actions

### Non-Functional Requirements
- **Performance:** Fast startup time (<100ms), responsive editing for files up to 1GB with lazy loading
- **Security:** Secure plugin execution, sandboxed macro environment
- **Scalability:** Support for multiple buffers and windows
- **Reliability:** Crash recovery, auto-save functionality
- **Usability:** Intuitive key bindings, comprehensive help system

### Technical Constraints
- Must run on Deno runtime (no Node.js dependencies)
- Terminal-only interface (no GUI components)
- TypeScript core for low-level operations only
- T-Lisp interpreter for all higher-level functionality
- Cross-platform compatibility (Linux, macOS, Windows)

### Architecture Overview
**TypeScript Core Responsibilities:**
- Terminal I/O and display rendering
- File system operations
- Memory management
- T-Lisp interpreter runtime
- **Neovim-style buffer management:**
  - Gap buffer and rope data structures for efficient text manipulation
  - Lazy loading for large files (GB+ sizes)
  - Asynchronous text operations
  - Optimized memory usage for large file editing
  - Rich text manipulation APIs exposed to T-Lisp

**T-Lisp Engine Responsibilities:**
- All editor commands and modes
- Key binding definitions
- Syntax highlighting
- Search and replace algorithms (using TypeScript buffer APIs)
- Plugin system
- Configuration management
- User interface logic
- **Emacs-style extensibility:**
  - Rich text properties and overlays
  - Powerful buffer manipulation through APIs
  - Granular undo/redo system

## Implementation Roadmap

### MVP Release (v0.1.0) - 12 Weeks
**Goal:** Functional terminal editor with basic T-Lisp extensibility

#### Phase 1: Core Infrastructure (Weeks 1-4)
**Deliverables:**
- [ ] Terminal I/O system with cursor control
- [ ] File system operations (open, save, create)
- [ ] Neovim-style text buffer implementation (gap buffer/rope data structures)
- [ ] Lazy loading system for large files
- [ ] Asynchronous text operations
- [ ] Memory management optimized for large file editing
- [ ] Rich text manipulation APIs for T-Lisp
- [ ] T-Lisp interpreter foundation (parser scaffolding)

**Success Criteria:** Can open, edit, and save text files in terminal

#### Phase 2: T-Lisp Engine (Weeks 5-8)
**Deliverables:**
- [ ] T-Lisp tokenizer and parser
- [ ] Core evaluation engine with basic data types
- [ ] Standard library (list operations, string manipulation)
- [ ] Macro system and special forms
- [ ] Interactive REPL for T-Lisp development

**Success Criteria:** Can execute T-Lisp code and define custom functions

#### Phase 3: Modal Editor (Weeks 9-12)
**Deliverables:**
- [ ] Modal editing system implemented in T-Lisp
- [ ] Core Neovim motions (hjkl, w/b/e, gg/G)
- [ ] Basic commands (i, a, o, dd, yy, p)
- [ ] Search functionality (/, n, N)
- [ ] Plugin loading system in T-Lisp

**Success Criteria:** Usable for basic text editing with familiar key bindings

### Post-MVP Releases

#### v0.2.0 - Enhanced Editing (Weeks 13-16)
- Advanced text objects (ciw, daw, etc.)
- Visual selection modes
- Syntax highlighting framework
- Buffer management (multiple files)
- Basic configuration system

#### v0.3.0 - Extensibility (Weeks 17-20)
- Plugin ecosystem foundation
- Advanced T-Lisp features
- Custom key binding system
- Macro recording/playback
- Performance optimizations

#### v1.0.0 - Production Ready (Weeks 21-24)
- Complete Neovim motion compatibility
- Comprehensive T-Lisp standard library
- Documentation and tutorials
- Performance benchmarks
- Community plugin examples

### Dependencies and Blockers
- **Week 4:** T-Lisp parser must be complete before Phase 2
- **Week 8:** Core T-Lisp runtime required before modal system
- **Week 10:** Modal foundation needed for key bindings
- **External:** Deno runtime stability for TypeScript performance

## Risks and Assumptions

### Risks
- **Risk 1:** [Description] - *Mitigation Strategy*
- **Risk 2:** [Description] - *Mitigation Strategy*
- **Risk 3:** [Description] - *Mitigation Strategy*

### Assumptions
- Assumption 1
- Assumption 2
- Assumption 3

## Dependencies

### Internal Dependencies
- Dependency 1
- Dependency 2

### External Dependencies
- Dependency 1
- Dependency 2

## Out of Scope

Items that are explicitly not included in this version:
- Item 1
- Item 2
- Item 3

## Appendices

### Appendix A: Wireframes/Mockups
[Link to design documents]

### Appendix B: Technical Architecture
[Link to technical documentation]

### Appendix C: Research and Analysis
[Link to user research, market analysis, etc.]