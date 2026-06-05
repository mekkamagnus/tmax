# Gap Analysis: T-Lisp as a Standalone Language

**Date:** 2026-06-05
**Purpose:** Assess what would be required for T-Lisp to exist as a general-purpose language independent of the tmax editor

---

## Current State

T-Lisp is currently used as an embedded domain-specific language (eDSL) inside tmax. The interpreter core (`src/tlisp/`) is reasonably isolated and can already evaluate useful non-editor programs, but the project does not yet ship a standalone CLI, standalone I/O profile, or standalone distribution.

### What Works Today (Language Core)

The interpreter is architecturally clean:

```
Tokenizer → Parser → Evaluator → Environment
                       ↑
              ModuleRegistry
```

- **Data types**: nil, boolean, number, string, symbol, list, hashmap, function, macro
- **Control flow**: if/when/unless, while/dolist/dotimes, tail-call optimization
- **Macros**: Full quasiquote/unquote with compile-time expansion
- **Lexical scoping**: Environment chains with proper parent lookup
- **Module system**: `defmodule`, `require-module`, qualified names, module registry, and an external module-loader hook
- **Standard library**: Generic functions for list/sequence operations, hashmaps, strings, predicates, arithmetic, testing support, and editor-adjacent helpers

### The Coupling Surface

T-Lisp has **three relevant layers** when assessing editor coupling:

#### Layer 1: Interpreter Core (`src/tlisp/`)

The core has minimal TypeScript dependencies — only utility types, not editor logic:

| Dependency | File | Purpose | Editor-specific? |
|---|---|---|---|
| `Either` | `../utils/task-either.ts` | Error propagation | No |
| `AppError` | `../error/types.ts` | Error type taxonomy | No |
| `ModuleRegistry` | `./module-registry.ts` | Module tracking | No |
| `TLispEnvironment` | `./types.ts` | Scope chain | No |

**Verdict:** The interpreter core (tokenizer, parser, evaluator, environment, types, values) is already standalone-capable. No editor imports anywhere in `src/tlisp/` except what `tlisp-api.ts` injects as builtins.

#### Layer 2: Editor API (`src/editor/tlisp-api.ts` + `src/editor/api/*.ts`)

This is where all coupling lives. The editor injects ~100+ primitives into the interpreter's builtin environment:

| API Module | Functions | Example Operations |
|---|---|---|
| `buffer-ops.ts` | 12 | buffer-insert, buffer-delete, buffer-text, buffer-lines |
| `cursor-ops.ts` | 8 | cursor-move, cursor-line, cursor-column |
| `mode-ops.ts` | 6 | editor-set-mode, editor-get-mode |
| `file-ops.ts` | 4 | save-file, find-file |
| `bindings-ops.ts` | 5 | key-bind, define-prefix-command |
| `word-ops.ts` | 4 | word-forward, word-backward |
| `line-ops.ts` | 5 | line-beginning, line-end |
| `delete-ops.ts` | 6 | delete-char, delete-to-line-end |
| `search-ops.ts` | 4 | search-forward, search-backward |
| `yank/kill ops` | 5 | yank, kill-ring-save |
| `visual-ops.ts` | 6 | visual-set-selection, visual-get-selection |
| `text-objects-ops.ts` | 4 | text-object-word, text-object-paragraph |
| + 15 more modules | ~40 | hooks, plugins, syntax, replace, indent, dired, etc. |

Each function is a **closure over editor state** — they capture `TlispEditorState` (buffers, cursor, terminal, filesystem). The interpreter calls these as if they were native T-Lisp functions. The T-Lisp evaluator has no knowledge that these come from TypeScript.

#### Layer 3: T-Lisp Core Files (`src/tlisp/core/`)

30+ `.tlisp` modules define editor behavior. These files are already module-wrapped with `defmodule`, but their contents extensively call the editor API. Example from `motions.tlisp`:

```lisp
(defmodule editor/commands/motions
  (export paragraph-previous paragraph-next ...))

(defun paragraph-next ()
  ...
  (cursor-move (+ line 1) 0)
  ...)
```

These modules are **editor-specific by design** — they are the editor.

---

## Gap Inventory

### Gap 1: I/O Primitives

**What exists:** File read/write through editor's `save-file` and `find-file`. No stdout, stderr, stdin. No network. No subprocess.

**What a standalone Lisp needs:**
- `(print expr)` / `(princ expr)` — stdout output
- `(read)` / `(read-line)` — stdin input
- `(read-file path)` / `(write-file path content)` — file I/O
- `(shell-command cmd)` — subprocess execution
- `(file-exists? path)` / `(directory-files path)` — filesystem queries

**Gap size:** Medium. File I/O maps to `FileSystem` interface already in the codebase. stdout/stdin needs new interfaces. Subprocess support is new.

