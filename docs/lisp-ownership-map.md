# Lisp Ownership Map

This document classifies TypeScript editor modules by ownership category and tracks the migration from TypeScript-owned editor behavior to T-Lisp-owned editor behavior.

## Current Source Ratio

| Layer | LOC | Share |
|---|---:|---:|
| TypeScript/TSX runtime (`src/**/*.ts`, `src/**/*.tsx`) | 44,510 | ~98.6% |
| T-Lisp runtime (`src/**/*.tlisp`) | 638 | ~1.4% |

Emacs C/Elisp ratio for comparison: ~22% C, ~78% Elisp. tmax has significant room to grow its Lisp layer.

## Module Classification

### Substrate (Stays TypeScript)
These modules provide runtime primitives that T-Lisp cannot implement:
- `src/tlisp/` — Interpreter, parser, evaluator, tokenizer, environment
- `src/core/` — Buffer, filesystem, terminal, types
- `src/server/` — Daemon, JSON-RPC, frame sync
- `src/client/` — TUI client
- `src/frontend/` — Renderers, ANSI, Ink adapter

### Primitive API (Stays TypeScript, Exposes to T-Lisp)
These modules expose low-level operations that T-Lisp composes into user-facing behavior:

| Module | Status |
|--------|--------|
| `buffer-ops.ts` | primitive-api |
| `cursor-ops.ts` | primitive-api |
| `mode-ops.ts` | primitive-api |
| `file-ops.ts` | primitive-api |
| `bindings-ops.ts` | primitive-api |
| `word-ops.ts` | primitive-api |
| `line-ops.ts` | primitive-api |
| `delete-ops.ts` | primitive-api |
| `search-ops.ts` | primitive-api |
| `yank-ops.ts` | primitive-api |
| `change-ops.ts` | primitive-api |
| `undo-redo-ops.ts` | primitive-api |
| `count-ops.ts` | primitive-api |
| `visual-ops.ts` | primitive-api |
| `text-objects-ops.ts` | primitive-api |
| `jump-ops.ts` | primitive-api |
| `kill-ring.ts` | primitive-api |
| `yank-pop-ops.ts` | primitive-api |
| `syntax-ops.ts` | primitive-api |
| `indent-ops.ts` | primitive-api |
| `replace-ops.ts` | primitive-api |
| `window-ops.ts` | primitive-api |
| `minibuffer-ops.ts` | primitive-api |
| `documentation.ts` | primitive-api |
| `dired-ops.ts` | primitive-api |
| `load-ops.ts` | primitive-api |

### Transitional Policy (Behavior Should Move to T-Lisp)
These modules currently own user-facing behavior that should become T-Lisp libraries:

| Module | Target T-Lisp Library | Status |
|--------|----------------------|--------|
| `major-mode-ops.ts` | `src/tlisp/core/modes/*.tlisp` | partial — modes registered from T-Lisp, buffer-local state and auto-mode APIs implemented |
| `minor-mode-ops.ts` | `src/tlisp/core/modes/*.tlisp` | partial — registry and generated helper exist, global/local override semantics implemented |
| `hook-ops.ts` | part of stdlib | partial — string/symbol/lambda hooks execute, deeper Emacs hook features deferred |
| `keymap-ops.ts` | `src/tlisp/core/bindings/*.tlisp` | partial — bindings loaded from T-Lisp |
| `evil-integration.ts` | `src/tlisp/core/commands/editing.tlisp` | pending |
| `plugin-ops.ts` | `src/tlisp/core/commands/` | pending |
| `lsp-diagnostics.ts` | `src/tlisp/core/commands/` | pending |
| `macro-recording.ts` | `src/tlisp/core/commands/` | pending |
| `macro-persistence.ts` | `src/tlisp/core/commands/` | pending |

### Lisp-Owned (Behavior in T-Lisp)
These areas are authored primarily in T-Lisp:

| Library | Status |
|---------|--------|
| `src/tlisp/core/modes/*.tlisp` | active — major and minor mode definitions, built-in mode loading required at startup |
| `src/tlisp/core/bindings/*.tlisp` | active — modal key binding policy |
| `src/tlisp/core/commands/*.tlisp` | partial — save, find-file, isearch, replace, indent, dired stubs/representative workflows |
| `src/tlisp/core/indent/*.tlisp` | active — indent rules per language |

## Migration Rule

New user-facing editor behavior should be implemented in T-Lisp unless it requires a new primitive. When a primitive is needed:
1. Add the primitive in TypeScript
2. Implement the user-facing command/workflow in T-Lisp
3. Classify the TS module as `primitive-api`

## Follow-Up Migration Candidates

After SPEC-003:
1. Editing operator workflows (delete/yank/change/text-object composition)
2. Search/replace interactive workflows
3. Buffer/window/file command workflows
4. Help/discovery commands (describe-key, describe-function, apropos)
5. Completion sources for M-x
6. Dired interactive workflows
7. Plugin/package system
