# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**tmax** is a comprehensive extensible terminal-based text editor with a TypeScript core running on the Deno runtime. Following the Emacs architecture, TypeScript handles low-level operations (terminal I/O, file system, memory management, display rendering) while T-Lisp (tmax Lisp) handles all higher-level editor functionality including commands, modes, key bindings, and extensibility.

**Current Status: ✅ COMPLETE AND FUNCTIONAL**

**Key Features:**
- **Full-screen modal editing** with alternate screen buffer and viewport management
- **Complete T-Lisp interpreter** with tail-call optimization and macro system
- **Five editing modes**: normal, insert, visual, command, and M-x
- **Vim-like key bindings** with proper hjkl navigation
- **Command interface** with both vim-style (:q, :w) and M-x (SPC ;) commands
- **Multiple buffer management** with gap buffer implementation
- **Comprehensive editor API** (25+ T-Lisp functions)
- **Zero external dependencies**

**Target Users:** Software developers, system administrators, and power users who prefer keyboard-driven terminal workflows with unlimited customization through T-Lisp.

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

### Testing Strategy
- Always follow a Test-Driven Development workflow. Create and run test before code implementation
- Use 'deno task test' for testing
- All unit and integration tests should be placed directly in the `test` directory
- Aim for high test coverage, especially for core logic
- Tests should be isolated and repeatable
- Use clear and descriptive names for test files and test cases
- Follow Test-Driven Development (TDD)
- **Current test coverage**: 131 tests across 8 comprehensive test suites

### Error Handling
- All errors logged via centralized logger
- Different log levels based on error type
- Graceful degradation with user feedback

## Development Commands

### Running the Application
```bash
# Start editor
deno task start [filename]

# Start with auto-reload for development
deno task dev

# Run T-Lisp REPL
deno task repl
```

### Testing
```bash
# Run all tests (131 tests across 8 suites)
deno task test

# Run specific test suites
deno test test/unit/tokenizer.test.ts
deno test test/unit/parser.test.ts
deno test test/unit/evaluator.test.ts
deno test test/unit/editor.test.ts
```

## Architecture Overview

**TypeScript Core Responsibilities:**
- **Terminal I/O**: Full-screen interface with alternate screen buffer
- **File system operations**: Async file reading/writing with proper error handling
- **Memory management**: Efficient buffer operations and cursor tracking
- **T-Lisp interpreter runtime**: Complete interpreter with tail-call optimization
- **Buffer management**: Gap buffer implementation for efficient text editing
- **Viewport management**: Scrolling and cursor positioning for large files
- **Key handling**: Raw mode input with proper key normalization

**T-Lisp Engine Responsibilities:**
- **Editor commands**: All functionality exposed through T-Lisp API
- **Mode management**: Modal editing state and transitions
- **Key binding definitions**: Configurable key mappings
- **User interface logic**: Status line, command input, M-x functionality
- **Configuration management**: .tmaxrc file loading and execution
- **Extensibility**: Custom functions, macros, and commands

**Implementation Status:**
- **✅ Phase 1 Complete**: TypeScript core infrastructure and T-Lisp foundation
- **✅ Phase 2 Complete**: T-Lisp interpreter implementation with stdlib and macros
- **✅ Phase 3 Complete**: Modal editor functionality with full-screen interface
- **✅ Additional Features**: Command mode, M-x functionality, proper exit handling

## Key Components

### T-Lisp Interpreter
- **Tokenizer**: Lexical analysis with quasiquote support
- **Parser**: AST generation with proper error handling
- **Evaluator**: Expression evaluation with lexical scoping and tail-call optimization
- **Standard Library**: 31 built-in functions (arithmetic, lists, strings, control flow)
- **Macro System**: Full quasiquote support with compile-time expansion
- **Environment**: Lexical scoping with environment chains

### Editor Interface
- **Modal System**: Five modes (normal, insert, visual, command, mx)
- **Key Bindings**: Configurable mappings with mode-specific behavior
- **Buffer Management**: Multiple buffers with gap buffer implementation
- **Viewport**: Scrolling and cursor management for large files
- **Terminal Interface**: Raw mode with ANSI escape sequences

### Editor API (T-Lisp Functions)
- **Buffer Operations**: create, switch, insert, delete, text access
- **Cursor Management**: move, position queries with bounds checking
- **Mode Control**: get/set editor modes
- **Status Management**: status line updates and user feedback
- **File Operations**: handled through editor commands
- **M-x System**: Function execution by name

## Usage Examples

### Basic Editing
```bash
# Start editor
deno task start

# Basic commands:
# i - enter insert mode
# Escape - return to normal mode
# hjkl - navigate
# q - quit
# : - enter command mode
# SPC ; - enter M-x mode
```

### T-Lisp Customization
```lisp
;; ~/.tmaxrc configuration file
(defun word-count ()
  (let ((text (buffer-text)))
    (length (split-string text " "))))

(key-bind "w" "(cursor-move (+ (cursor-line) 5) (cursor-column))" "normal")

(defmacro save-and-quit ()
  '(progn (quick-save) (editor-quit)))
```

### M-x Commands
```
SPC ;           # Enter M-x mode
cursor-position # Show cursor position
editor-mode     # Show current mode
quit           # Quit editor
```

## Project Structure
```
tmax/
├── src/
│   ├── core/           # TypeScript core (terminal, filesystem, buffer)
│   ├── tlisp/          # T-Lisp interpreter
│   ├── editor/         # Editor with T-Lisp integration
│   └── main.ts         # Application entry point
├── test/               # Comprehensive test suite (131 tests)
├── scripts/            # Development scripts (REPL)
├── examples/           # Configuration examples
└── bin/                # Launcher script
```

## Common Tasks

### Adding New T-Lisp Functions
1. Add function to `src/editor/tlisp-api.ts`
2. Update interface types if needed
3. Add tests in `test/unit/editor.test.ts`
4. Update documentation

### Adding New Key Bindings
1. Add binding in `src/editor/editor.ts` (initializeDefaultKeyMappings)
2. Create corresponding T-Lisp function if needed
3. Test key handling behavior

### Extending Editor Modes
1. Update mode type in `src/editor/tlisp-api.ts`
2. Add mode-specific key handling
3. Update status line rendering
4. Add cursor positioning logic

The editor is complete and functional with all major features implemented and thoroughly tested.