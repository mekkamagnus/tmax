# tmax - An Extensible Terminal Editor

tmax is an extensible terminal-based text editor written in TypeScript, running on the Bun runtime with React/ink for the terminal UI. It features modal editing (inspired by Neovim) with Emacs-like extensibility through T-Lisp (tmax Lisp).

## Architecture

- **TypeScript Core**: Handles low-level operations (terminal I/O, file system, buffer management)
- **T-Lisp Engine**: Handles high-level editor functionality and user customization
- **Modal Interface**: Supports normal, insert, visual, and command modes
- **React-based UI**: Modern declarative UI using ink for terminal React components
- **Extensible**: Users can customize behavior through T-Lisp scripts

## Features

### Core Functionality
- ✅ Modal editing with vim-like key bindings
- ✅ Multiple buffer support
- ✅ File operations (open, save, create)
- ✅ Cursor movement and text editing
- ✅ Configurable key bindings
- ✅ Status line with mode and cursor position
- ✅ Full-screen terminal interface with alternate screen buffer

### T-Lisp Integration
- ✅ Full Lisp interpreter with standard library
- ✅ Macro system with quasiquote support
- ✅ Tail-call optimization
- ✅ Interactive REPL for testing
- ✅ Comprehensive editor API (25+ functions)

### T-Lisp Features
- **Special Forms**: `quote`, `if`, `let`, `lambda`, `defun`, `defmacro`
- **Quasiquote**: `` ` ``, `,`, `,@` for macro metaprogramming
- **Standard Library**: 31 built-in functions
- **Tail Recursion**: Optimized recursive function calls
- **Error Handling**: Comprehensive error messages

## Installation

### Prerequisites
- [Bun](https://bun.sh/) v1.0 or later

### Setup
```bash
# Clone the repository
git clone https://github.com/mekkamagnus/tmax.git
cd tmax

# Install dependencies
bun install

# Make the launcher executable (optional)
chmod +x bin/tmax

# Optional: Add to PATH
echo 'export PATH="$PATH:$(pwd)/bin"' >> ~/.bashrc
source ~/.bashrc
```

## Usage

### Basic Usage
```bash
# Start tmax with a new buffer
bun run src/main.tsx

# Start tmax with a file
bun run src/main.tsx filename.txt

# Start with auto-reload during development
bun run dev

# Or use npm scripts
npm start
npm run dev
```

### First Time Usage

1. **Enter insert mode**: Press `i` to start typing
2. **Return to normal mode**: Press `Escape`
3. **Save and quit**: Press `:` then type `wq` and press `Enter`
4. **Just quit**: Press `q` in normal mode
5. **Use M-x**: Press `SPC` then `;` to execute T-Lisp functions

### Advanced Usage

- **Command mode**: Press `:` for vim-style commands
- **M-x mode**: Press `SPC ;` to execute T-Lisp functions by name
- **Multiple buffers**: Use `:e filename` to open additional files
- **Customization**: Create `~/.tmaxrc` with T-Lisp configuration

### Key Bindings (Default)

#### Normal Mode
- `h`, `j`, `k`, `l` - Move cursor left, down, up, right
- `i` - Enter insert mode
- `:` - Enter command mode
- `q` - Quit editor

#### Insert Mode
- `Escape` - Return to normal mode
- `Backspace` - Delete character before cursor
- `Enter` - Insert newline
- Any printable character - Insert at cursor

### T-Lisp REPL
```bash
# Run the T-Lisp REPL for testing
bun run scripts/repl.ts

# Or use npm script
npm run repl
```

## Configuration

Create a `.tmaxrc` file in your home directory to customize tmax:

```lisp
;; Custom key bindings
(key-bind "w" "(cursor-move (+ (cursor-line) 5) (cursor-column))" "normal")
(key-bind "b" "(cursor-move (- (cursor-line) 5) (cursor-column))" "normal")

;; Custom macros
(defmacro save-and-quit ()
  '(progn
     (file-write (buffer-current) (buffer-text))
     (editor-quit)))

;; Custom commands
(defun center-cursor ()
  (let ((line-count (buffer-line-count))
        (center-line (/ line-count 2)))
    (cursor-move center-line 0)))

