# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**tmax** is an extensible terminal-based text editor with a TypeScript core running on the Deno runtime. Following the Emacs architecture, TypeScript handles low-level operations (terminal I/O, file system, memory management, display rendering) while T-Lisp (tmax Lisp) handles all higher-level editor functionality including commands, modes, key bindings, and extensibility.

**Key Features:**
- Terminal-only editor with Neovim-inspired key motions
- Emacs-like extensibility through T-Lisp interpreter
- Neovim-style buffer management for efficient large file editing
- Cross-platform compatibility (Linux, macOS, Windows)
- Plugin system using T-Lisp

**Target Users:** Software developers, system administrators, and power users who prefer keyboard-driven terminal workflows.

## Development Guidelines

### General Instructions
- Every time you choose to apply a rule(s), explicitly state the rule(s) in the output. You can abbreviate the rule description to a single word or phrase
- Always follow a Test-Driven Development workflow
- Functional programming should be used wherever possible
- All functions and classes should have JS Doc comments
- Use arrow functions
- Use deno 2.3.7
- Write simple, verbose code over terse, dense code
- Use the standard library where possible. Avoid using external dependencies unless otherwise stated
- Terminal-only interface (no GUI components)
- Implement Neovim-style buffer management (gap buffer/rope data structures)
- T-Lisp interpreter for all higher-level functionality
- No external dependencies beyond Deno standard library

### Code Style
- Prefer arrow functions
- Include JSDoc comments for all functions
- Use TypeScript throughout


### Task Management
- The purpose of `TODO.md` is to manage and display the progress of implementing the given spec
- When a feature from `TODO.md` is implemented and verified, update its status in `TODO.md` to `[x]`
- TODO.md tasks are marked complete ([x]) only after code is implemented and successfully verified through testing
- During implementation, `TODO.md` should be updated in real time for proper tracking
- Test should be created before code
- When implementing from a spec, use `TODO.md` to show and manage the plan

### Testing Strategy
- Always follow a Test-Driven Development workflow. Create and run test before code implementation
- Use 'deno task test' for testing
- All unit and integration tests should be placed directly in the `test` directory
- All API endpoints should have test
- Aim for high test coverage, especially for core logic
- Tests should be isolated and repeatable
- Use clear and descriptive names for test files and test cases
- Do not mock data
- Follow Test-Driven Development (TDD)
- Tests in `test/` directory
- Unit tests for utils and database operations
- Integration tests for API endpoints
- UI tests using Puppeteer (note: can be flaky)
- Use `TODO.md` to track implementation progress

### Error Handling
- All errors logged via centralized logger
- Different log levels based on error type
## Development Commands

### Running the Application
```bash
deno task start
```
The editor runs in the terminal.

### Testing
```bash
# Run all tests
deno task test

# Run tests excluding UI tests (faster)
deno task test:fast

# Run a specific test file
deno task test:file test/buffer.test.ts
```

## Architecture Overview

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

**Development Phases:**
- **Phase 1 (Weeks 1-4):** TypeScript core infrastructure and T-Lisp foundation
- **Phase 2 (Weeks 5-8):** T-Lisp interpreter implementation
- **Phase 3 (Weeks 9-12):** Modal editor functionality in T-Lisp




## Configuration


## Common Tasks

