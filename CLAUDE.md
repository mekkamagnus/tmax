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

### Functional Patterns
- **Task-Based Operations**: Wrap all operations in task objects that can be composed and chained
- **Favor Task Over Promises**: Use Task instead of Promise for lazy evaluation and better error handling
- **TaskEither for Error Handling**: Use TaskEither utility for combining lazy evaluation with explicit error types
- **TryCatch Error Handling**: Use `tryCatch` methods for safe error handling without throwing exceptions
- **Immutable State**: Prefer immutable data structures and pure functions
- **Function Composition**: Chain operations using compose/pipe patterns
- **Composition Over Inheritance**: Favor object composition over class inheritance for flexibility and testability
- **Result Types**: Return Result<T, E> objects instead of throwing exceptions
- **Option Types**: Use Option<T> for nullable values instead of null/undefined checks

#### Task vs Promise Examples
```typescript
// ❌ AVOID: Promise-based approach (eager evaluation, uncaught errors)
const loadFilePromise = async (path: string): Promise<string> => {
  try {
    return await Deno.readTextFile(path); // Executes immediately
  } catch (error) {
    throw new Error(`Failed to load file: ${error.message}`); // Can be uncaught
  }
};

// ✅ PREFER: Task-based approach (lazy evaluation, safe error handling)
const loadFileTask = (path: string) => Task.of(() => 
  Deno.readTextFile(path) // Only executes when run
).tryCatch(error => 
  `Failed to load file: ${error.message}` // Always caught
);
```

#### Task Pattern Examples
```typescript
// File operations using task pattern with tryCatch
const processFileTask = (path: string) => 
  loadFileTask(path)
    .map(content => content.split('\n'))
    .map(lines => lines.filter(line => line.trim().length > 0))
    .tryCatch(error => 
      `Failed to process file: ${error}`
    );

// Terminal operations with safe error handling
const terminalWriteTask = (text: string) => Task.of(() =>
  terminal.write(text)
).tryCatch(error => 
  `Terminal write failed: ${error.message}`
);

// Task composition for complex operations
const saveBufferTask = (buffer: Buffer) => 
  validateBufferTask(buffer)
    .andThen(() => backupFileTask(buffer.path))
    .andThen(() => writeFileTask(buffer.path, buffer.content))
    .tryCatch(error => `Save failed: ${error}`);
```

#### TaskEither Pattern Examples
```typescript
// Import the TaskEither utility
import { TaskEither, TaskEitherUtils } from "../src/utils/task-either.ts";

// File operations with explicit error types
const loadConfigTask = (path: string): TaskEither<string, Config> =>
  TaskEitherUtils.readFile(path)
    .flatMap(content => TaskEitherUtils.parseJSON<Config>(content))
    .mapLeft(error => `Config load failed: ${error}`);

// Composing operations with error handling
const saveWithBackupTask = (path: string, content: string) =>
  TaskEitherUtils.readFile(path)
    .flatMap(current => TaskEitherUtils.writeFile(`${path}.backup`, current))
    .flatMap(() => TaskEitherUtils.writeFile(path, content))
    .map(() => ({ saved: true, backupCreated: true }))
    .mapLeft(error => `Save operation failed: ${error}`);

// Parallel operations with TaskEither
const loadProjectTask = (projectPath: string) => {
  const configFile = TaskEitherUtils.readFile(`${projectPath}/config.json`);
  const mainFile = TaskEitherUtils.readFile(`${projectPath}/main.ts`);
  
  return TaskEither.parallel([configFile, mainFile])
    .map(([config, main]) => ({ config: JSON.parse(config), main }));
};

// Retry operations with exponential backoff
const saveWithRetryTask = (path: string, content: string) =>
  TaskEitherUtils.retry(
    () => TaskEitherUtils.writeFile(path, content),
    3, // max attempts
    1000 // delay ms
  );
```

#### Result Pattern Examples
```typescript
// Function that returns Result instead of throwing
const parseConfig = (content: string): Result<Config, string> => {
  try {
    const parsed = JSON.parse(content);
    return Result.ok(parsed);
  } catch (error) {
    return Result.error(`Invalid JSON: ${error.message}`);
  }
};

// Chaining operations with Result
const loadAndParseConfig = (path: string): Result<Config, string> =>
  loadFileTask(path)
    .toResult()
    .andThen(parseConfig)
    .mapError(error => `Config loading failed: ${error}`);
```

### Error Handling
- **Task-based**: Use Task.tryCatch() for operations that may fail
- **Result types**: Return Result<T, E> instead of throwing exceptions  
- **Option types**: Use Option<T> for potentially missing values
- **Centralized logging**: All errors logged via centralized logger
- **Different log levels**: Based on error type and severity
- **Graceful degradation**: User feedback with recovery options

## Development Commands

### Running the Application
```bash
# Start editor in normal mode (clean output)
deno task start [filename]

# Start editor in development mode (verbose logging)
deno task start --dev [filename]

# Start with auto-reload for development
deno task dev

# Run T-Lisp REPL
deno task repl
```

#### Operating Modes
The editor has two distinct operating modes with different logging behaviors:

**Normal Mode** (default):
- Clean terminal output optimized for user experience
- Logging level: ERROR only (critical errors)
- Simple message format without emojis or colors
- No stack traces to avoid terminal interference
- Ideal for regular editing sessions

**Development Mode** (`--dev` flag):
- Verbose logging for debugging and AI development assistance
- Logging level: DEBUG (comprehensive output)
- AI-friendly formatting with emojis, colors, and structured data
- Full stack traces and correlation IDs for troubleshooting
- Detailed operation tracking for all terminal and editor operations
- Bypasses TTY checks for non-interactive environments (Claude Code, etc.)

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