(key-bind "zz" "(center-cursor)" "normal")
```

## T-Lisp Editor API

### Buffer Management
- `(buffer-create name)` - Create new buffer
- `(buffer-switch name)` - Switch to buffer
- `(buffer-current)` - Get current buffer name
- `(buffer-list)` - List all buffers
- `(buffer-text)` - Get buffer content
- `(buffer-line [n])` - Get line content
- `(buffer-line-count)` - Get number of lines

### Cursor Operations
- `(cursor-position)` - Get cursor position as [line, column]
- `(cursor-move line column)` - Move cursor to position
- `(cursor-line)` - Get current line number
- `(cursor-column)` - Get current column number

### Text Editing
- `(buffer-insert text)` - Insert text at cursor
- `(buffer-delete count)` - Delete characters at cursor

### Mode Management
- `(editor-mode)` - Get current mode
- `(editor-set-mode mode)` - Set editor mode
- `(editor-status)` - Get status message
- `(editor-set-status message)` - Set status message

### File Operations
- `(file-read filename)` - Read file content
- `(file-write filename content)` - Write file content

### Key Bindings
- `(key-bind key command [mode])` - Bind key to command
- `(execute-command command)` - Execute T-Lisp command

## Development

### Project Structure
```
tmax/
├── src/
│   ├── core/           # TypeScript core (terminal, filesystem, buffer)
│   ├── tlisp/          # T-Lisp interpreter implementation
│   ├── editor/         # Editor implementation with T-Lisp API
│   └── main.ts         # Application entry point
├── test/
│   ├── unit/           # Unit tests
│   └── mocks/          # Mock implementations
├── scripts/
│   └── repl.ts         # T-Lisp REPL
└── bin/
    └── tmax            # Launcher script
```

### Available Scripts
```bash
# Development
bun run src/main.tsx     # Start the editor
bun run dev              # Start with auto-reload
bun run repl             # Run T-Lisp REPL

# Testing
bun test                 # Run all tests
bun run test:ui         # Run UI tests

# Building
bun run build           # Build for production
```

### T-Lisp Examples

#### Basic Operations
```lisp
;; Arithmetic
(+ 1 2 3)                    ; => 6
(* (+ 2 3) (- 10 5))        ; => 25

;; String operations
(length "hello")             ; => 5
(substring "hello" 1 3)      ; => "el"
(string-append "hello" " " "world")  ; => "hello world"

;; List operations
(car '(1 2 3))              ; => 1
(cdr '(1 2 3))              ; => (2 3)
(append '(1 2) '(3 4))      ; => (1 2 3 4)
```

#### Functions and Macros
```lisp
;; Function definition
(defun factorial (n)
  (if (= n 0)
    1
    (* n (factorial (- n 1)))))

(factorial 5)               ; => 120

;; Macro definition
(defmacro when (condition body)
  `(if ,condition ,body nil))

(when t "executed")         ; => "executed"
```

#### Editor Customization
```lisp
;; Custom movement command
(defun goto-beginning ()
  (cursor-move 0 0))

;; Smart line insertion
(defun insert-line-above ()
  (let ((current-line (cursor-line)))
    (cursor-move current-line 0)
    (buffer-insert "\\n")
    (cursor-move current-line 0)))

;; Word count function
(defun word-count ()
  (let ((text (buffer-text)))
    (length (split-string text " "))))
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `bun test`
5. Submit a pull request

## License

MIT License - see LICENSE file for details.



## Roadmap

### Immediate Priority
- [x] Complete T-Lisp centric key binding system

### Phase 1: Enhanced Editing (v0.2.0)
- [ ] Visual mode selection
- [ ] Search and replace
- [ ] Undo/redo system
- [ ] Plugin system
- [ ] Configuration management
- [ ] Syntax highlighting
- [ ] Multiple windows/panes
- [ ] LSP integration

## Design Philosophy

tmax follows the principle of "powerful core, extensible surface". The TypeScript core provides efficient, low-level operations while T-Lisp provides unlimited customization possibilities. This architecture allows users to:

- Customize editor behavior without recompiling
- Create complex macros and commands
- Share configurations as T-Lisp scripts
- Extend functionality through a consistent API

The editor is designed to be both approachable for beginners and powerful for advanced users who want to craft their perfect editing environment.

For more information on the functional patterns used in tmax, see the [Functional Programming Guidelines](./functional-patterns-guidelines.md).

## Deno-ink Migration

tmax has been migrated to use Deno-ink for React-based terminal UI components. This provides a modern, declarative approach to terminal UI development while maintaining the functional patterns of the core editor.

### React Component Architecture
- **Editor Component**: Main component orchestrating the UI with state management
- **BufferView Component**: Displays buffer content with viewport management
- **StatusLine Component**: Shows editor mode, cursor position, and status messages
- **CommandInput Component**: Handles command mode and M-x mode input
- **useEditorState Hook**: Manages editor state with T-Lisp integration

### Benefits of React-based UI
- Declarative UI rendering that's easier to maintain
- Better component composition and reusability
- Improved performance through virtual DOM and efficient updates
- Easier testing with component-based architecture
- Seamless integration with T-Lisp functionality

