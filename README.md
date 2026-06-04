# tmax - An Extensible Terminal Editor

tmax is an extensible terminal-based text editor written in TypeScript, running on the Bun runtime. It follows the Emacs architecture: a T-Lisp interpreter (like Emacs Lisp) handles all editor functionality, with vim-style key bindings as the user interface layer.

The daemon/client architecture mirrors Emacs (`tmax --daemon` / `tmaxclient`), supporting multiple TUI frames sharing the same buffers and interpreter. A built-in `*Messages*` buffer provides observability for both users and AI agents.

> **Note:** tmax is currently in development (v0.2.0). Features and APIs may change. Feedback and contributions are welcome!

## Architecture

- **TypeScript Core**: Handles low-level operations (terminal I/O, file system, buffer management)
- **T-Lisp Engine**: Handles high-level editor functionality and user customization
- **Modal Interface**: Supports normal, insert, visual, command, and M-x modes
- **Daemon/Client**: Emacs-style daemon with multiple TUI frames sharing state
- **Interchangeable Frontends**: TUI (ANSI), Ink (React), or Steep — same editor core
- **Extensible**: Users can customize behavior through T-Lisp scripts

## Features

### Core Functionality
- ✅ Modal editing with vim-like key bindings (hjkl navigation)
- ✅ Five editing modes: normal, insert, visual, command, and M-x
- ✅ Multiple buffer support with gap buffer implementation
- ✅ File operations (open, save, create)
- ✅ Cursor movement and text editing with word/line navigation
- ✅ Delete, yank, change, and put operators
- ✅ Visual mode selection with text objects
- ✅ Search forward/backward with word-under-cursor search
- ✅ Undo/redo with count prefix support
- ✅ Configurable key bindings with which-key popup
- ✅ Status line with mode and cursor position
- ✅ Full-screen terminal interface with alternate screen buffer
- ✅ `*Messages*` buffer for event logging and observability

### Daemon/Client Architecture
- ✅ Emacs-style daemon (`tmax --daemon`) with Unix socket RPC
- ✅ Frame-based multi-client support (independent viewports, shared buffers)
- ✅ TUI client with 200ms state polling
- ✅ CLI client for eval, insert, buffers, ping, messages queries
- ✅ Unified `tmax` CLI with auto-daemon-start
- ✅ AI agent control via JSON-RPC 2.0 protocol

### T-Lisp Integration
- ✅ Full Lisp interpreter with standard library
- ✅ Macro system with quasiquote support
- ✅ Tail-call optimization
- ✅ Interactive REPL for testing
- ✅ Comprehensive editor API (100+ functions)
- ✅ Kill ring with yank-pop cycling
- ✅ Macro recording and playback
- ✅ Fuzzy command completion in M-x
- ✅ Help system (describe-key, describe-function, apropos-command)
- ✅ Plugin loading and repository system

### T-Lisp Features
- **Special Forms**: `quote`, `if`, `let`, `lambda`, `defun`, `defmacro`
- **Quasiquote**: `` ` ``, `,`, `,@` for macro metaprogramming
- **Standard Library**: 31 built-in functions
- **Tail Recursion**: Optimized recursive function calls
- **Error Handling**: Comprehensive error messages

## Installation

### Prerequisites
- [Bun](https://bun.sh/) runtime

### Setup
```bash
# Clone the repository
git clone https://github.com/mekkamagnus/tmax.git
cd tmax

# Install dependencies
bun install

# Make the launcher executable
chmod +x bin/tmax

# Add to PATH
echo 'export PATH="$PATH:$(pwd)/bin"' >> ~/.bashrc
source ~/.bashrc
```

## Usage

### Daemon/Client (Recommended)
```bash
# Start tmax with a file (auto-starts daemon if needed)
tmax filename.txt

# Start daemon only (no TUI)
tmax --daemon

# Evaluate T-Lisp on the daemon
tmax -e '(+ 1 2)'

# Stop the daemon
tmax --stop
```

### Client Commands
```bash
tmaxclient file.txt           # Open file in daemon
tmaxclient --eval '(code)'    # Evaluate T-Lisp
tmaxclient --list-buffers     # List open buffers
tmaxclient --messages         # Show *Messages* buffer
tmaxclient --ping             # Check if daemon running
tmaxclient --status --json    # Structured daemon/client/frame status
tmaxclient --clients --json   # Connected client metadata
tmaxclient --frames --json    # Connected TUI frame metadata
tmaxclient --tui              # Launch TUI client
```

### Direct Editing (No Daemon)
```bash
# Run editor directly (no daemon)
bun run start filename.txt

# Development mode with auto-reload
bun run dev
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
- **Customization**: Create `~/.config/tmax/init.tlisp` with T-Lisp configuration

### Key Bindings (Default)

#### Normal Mode
- `h`, `j`, `k`, `l` - Move cursor left, down, up, right
- `w`, `b`, `e` - Word forward, backward, end of word
- `0`, `$` - Line start, line end
- `gg`, `G` - Jump to top, jump to bottom
- `i` - Enter insert mode
- `v` - Enter visual mode
- `:` - Enter command mode
- `SPC ;` - Enter M-x mode
- `dd` - Delete line, `yy` - Yank line, `p` - Put
- `x` - Delete character, `u` - Undo, `C-r` - Redo
- `/` - Search forward, `n` - Next match
- `q` - Quit editor

