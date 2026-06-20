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

## ADW (Agent-Driven Workflow)

**adw** is the project's automated development pipeline: **plan → spec-review → build → patch-review**, with a build↔patch retry loop. Each stage is a TypeScript dispatcher (`adws/adw-*.ts`) that spawns an LLM CLI (`claude -p` or `codex exec`) as a subprocess. The pipeline runs in a detached tmux window (`adw-launch.ts`) so it survives agent timeouts.

**Workspace** — one `adw_id` per spec. All stages write events under `agents/{id}/{agent}/events.jsonl`. The orchestrator owns the sole `agents/{id}/adw-state.json`. Spec-anchored discovery (`findWorkspaceBySpecPath`) reuses existing workspaces automatically when a user runs a dispatcher on a spec without `--id`.

**Stages:**
- **plan** (`adw-plan.ts`) — free-text description → spec (via `claude -p /feature|/bug|/chore`)
- **spec-review** (`adw-spec-review.ts`) — spec → reviewed spec (via `codex exec`, review + upgrade)
- **build** (`adw-build.ts`) — spec → implementation (via `claude -p /implement`)
- **patch-review** (`adw-patch-review.ts`) — implementation → audit verdict (gather diff + gates + `claude -p --json-schema`)

**Orchestrators** — `adw-plan-reviewspec-build.ts` (3-stage) and `adw-plan-review-build-patch.ts` (4-stage with retry loop). Both support `--id` resume (auto-detects completed stages), `--from-stage` override, and checkpoint persistence.

**TRT (tmax Runtime Testing)** — the T-Lisp-native test framework (`src/tlisp/core/trt/`), replacing the old TS test framework. Run via `bin/trt` or `bun run test:trt`.

**Observability** — `*daemon*` virtual buffer + log-store (`src/editor/log-store.ts`) for daemon lifecycle events. `*Messages*` is now read-only, backed by the log store.

**ADW vs Demo** — a *demo* (`demos/*.yaml`) is visual: it assumes a live tmux session + TUI frame, narrates for a human, and asserts nothing. An *adw pipeline run* is headless, self-contained, and runs to completion. An *adw e2e test* (`adw-run-e2e.ts`) is a headless test runner that drives the editor via the daemon socket and asserts state.