**Files to create:** `src/tlisp/io-ops.ts` — standalone I/O primitives, parallel to `src/editor/api/file-ops.ts` but without editor dependencies.

---

### Gap 2: Entry Point / Script Execution

**What exists:** `TLispInterpreter.execute(source)` evaluates a string. No script file execution, no CLI entry point, no `main` function convention.

**What a standalone language needs:**
- `tmax-lisp script.tlisp` — execute a file
- `tmax-lisp -e '(+ 1 2)'` — one-shot evaluation
- `tmax-lisp` — REPL
- Shebang support: `#!/usr/bin/env tmax-lisp`

**Gap size:** Small. The `execute()` method already works. Just needs a CLI wrapper.

**Files to create:** `src/tlisp/cli.ts` — command-line entry point using Bun's `Bun.argv`.

---

### Gap 3: REPL

**What exists:** A REPL exists in `scripts/repl.ts` but it's a development tool, not a standalone REPL. It creates an interpreter without any editor primitives — just the core language + stdlib. No readline, no history, no completion.

**What a standalone language needs:**
- Readline with history
- Multi-line input (balanced paren detection)
- Tab completion for symbols
- `*1`, `*2`, `*3` for last three results (Clojure-style)
- `*e` for last exception
- `doc` function for inline documentation

**Gap size:** Medium. Core REPL loop exists. Polish and UX is the work.

---

### Gap 4: Standard Library Completeness

**What exists:** More than the original standalone estimate assumed. The live evaluator already includes common arithmetic and predicate builtins such as `mod`, `floor`, `ceiling`, `round`, `abs`, `min`, `max`, `sqrt`, `expt`, `numberp`, `stringp`, `symbolp`, `listp`, and `functionp`. `stdlib.ts` also provides higher-level collection, hashmap, string matching, keymap, and testing-oriented helpers.

**What a standalone general-purpose Lisp needs:**

| Category | Remaining Missing / Incomplete Functions | Priority |
|---|---|---|
| **Arithmetic** | Mostly present. Consider aliases such as `ceil` -> `ceiling` and `pow` -> `expt` if user-facing compatibility matters. | Low |
| **String** | `string-join`, `string-repeat`, `string-trim`, `string-replace`, `format` | High |
| **I/O** | `print`, `princ`, `read`, `read-line`, `read-file`, `write-file` | High |
| **Predicates** | `nilp` alias if desired. Core type predicates are already present. | Low |
| **Error handling** | `condition-case`, `signal`, `throw`/`catch` | Medium |
| **Time** | `current-time`, `format-time-string` | Low |
| **System** | `getenv`, `shell-command`, `exit` | Low |
| **Seq/Collection** | `reduce`, `some`, `every`, `count`, `flatten`, `zip` | Medium |
| **Type conversion** | `number-to-string`, `string-to-number`, `char-to-string` | High |
| **Regex** | `string-match`, `replace-regexp-in-string` | Medium |

**Gap size:** Small-Medium for a useful MVP. The missing high-priority surface is I/O, string formatting/manipulation, and type conversion, not arithmetic or basic predicates. `format` is the hardest single stdlib function if it aims for printf- or Elisp-style behavior.

---

### Gap 5: Error Handling

**What exists:** `Either<AppError, TLispValue>` for interpreter-level errors. No user-level error handling in T-Lisp code.

**What a standalone language needs:**
- `condition-case` / `handler-case` (Elisp/Common Lisp style)
- Or `try`/`catch`/`finally` (simpler)
- Custom error types
- Error restarts (optional, advanced)

**Gap size:** Medium-High. Requires evaluator changes to support unwinding to a handler. The evaluator currently propagates errors via `Either.left` — adding catch points means intercepting those at specific eval points.

---

### Gap 6: Foreign Function Interface (FFI)

**What exists:** TypeScript injects functions as closures. No mechanism for T-Lisp to call arbitrary TypeScript/JS.

**What a standalone language needs (if embedded in other apps):**
- `(js-eval "Math.sqrt(2)")` — escape hatch
- `(require-js "fs")` — import JS modules
- Or: a registration API where host apps inject their own primitives (already exists via `defineBuiltin`)

**Gap size:** Small for host-embedded use (the mechanism exists). Large for truly standalone with JS interop.

---

### Gap 7: Standalone Module Loading

**What exists:** The module system itself exists: `defmodule`, `require-module`, module registry, qualified names, import tables, and a module-loader hook. The editor supplies editor-specific resolution for core editor modules.

**What a standalone language needs:**
- A standalone module loader that resolves against bundled stdlib modules, the current working directory, and `TLISP_PATH`
- A standard library that ships as `.tlisp` files, not embedded in TypeScript
- A decision on how `.tlisp` stdlib files are found inside or beside a `bun build --compile` binary
- Package manager that works without tmax daemon
- `(import (rnrs lists))` or `(require-module std/lists)` style

