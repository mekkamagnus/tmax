# Chore: Create Texinfo Documentation and Update Skill for tmax

## Chore Description

Create comprehensive Texinfo documentation for both tmax (the editor) and T-Lisp (the language), compiled into `.info` files for use with GNU Info readers. This mirrors how Emacs provides `emacs.info` and `elisp.info` as separate manuals. Additionally, create a project-local `/update-tmax-documentation` skill that keeps documentation in sync with the codebase, including regenerating the texinfo sources and recompiling the `.info` files.

### Deliverables
1. **`docs/tmax/tmax.texinfo`** — Complete tmax editor manual (updated from existing `docs/manual/tmax.texi` to reflect v0.2.0 reality: Bun runtime, daemon/client architecture, current API)
2. **`docs/tmax/tlisp.texinfo`** — T-Lisp language and API reference manual (like Emacs Lisp's `elisp.info`)
3. **`docs/tmax/tmax.info`** and **`docs/tmax/tlisp.info`** — Compiled Info files
4. **`docs/tmax/Makefile`** — Build system for both manuals
5. **`.claude/skills/update-tmax-documentation/SKILL.md`** — Project-local skill for keeping docs in sync

## Relevant Files

Use these files to resolve the chore:

### Source of truth (read to understand what's implemented)
- `src/editor/tlisp-api.ts` — Central API registry, shows all API modules and how they're wired together
- `src/editor/api/*.ts` — All 35 API modules (buffer-ops, cursor-ops, mode-ops, file-ops, bindings-ops, word-ops, line-ops, delete-ops, yank-ops, change-ops, undo-redo-ops, search-ops, count-ops, visual-ops, text-objects-ops, minibuffer-ops, jump-ops, kill-ring, yank-pop, evil-integration, lsp-diagnostics, plugin-ops, documentation, hook-ops, syntax-ops, replace-ops, indent-ops, major-mode-ops, dired-ops, keymap-ops, macro-recording, macro-persistence, undo-tree, window-ops, editor-state)
- `src/tlisp/stdlib.ts` — T-Lisp standard library (31 built-in functions)
- `src/tlisp/types.ts` — T-Lisp value types
- `src/tlisp/tokenizer.ts` — Tokenizer for lexical structure
- `src/tlisp/parser.ts` — Parser for grammar reference
- `src/tlisp/evaluator.ts` — Evaluator for special forms
- `src/tlisp/environment.ts` — Environment/scoping model
- `src/editor/editor.ts` — Editor state, modes, key handling
- `src/server/daemon.ts` — Daemon/client architecture
- `src/client/tui-client.ts` — TUI client
- `README.md` — Current project overview

### Existing documentation to use as base
- `docs/manual/tmax.texi` — Existing texinfo manual (outdated: references Deno, missing many API functions)
- `docs/Makefile` — Existing build system (only handles single manual)

### New Files
- `docs/tmax/tmax.texinfo` — Updated tmax editor manual
- `docs/tmax/tlisp.texinfo` — New T-Lisp reference manual
- `docs/tmax/Makefile` — Build system for both manuals
- `.claude/skills/update-tmax-documentation/SKILL.md` — Documentation update skill

## Step by Step Tasks

### Create `docs/tmax/` directory
- Create the directory `docs/tmax/`

### Create `docs/tmax/tmax.texinfo`
- Base it on the existing `docs/manual/tmax.texi` but update to reflect v0.2.0 reality
- Fix runtime references: Bun (not Deno)
- Add daemon/client architecture chapter (`tmax --daemon`, `tmaxclient`, JSON-RPC, frames)
- Add Frame-based multi-client section
- Update key bindings to include all current bindings (dd, yy, p, x, u, C-r, /, n, etc.)
- Update command mode to include all commands (:e, :q, :w, :wq, :%s, etc.)
- Add visual mode documentation (not "planned" — it's implemented)
- Add operators chapter (delete, yank, change, put with count prefix)
- Add search/replace chapter
- Add kill ring and yank-pop section
- Add help system section (describe-key, describe-function, apropos-command)
- Add which-key popup section
- Add M-x with fuzzy completion
- Add `*Messages*` buffer section
- Add configuration chapter with init.tlisp, eval-init-file, eval-buffer, --init-file
- Add plugin system section
- Add interchangeable frontends section (TUI, Ink, Steep)
- Keep Command Reference chapter brief — point to T-Lisp Reference for full API
- Structure:
  ```
  Top
  ├── Introduction
  ├── Installation
  ├── Daemon/Client Architecture
  ├── Basic Usage
  ├── Editing Modes
  ├── Key Bindings
  ├── Operators and Text Objects
  ├── Search and Replace
  ├── Kill Ring
  ├── Buffer Management
  ├── Configuration
  ├── Plugin System
  ├── Frontends
  ├── Command Reference (summary)
  ├── Troubleshooting
  └── Index
  ```

### Create `docs/tmax/tlisp.texinfo`
- This is the T-Lisp language and API reference manual (like `elisp.info` for Emacs)
- Structure it as a proper Lisp reference with chapters organized by topic:
  ```
  Top
  ├── Introduction to T-Lisp
  ├── Lexical Structure
  ├── Data Types
  ├── Evaluation
  ├── Special Forms
  ├── Quasiquote System
  ├── Standard Library
  │   ├── Arithmetic
  │   ├── Comparison
  │   ├── List Operations
  │   ├── String Operations
  │   ├── Type Predicates
  │   ├── Logical
  │   └── I/O
  ├── Macro System
  ├── Tail Call Optimization
  ├── Editor API — Buffer Operations
  ├── Editor API — Cursor Operations
  ├── Editor API — Text Editing (delete, yank, change, put, join)
  ├── Editor API — Search and Replace
  ├── Editor API — Visual Selection
  ├── Editor API — Text Objects
  ├── Editor API — Kill Ring
  ├── Editor API — Undo/Redo
  ├── Editor API — Mode Operations
  ├── Editor API — File Operations
  ├── Editor API — Key Bindings
  ├── Editor API — Minibuffer
  ├── Editor API — Hooks
  ├── Editor API — Syntax Highlighting
  ├── Editor API — Major Modes
  ├── Editor API — Plugins
  ├── Editor API — Miscellaneous
  └── Index
  ```
- For each API function, document: `@deffn` signature, parameters, return type, brief description, and one `@example`
- Extract actual function names from `src/editor/api/*.ts` files — read the `api.set('function-name', ...)` calls
- Cross-reference with `src/editor/tlisp-api.ts` for completeness

### Create `docs/tmax/Makefile`
- Build targets for both manuals:
  ```makefile
  all: info
  info: tmax.info tlisp.info
  tmax.info: tmax.texinfo
  tlisp.info: tlisp.texinfo
  clean:
  validate:
  check-deps:
  ```
- Use `makeinfo` for `.info` output
- Include `validate` target with `makeinfo --no-validate --no-warn`
- Include `check-deps` target to verify `makeinfo` is installed
- Include `view-info` convenience target

### Compile both `.info` files
- Run `cd docs/tmax && make info` to compile both
- Verify both compile without errors
- Verify both `.info` files are generated

### Create `.claude/skills/update-tmax-documentation/SKILL.md`
- Model after the global `/update-documentation` skill but scoped to tmax
- Frontmatter:
  ```yaml
  ---
  name: update-tmax-documentation
  description: "Audit and update all tmax documentation including texinfo manuals. Triggers on: update tmax documentation, update tmax docs, sync tmax docs, rebuild texinfo, update info files."
  ---
  ```
- Core instructions:
  1. **Read the current codebase** — scan `src/editor/api/*.ts`, `src/tlisp/stdlib.ts`, `src/tlisp/evaluator.ts`, `src/editor/editor.ts`, `src/server/daemon.ts`
  2. **Read each documentation file** — compare against codebase: `docs/tmax/tmax.texinfo`, `docs/tmax/tlisp.texinfo`, `README.md`
  3. **Fix inaccuracies** — missing functions, wrong signatures, outdated descriptions, wrong runtime references
  4. **Add missing sections** for newly implemented features
  5. **Recompile texinfo** — run `cd docs/tmax && make info` after updating
  6. **Verify** — run `cd docs/tmax && make validate` to check texinfo syntax
- Source-of-truth files:
  - `src/editor/tlisp-api.ts` and `src/editor/api/*.ts` for API
  - `src/tlisp/stdlib.ts` for standard library
  - `src/tlisp/evaluator.ts` for special forms
  - `src/editor/editor.ts` for editor behavior
  - `src/server/daemon.ts` for daemon architecture
- Documentation files to update:
  - `docs/tmax/tmax.texinfo`
  - `docs/tmax/tlisp.texinfo`
  - `README.md` (if needed)
- Include Plan Format section for structured diff planning
- Include validation commands: `make validate`, `make info`, grep for missing functions

### Update `docs/Makefile`
- Add a comment or target noting the new `docs/tmax/Makefile`
- Keep the existing `docs/manual/` targets for backward compatibility

### Validation
- Run `cd docs/tmax && make info` to compile both `.info` files
- Run `cd docs/tmax && make validate` to verify texinfo syntax
- Spot-check that documented functions match `src/editor/api/*.ts`
- Run `bun test` to verify no regressions in the codebase

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `cd /Users/mekael/Documents/programming/typescript/tmax/docs/tmax && make info` — Compile both `.info` files without errors
- `cd /Users/mekael/Documents/programming/typescript/tmax/docs/tmax && make validate` — Validate texinfo syntax without errors
- `test -f /Users/mekael/Documents/programming/typescript/tmax/docs/tmax/tmax.info && echo "OK"` — Verify tmax.info exists
- `test -f /Users/mekael/Documents/programming/typescript/tmax/docs/tmax/tlisp.info && echo "OK"` — Verify tlisp.info exists
- `test -f /Users/mekael/Documents/programming/typescript/tmax/.claude/skills/update-tmax-documentation/SKILL.md && echo "OK"` — Verify skill exists
- `bun test` — Run test suite to verify no regressions

## Notes

- The existing `docs/manual/tmax.texi` is outdated (references Deno, says visual mode is "planned", lists only 25+ API functions when there are 100+). The new `docs/tmax/tmax.texinfo` should be a fresh, accurate rewrite.
- The `tlisp.texinfo` manual should be structured like Emacs's `elisp.info` — a proper language reference organized by topic, not just an alphabetical listing.
- `makeinfo` is available on this system (GNU texinfo 7.3).
- The skill should be project-local (in `.claude/skills/`), not global, since it's tmax-specific.
- When extracting API functions from source, read the actual `api.set('function-name', ...)` calls to get exact function names. Don't guess or infer from file names.
- Use `@deffn` and `@defvr` texinfo commands for documenting functions and variables, which enables proper indexing in the Info reader.