#### Insert Mode
- `Escape` - Return to normal mode
- `Backspace` - Delete character before cursor
- `Enter` - Insert newline
- Any printable character - Insert at cursor

### T-Lisp REPL
```bash
# Run the T-Lisp REPL for testing
bun run repl
```

## Configuration

Create an `init.tlisp` file in `~/.config/tmax/` to customize tmax:

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

### Init File Features

**Reload Configuration**:
- Use `M-x: (eval-init-file)` to reload your init file without restarting
- Useful for testing configuration changes

**Evaluate Buffer**:
- Use `M-x: (eval-buffer)` to evaluate the current buffer as T-Lisp code
- Perfect for testing functions and key bindings without saving
- Works great with the `*scratch*` buffer

**Custom Init File**:
- Use `--init-file` flag to load a custom configuration:
  ```bash
  tmax --init-file ./my-config.tlisp
  ```
- Use `/dev/null` to disable init file loading:
  ```bash
  tmax --init-file /dev/null
  ```

**Query Init File**:
- `(init-file-path)` - Returns the path to the current init file

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
│   ├── editor/         # Editor with T-Lisp API, handlers, operations
│   ├── server/         # Daemon (JSON-RPC 2.0 over Unix socket)
│   ├── client/         # TUI client (ANSI rendering)
│   ├── frontend/       # Interchangeable frontends (Ink, Steep)
│   └── main.tsx        # Application entry point
├── test/
│   ├── unit/           # Unit tests
│   ├── ui/             # UI tests (tmux harness)
│   └── mocks/          # Mock implementations
├── scripts/
│   └── repl.ts         # T-Lisp REPL
└── bin/
    ├── tmax            # Unified CLI (daemon/client)
    └── tmaxclient      # Daemon client CLI
```

### Available Scripts
```bash
# Development
tmax                     # Start the editor (auto-daemon)
bun run dev              # Start with auto-reload
bun run repl             # Run T-Lisp REPL
bun run daemon           # Start daemon only

# Testing
bun run typecheck:src    # Typecheck production source
bun run typecheck:test   # Typecheck tests and imported contracts
bun run typecheck        # Typecheck the full project
bun test                 # Run Bun unit/integration tests
bun run test:daemon      # Run daemon API integration tests
bun run test:ui:renderer # Run real-key renderer E2E tests
bun run test:ui          # Run both Python suite categories
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

For detailed development plans and phase breakdowns, see the [comprehensive roadmap](./docs/ROADMAP.md).

### Current Focus
- **Phase 1**: Core editing features — COMPLETE (navigation, operators, search, visual mode, text objects)
- **Phase 2**: Extensibility and plugin system — in progress
- **Phase 3**: Advanced features (LSP integration, multiple windows)

### Modes and Lisp Ownership

tmax loads built-in T-Lisp mode libraries before user init files and daemon eval requests. Major modes are buffer-local and selected by auto-mode rules for extensions such as `.py`, `.ts`, `.tlisp`, and `.go`. Minor modes are composable per-buffer features with status-line lighters; built-ins include `line-numbers` (`Ln`) and `auto-fill` (`Fill`).

```lisp
(line-numbers-mode t)
(global-auto-fill-mode t)
(add-hook "mode-python-activate-hook"
  (lambda () (minor-mode-set "auto-fill" t)))
```

Clients can assert mode state with `tmaxclient --status --json`, which exposes `currentMajorMode`, `activeMinorModes`, and `activeMinorModeLighters`.

### Recent Milestones
- ✅ **Daemon/Client Architecture**: Emacs-style daemon with Frame-based multi-client support
- ✅ **Lisp-First Mode System**: Built-in major/minor modes load from T-Lisp and expose daemon-visible metadata
- ✅ **Messages Buffer**: `*Messages*` buffer for editor event observability
- ✅ **Core Editing Operators**: Delete, yank, change, put operations with count prefix
- ✅ **Enhanced Navigation**: Word, line, paragraph navigation with jump commands
- ✅ **Kill Ring**: Emacs-style clipboard history with yank-pop
- ✅ **Help System**: describe-key, describe-function, apropos-command
- ✅ **Which-key Popup**: Shows available bindings after prefix keys

### Quick Links
- [Product Requirements Document](./specs/prd.md) - Detailed feature specifications and implementation status
- [Development Roadmap](./docs/ROADMAP.md) - Complete phase-by-phase development plan

## Design Philosophy

tmax follows the principle of "powerful core, extensible surface". The TypeScript core provides efficient, low-level operations while T-Lisp provides unlimited customization possibilities. This architecture allows users to:

- Customize editor behavior without recompiling
- Create complex macros and commands
- Share configurations as T-Lisp scripts
- Extend functionality through a consistent API

The editor is designed to be both approachable for beginners and powerful for advanced users who want to craft their perfect editing environment.

For more information on the architecture patterns used in tmax, see the [rules/](./rules/) directory.

## Frontend Architecture

tmax supports multiple interchangeable frontends:
- **TUI Client** (default): Direct ANSI escape sequence rendering, no framework dependencies
- **Ink Frontend**: React/Ink based with component architecture
- **Steep Frontend**: Experimental native terminal frontend

All frontends communicate with the editor core through the same interface. The daemon/client architecture enables remote frontends via JSON-RPC over Unix sockets.