**Gap size:** Small-Medium. The evaluator architecture is already there. The main product decision is distribution: embed stdlib source into the binary as a virtual registry, copy stdlib files beside the binary, or support both.

---

### Gap 8: Build / Distribution

**What exists:** T-Lisp runs inside the tmax Bun project. `package.json` has a development REPL script, but no standalone `tlisp` bin, no compiled binary target, and no release pipeline.

**What a standalone language needs:**
- A CLI entry point that can be compiled to a standalone binary
- `bun build --compile ./src/tlisp/cli.ts --outfile tlisp` produces a self-contained executable with the Bun runtime baked in. No Node, Bun, or npm needed on the target machine.
- Cross-compilation via `--target` flag: `bun-linux-x64`, `bun-darwin-arm64`, `bun-windows-x64`
- Release pipeline: attach binaries to GitHub Releases
- Optional: published as npm package for embedding (`npm install @tmax/tlisp`)
- Explicit stdlib asset strategy for compiled binaries

**Gap size:** Small for binary distribution if stdlib stays mostly TypeScript-registered. Small-Medium if standalone `.tlisp` stdlib files must be bundled and loaded from inside the binary. Medium for npm package extraction.

---

### Gap 9: Documentation and Introspection

**What exists:** `describe-function` shows docstrings. `apropos-command` searches bindings. Both iterate `globalEnv` directly.

**What a standalone language needs:**
- `(doc function-name)` — show documentation
- `(source function-name)` — show source code
- `(apropos pattern)` — search all symbols
- `(info)` — language manual (could be `.tlisp` files rendered as text)
- Per-function metadata: arglist, docstring, file, line, module

**Gap size:** Small. The `TLispFunction` type already has `docstring`, `parameters`, `source` fields. They're just under-populated.

---

### Gap 10: T-Lisp Core Files Are Editor-Specific

**What exists:** 30+ `.tlisp` modules in `src/tlisp/core/` call editor primitives. These ARE the editor.

**What a standalone language does with these:** Nothing. They stay with tmax. A standalone T-Lisp would have its own standard library of `.tlisp` files — data structure algorithms, string processing utilities, etc. — not editor commands.

**Gap size:** Not a gap. This is by design. The standalone stdlib would be a new set of files.

---

## Coupling Matrix

What must be decoupled for each level of independence:

| Capability | Interpreter Core | Stdlib | Editor API | Core .tlisp Files |
|---|---|---|---|---|
| Standalone REPL | Already decoupled | Needs I/O additions | Not needed | Not needed |
| Script execution | Already decoupled | Needs I/O + sys additions | Not needed | Not needed |
| Embeddable in other apps | Already decoupled | Generic subset works | Replace with host API | Not needed |
| Editor keeps working | No change | No change | No change | No change |

The key insight: **the interpreter is already standalone**. The stdlib is mostly standalone (hashmap ops, string ops, testing). The editor API is cleanly injected via `defineBuiltin` — it's not imported by the interpreter, it's registered at runtime.

---

## What Does NOT Need to Change

- **Tokenizer** — No editor references
- **Parser** — No editor references
- **Evaluator** — No editor references (all editor ops arrive as builtin function values)
- **Environment** — No editor references
- **Types and values** — No editor references
- **Module registry** — No editor references
- **Values factory** (`values.ts`) — No editor references
- **30 core .tlisp files** — Stay with the editor, untouched
- **Editor API modules** (`src/editor/api/*.ts`) — Stay with the editor, untouched

---

## Effort Estimate

| Gap | Effort | Risk |
|---|---|---|
| 1. I/O Primitives | Medium | Low — wrapping JS APIs |
| 2. Entry Point / CLI | Small | Low — Bun.argv wrapper |
| 3. REPL | Medium | Low — polish, not architecture |
| 4. Stdlib Completeness | Small-Medium | Low — many arithmetic/predicate functions already exist |
| 5. Error Handling | Medium-High | Medium — evaluator changes |
| 6. FFI | Small (host-embedded) | Low |
| 7. Standalone Module Loading | Small-Medium | Medium — compiled binary stdlib assets need a decision |
| 8. Build / Distribution | Small (binary) / Medium (npm) | Low-Medium — `bun build --compile` handles binary; asset bundling and npm extraction are the real risks |
| 9. Documentation | Small | Low — metadata population |

**Total: ~1-2 weeks** for a usable standalone MVP with sync I/O, script execution, a modest REPL, standalone module loading, and single-binary distribution via `bun build --compile`.

**Total: ~3-4 weeks** for the fuller version with polished REPL behavior, user-level error handling, broader string/type-conversion stdlib coverage, documentation/introspection polish, and release automation.
