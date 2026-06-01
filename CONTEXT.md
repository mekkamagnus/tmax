# CONTEXT.md

Domain glossary for the tmax project.

## Keymaps

A **keymap** is a tagged alist: `(:keymap (key . binding) ...)`. The `:keymap` tag distinguishes keymaps from other lists. A binding's value is either a command string (e.g., `"(cursor-move ...)"`) or another keymap (for prefix keys like `g` in `gg`).

Each mode has its own keymap variable: `*normal-mode-keymap*`, `*insert-mode-keymap*`, etc. The active keymap is tracked by `*current-keymap*`, which TypeScript swaps on mode change.

**Prefix key** — a key bound to a nested keymap rather than a command. After pressing a prefix key, T-Lisp buffers the next key and looks it up in the nested keymap. Prefix state lives in T-Lisp, not TypeScript.

**key-bind** — procedural function that inserts or updates an entry in a mode keymap. Users call it from `init.tlisp` to customize bindings. Analogous to Emacs' `define-key`.

## Key Dispatch

**handle-key** — single entry point. TypeScript calls `(handle-key "h")` with one key. T-Lisp does lookup, executes the command if bound, and returns a status: `:executed`, `:prefix`, or `:unbound`. TypeScript never tracks key sequences.

## Test Layers

**Bun tests** — TypeScript-level tests run with `bun test`. Tests TypeScript core, interpreter internals, integration.

**T-Lisp tests** — tests written in T-Lisp using `deftest` / `assert-true` / `assert-equal` etc. Tests editor commands, key bindings, user-facing T-Lisp API.

## Init File

User configuration lives at `~/.config/tmax/init.tlisp` (not `.tmaxrc`). Loaded at startup via `--init-file` flag (default: `~/.config/tmax/init.tlisp`).

## Editor Architecture

TypeScript core handles terminal I/O, file system, rendering, and runs the T-Lisp interpreter. T-Lisp handles all editor logic: commands, modes, key bindings, extensibility. Zero external dependencies. Runs on Bun.
