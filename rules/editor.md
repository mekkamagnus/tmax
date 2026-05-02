---
scope: src/editor/**/*
---

# Editor Rules

Applies to all files in the editor layer (`src/editor/`).

## Architecture

The editor layer bridges TypeScript core primitives with the T-Lisp engine:
- **Modal System**: Five modes — normal, insert, visual, command, mx
- **Key Bindings**: Configurable mappings with mode-specific behavior
- **Buffer Management**: Multiple buffers with gap buffer implementation
- **Viewport**: Scrolling and cursor management for large files
- **Terminal Interface**: Raw mode with ANSI escape sequences

## Editor API (T-Lisp Functions)

These are the T-Lisp-callable functions defined in `src/editor/tlisp-api.ts`:
- **Buffer Operations**: create, switch, insert, delete, text access
- **Cursor Management**: move, position queries with bounds checking
- **Mode Control**: get/set editor modes
- **Status Management**: status line updates and user feedback
- **File Operations**: handled through editor commands
- **M-x System**: Function execution by name

## Operating Modes

The editor has two logging modes:

**Normal Mode** (default):
- Logging level: ERROR only
- Simple message format, no emojis/colors, no stack traces

**Development Mode** (`--dev` flag):
- Logging level: DEBUG
- AI-friendly formatting with emojis, colors, structured data
- Full stack traces and correlation IDs
- Bypasses TTY checks for non-interactive environments

## Common Tasks

### Adding New T-Lisp Functions
1. Add function to `src/editor/tlisp-api.ts`
2. Update interface types if needed
3. Add tests in `test/unit/editor.test.ts`

### Adding New Key Bindings
1. Add binding in `src/editor/editor.ts` (`initializeDefaultKeyMappings`)
2. Create corresponding T-Lisp function if needed
3. Test key handling behavior

### Extending Editor Modes
1. Update mode type in `src/editor/tlisp-api.ts`
2. Add mode-specific key handling
3. Update status line rendering
4. Add cursor positioning logic
