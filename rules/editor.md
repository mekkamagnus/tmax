---
scope: src/editor/**/*
---

# Editor Rules

Applies to all files in the editor layer (`src/editor/`).

## Architecture: The C/Lisp Boundary

tmax follows the Emacs architecture split. TypeScript is C. T-Lisp is Lisp.

**TypeScript (C layer) owns display primitives ONLY:**
- Raw buffer operations: insert char, delete range, get line content
- Cursor position: get/set line and column
- Viewport: get/set scroll position
- Terminal I/O: raw key input, ANSI output
- Character scanning: find next char, find matching bracket, word boundaries

**T-Lisp (Lisp layer) owns ALL editor logic:**
- Key bindings and command definitions
- Mode management and transitions
- Operator-pending state machines (d+y+c prefix handling)
- Count prefix accumulation
- Two-key sequence dispatch (gg, gt, dd, dw, etc.)
- Command composition (D = delete-to-line-end, J = join-lines logic)
- Search, replace, macro, register logic
- Configuration and extensibility

### The Litmus Test

Before writing TypeScript code in `src/editor/`, ask:

> "Does this code make a decision about what the editor should DO?"

If yes — it belongs in T-Lisp. TypeScript should only answer "where is character X?" or "what is at position Y?"

### Exceptions

The only TypeScript that may contain editor logic:
- `src/editor/handlers/` — Mode dispatch routing (sends keys to T-Lisp)
- `src/editor/editor.ts` `defineRaw()` — Thin wrappers that expose state to T-Lisp
- Performance-critical primitives that T-Lisp cannot express efficiently

If you add logic to a handler, ask: "Could this be a T-Lisp key-binding that calls primitives?"

## File Responsibilities

| Directory | What goes here |
|-----------|---------------|
| `src/editor/api/*.ts` | Display primitives (buffer ops, cursor ops, etc.) |
| `src/editor/handlers/*.ts` | Mode dispatch routing ONLY — no logic |
| `src/editor/editor.ts` | `defineRaw()` wrappers exposing state to T-Lisp |
| `src/tlisp/core/bindings/*.tlisp` | Key bindings by mode |
| `src/tlisp/core/commands/*.tlisp` | Command libraries calling primitives |
| `src/tlisp/core/modes/*.tlisp` | Minor mode definitions |

## Editor API (T-Lisp-callable Primitives)

Defined in `src/editor/api/*.ts` and registered via `src/editor/editor.ts`:
- **Buffer Operations**: insert, delete, get line, get content
- **Cursor Management**: get/set position with bounds checking
- **Mode Control**: get/set editor modes
- **Status Management**: status line updates
- **Viewport**: get/set scroll position

## Common Tasks

### Adding New Key Bindings
1. Create a T-Lisp command that composes existing primitives in `src/tlisp/core/commands/`
2. Add `(key-bind ...)` in `src/tlisp/core/bindings/` or in the same command file
3. Only add new TypeScript primitives if no existing primitive can express the operation

### Adding New Editor Commands
1. Check if existing primitives can compose the command in T-Lisp
2. If a new primitive is truly needed, add it to `src/editor/api/*.ts`
3. Register it via `defineRaw()` or the ops pattern in `editor.ts`
4. Write the command logic in T-Lisp, calling the new primitive

### Extending Editor Modes
1. Define mode behavior in T-Lisp (key bindings, status text, cursor style)
2. Only add mode dispatch routing in handlers — no logic
3. Mode state lives in T-Lisp, not TypeScript

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
