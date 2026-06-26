# CLAUDE.md

**tmax** is a terminal-based text editor where a TypeScript core handles terminal I/O, file system, and rendering, while a built-in Lisp dialect (T-Lisp) handles all editor logic — commands, modes, key bindings, and extensibility. Zero external dependencies. Runs on Bun.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Installed CLI Tools

Prefer these tools when available:

- `rg` for search
- `jq` for JSON processing
- `gh` for GitHub interaction
- `playwright-cli` for browser automation and UI verification
- `tmux` for long-running terminal work

## 6. Learn From Corrections

Persistent lessons live in `./docs/learnings.md` - read it at the start of every task and follow every rule there.

When the user corrects a mistake you made:

1. Apply the correction. 2. Append a rule to `learnings.md` so the same mistake doesn't recur. 3. Show the user the new rule before continuing.

## 7. Further rules

- `rules/` - path-scoped rule files. Each declares its scope on the first line; read the ones that match what you're touching.
- Directory-level `Claude.md` files (e.g. `src/tlisp/Claude.md`, `src/editor/Claude.md`) declare rules that apply to all files in that directory.

## 8. Verify Before Reporting Complete

Before reporting any task as complete, verify it actually works:

- Run the tests, execute the script, check the output yourself.
- For TypeScript: run `bun run typecheck:src`, `bun run typecheck:test`, and `bun run typecheck`; fix every type error.
- For builds: run `bun run build` and confirm it succeeds.
- For e2e validation: run `bun run test:tmax-use` (tmax-use playbooks + TypeScript e2e tests).
- If you cannot verify (no test exists, can't run the code), say so explicitly. Don't imply success.

Report outcomes faithfully:

- If tests fail, say so with the relevant output. Never claim "all tests pass" when output shows failures.
- Never suppress, simplify, or skip a failing check (test, lint, type error) to manufacture a green result.
- Never characterize incomplete or broken work as done.
- When something did pass or work, state it plainly. Don't hedge confirmed results with disclaimers, and don't re-verify things you already checked.

The goal is an accurate report, not a defensive one.

---

## Project Overview

**tmax** is a comprehensive extensible terminal-based text editor with a TypeScript core running on the Bun runtime. Following the Emacs architecture, TypeScript handles low-level operations (terminal I/O, file system, memory management, display rendering) while T-Lisp (tmax Lisp) handles all higher-level editor functionality including commands, modes, key bindings, and extensibility.

**Current Status: ✅ COMPLETE AND FUNCTIONAL (v0.2.0)**

**Key Features:**
- **Full-screen modal editing** with alternate screen buffer and viewport management
- **Complete T-Lisp interpreter** with tail-call optimization and macro system
- **Five editing modes**: normal, insert, visual, command, and M-x
- **Vim-like key bindings** with proper hjkl navigation, operators, and text objects
- **Command interface** with both vim-style (:q, :w) and M-x (SPC ;) commands
- **Multiple buffer management** with gap buffer implementation
- **Comprehensive editor API** (100+ T-Lisp functions)
- **Daemon/client architecture** with Frame-based multi-client support (Emacs-style)
- **`*Messages*` buffer** for editor event observability
- **Interchangeable frontends**: TUI (ANSI), Ink (React), Steep
- **Zero external dependencies**

**Target Users:** Software developers, system administrators, and power users who prefer keyboard-driven terminal workflows with unlimited customization through T-Lisp.

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
- **Configuration management**: `~/.config/tmax/init.tlisp` file loading and execution
- **Extensibility**: Custom functions, macros, and commands

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

## Project Structure
```
tmax/
├── src/
│   ├── core/           # TypeScript core (terminal, filesystem, buffer)
│   ├── tlisp/          # T-Lisp interpreter
│   ├── editor/         # Editor with T-Lisp integration
│   ├── server/         # Daemon (JSON-RPC 2.0 over Unix socket)
│   ├── client/         # TUI client (ANSI rendering)
│   ├── frontend/       # Interchangeable frontends (Ink, Steep)
│   └── main.tsx        # Application entry point
├── test/               # Comprehensive test suite
├── scripts/            # Development scripts (REPL)
├── examples/           # Configuration examples
└── bin/                # Launcher scripts (tmax, tmaxclient)
```

## Usage Examples

### Basic Editing
```bash
# Daemon/client (recommended)
tmax file.txt            # Auto-start daemon + open file in TUI
tmax -e '(+ 1 2)'        # Evaluate T-Lisp on daemon
tmax --stop              # Stop daemon

# Direct editing
bun run start file.txt

# i - enter insert mode
# Escape - return to normal mode
# hjkl - navigate
# q - quit
# : - enter command mode
# SPC ; - enter M-x mode
```

### T-Lisp Customization
```lisp
;; ~/.config/tmax/init.tlisp configuration file
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

## Path-Scoped Rules

Detailed coding rules live in `rules/` — each file declares its scope on the first line. Read the ones that match what you're touching:

| File | Scope |
|------|-------|
| `rules/typescript.md` | `src/**/*.ts` — code style, Bun APIs |
| `rules/functional-programming.md` | `src/**/*.ts` — FP patterns, Task/TaskEither/Result/Option, monads, validation |
| `rules/tlisp.md` | `src/tlisp/**/*` — interpreter conventions, stdlib, macros |
| `rules/editor.md` | `src/editor/**/*` — modal system, key bindings, editor API |
| `rules/testing.md` | `test/**/*` — TDD workflow, bun test commands, test patterns |
| `rules/daemon-client.md` | `bin/**/*`, `src/server/**/*` — JSON-RPC protocol, sync direction, socket behavior |

## adw Pipeline (Agent-Driven Workflow)

The adw pipeline automates the full development cycle: **plan → spec-review → build → test → patch-review**, with a build↔test↔patch retry loop. Each stage is a TypeScript dispatcher that spawns an LLM CLI (`claude -p` or `codex exec`) as a subprocess. Stages share one workspace id (`agents/{adw-id}/`) where events, raw output, and state are collected.

**Architecture:** [ADR-0094](docs/adrs/ADR-0094-adw-pipeline-architecture.md). Full details in [the adws/ README](adws/).

**Worktree isolation (SPEC-065):** Fresh runs serialize plan + spec-review + spec-commit in the main checkout via a planning lock, then create a **sibling worktree** at `<repo>.<adw-id>/` on branch `adw/<id>`. Build/test/patch-review execute inside that worktree (`ADW_WORKTREE`), so concurrent pipelines never collide. Resume **validates** the recorded worktree (real `git worktree list --porcelain` check, not `existsSync`) and reuses or recreates it from the recorded `base_sha` (BUG-20). Specs: [SPEC-065](docs/specs/SPEC-065-adw-worktree-isolation.md), [BUG-20](docs/specs/BUG-20-worktree-duplication-on-resume.md).

### Running a pipeline

```bash
# Full 5-stage pipeline in a detached tmux window (survives terminal disconnects):
bun adws/adw-launch.ts "add a feature description"

# On an existing spec (skips plan):
bun adws/adw-launch.ts docs/specs/SPEC-056-browse-url.md

# Resume an interrupted run:
bun adws/adw-launch.ts --resume <workspace-id>

# Planning only (plan → spec-review, stops with status: planned):
bun adws/adw-launch.ts --script adw-plan-reviewspec.ts "add a feature description"

# Run a specific stage standalone:
bun adws/adw-spec-review.ts docs/specs/SPEC-056-browse-url.md
bun adws/adw-build.ts docs/specs/SPEC-056-browse-url.md
```

`/adw-plan "<description>"` (or `adw-launch.ts --script adw-plan-reviewspec.ts`) runs only plan → spec-review and leaves a resumable (`status: planned`) workspace. Build it with either `/adw-implement --resume <id>` or `/adw-implement docs/specs/SPEC-###.md` — both skip straight to build via spec-anchored discovery.

### Key concepts

- **Workspace id**: one `adw_id` per spec. All stages write under `agents/{id}/`. Spec-anchored discovery (`findWorkspaceBySpecPath`) reuses existing workspaces automatically.
- **tmux launcher**: `adw-launch.ts` runs pipelines in the `tmax` tmux session so they survive agent tool-call timeouts (~10 min ceiling). Always use the launcher for full pipeline runs.
- **Resume**: `--id <workspace>` auto-detects which stages completed and resumes at the first incomplete one. `--from-stage <stage>` overrides.
- **Checkpoint**: state is persisted after each stage completes, so resume is always correct.
- **build↔patch loop**: if patch-review finds gaps, the pipeline re-runs build (up to 3 times) before releasing.

### Pipeline files

| File | Role |
|------|------|
| `adws/adw-launch.ts` | tmux launcher CLI (entry point for full runs) |
| `adws/adw-plan-review-build-patch.ts` | 5-stage orchestrator (plan → review → build → test → patch-review) |
| `adws/adw-plan-reviewspec-build.ts` | 3-stage orchestrator (no patch-review) |
| `adws/adw-plan-reviewspec.ts` | 2-stage planning-only orchestrator (plan → review; terminal `status: planned`) |
| `adws/adw-plan.ts` | Stage 1: description → spec |
| `adws/adw-spec-review.ts` | Stage 2: spec → reviewed spec |
| `adws/adw-build.ts` | Stage 3: spec → implementation |
| `adws/adw-test.ts` | Stage 4: implementation → test results (unit + tmax-use e2e) |
| `adws/adw-patch-review.ts` | Stage 5: implementation → audit verdict |
| `adws/adws-modules/` | LLM interface modules (agent, reviewer, builder, patch-reviewer, workspace, tmux-launcher) |

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
