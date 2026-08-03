# Feature: Deferred large M-x features — grep, recover-session, jump-to-register (window-config), info, tutorial

## Goals

- Catalog five large, high-value editor features that were **deferred** from the
  alpha-readiness implementation pass because each is a new subsystem rather than
  a thin T-Lisp wrapper, and document the exact integration point and design
  sketch for each so a future pass can pick any one up independently.
- Make the deferral **explicit and auditable**: name the prior audit gap, the
  real source files (already read) the feature hangs off, and the rationale for
  why it does not ship this pass.
- Reserve the M-x names (`grep`, `recover-session`, `jump-to-register`, `info`,
  `tutorial`) so they are not silently reimplemented under conflicting names by a
  later spec, and so each sub-feature's discoverability contract (docstring
  and/or binding) is on record.

## Completion Criteria (Definition of Done)

> **Status: Deferred — spec only, not implemented this pass.** None of the
> criteria below are claimed as done. They are the **acceptance criteria for the
> future implementer** of each sub-feature; this meta-spec's only deliverable is
> the catalog itself plus its five sub-sections.

- [ ] **grep**: `(grep "pattern" &optional directory)` populates a `*grep*`
  compilation-style results buffer (file:line:col:match rows), Enter on a row
  opens the file at that location, and a follow-up `n`/`N` jumps the next/prev
  hit — exercised end-to-end against a temp fixture tree. (No eval-NN playbook
  assigned; excluded from the eval-22..47 run.)
- [ ] **recover-session**: after a crash with dirty buffers, `M-x recover-session`
  scans `TMAX_WORKSPACE_DIR` for auto-save artifacts, lists recoverable buffers
  with an `[y/n]`-style prompt, and restoring one reopens the file buffer with
  the recovered content. (No eval-NN playbook assigned; excluded from the run.)
- [ ] **jump-to-register (window-config)**: `(window-config-to-register "r")`
  snapshots the current window-list layout into a register, and
  `(jump-to-register "r")` restores that exact window layout — registers that
  hold a window-config are not confused with text registers. (No eval-NN
  playbook assigned; excluded from the run.)
- [ ] **info**: `(info "node")` opens an Info-style tree reader over the
  documentation (a tree navigable with `n`/`p`/`u`/`Enter`), not the flat
  `(documentation-list)` list that exists today. (No eval-NN playbook assigned;
  excluded from the run.)
- [ ] **tutorial**: `M-x tutorial` opens a guided `tutorial.tlisp` buffer that
  walks a new user through modal editing; the `(tutorial)` function is callable
  and returns the buffer name. (No eval-NN playbook assigned; excluded from the
  run.)
- [ ] This meta-spec exists at `docs/specs/SPEC-086-deferred-large-features.md`
  with a sub-section per sub-feature (Goals + Completion Criteria + Solution
  sketch + Relevant Files) and a visible **"Deferred — spec only, not
  implemented this pass"** status + rationale block. (This is the only criterion
  this pass delivers.)

## Description

Five editor features came up repeatedly in the alpha-readiness audit
([alpha-audit 2026-08-01](../memos/alpha-audit-2026-08-01.md)) as
**expected-by-users-but-missing**. Each one is genuinely a **new subsystem** — a
new results-buffer type, a new artifact-scan lifecycle, a new register
capability, a new tree-shaped reader, a new shipped buffer+lesson script — not a
small wrapper over an existing primitive. Bundling any of them into the current
implementation pass would balloon scope and risk shipping half-built
subsystems.

This meta-spec **does not implement any of them**. It records, for each: the gap
the audit named, the **real** source files the feature attaches to (verified by
Read/Grep), a tmax-specific solution sketch, and the precise new file(s) the
future implementer should add. A future spec picks **one** sub-feature and
implements it against the criteria above; the per-sub-feature mini-criteria are
the acceptance contract for that day.

The five sub-features are **independent**: each can be shipped (and tested) on
its own, in any order, without touching the others.

## User Story

As a **tmax maintainer planning the post-alpha implementation backlog**,
I want **each large deferred M-x feature captured as a spec with its real
integration point and design sketch, explicitly marked deferred**,
So that **a future implementation pass can pick exactly one up without
re-discovering the audit gap, re-reading the whole codebase, or accidentally
duplicating it under a different name.**

## Problem Statement

The alpha-readiness audit catalogued editor capabilities users expect from an
Emacs/vim-class editor that tmax does not yet expose at the M-x layer:

- **grep** — `read-dir` (`src/editor/api/file-ops.ts:369`) and the
  `search-find-all-matches` primitive (`src/editor/api/search-ops.ts:651`)
  exist, but nothing composes them into a project-wide search with a
  compilation-style results buffer. There is no `*grep*` buffer, no row→file
  jump, and no `(grep …)` T-Lisp function.
- **recover-session** — `WorkspaceManager` persists workspaces to
  `TMAX_WORKSPACE_DIR` (`src/core/workspace.ts:39`) and the editor restores a
  stale workspace on startup, but there is **no command** that scans for
  auto-save artifacts after an abnormal exit and offers the user a per-buffer
  restore. A crashed session's unsaved work is silently unrecoverable from
  inside the editor.
- **jump-to-register (window-config)** — the register system
  (`src/editor/api/evil-integration.ts`) holds **text only**
  (`RegisterState.storage: string[]`, line 34). Emacs/evil window-config
  registers (snapshot the window layout into a register and jump back to it)
  have no representation; `(jump-to-register)` does not exist.
- **info** — `documentation.ts` exposes a **flat** catalogue
  (`DOCUMENTATION_DATABASE: DocumentationEntry[]`, line 37) plus
  `(documentation-list)`/`(documentation-search)` (`src/editor/api/documentation.ts:448`).
  There is no Info-style **tree** reader (nodes with parent/child/sibling
  navigation), which is the shape users expect from `M-x info`.
- **tutorial** — there is no shipped tutorial buffer or `(tutorial)` function;
  a first-time user has no guided on-ramp inside the editor.

Each gap is large enough (new buffer lifecycle, new artifact scan, new register
shape, new tree model, new shipped lesson) that implementing all five inside the
current pass would compromise the surgical-changes principle. They are deferred
here on purpose.

## Solution Statement

Do **not** implement in this pass. For each sub-feature, the solution is to
add a **new** T-Lisp-facing module (or, for tutorial, a new shipped `.tlisp`
buffer) under the existing `src/editor/api/` layer, wired into
`src/editor/tlisp-api.ts` exactly as its sibling ops modules already are
(`createSearchOps` at `tlisp-api.ts:257`, `createEvilIntegrationOps` at
`:462`, `createDocumentationOps` at `:512`). Each new command MUST get a
docstring and/or keybinding so it appears in M-x completion (per
`command-detail-interactive-p` in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19` — see **M-x
Discoverability** below). Per-sub-feature sketches:

### Solution sketch — grep

Compose the existing primitives into a results buffer:

1. A new `src/editor/api/grep-ops.ts` exposes `(grep "pattern" &optional dir)`.
   It walks `(read-dir dir)` recursively (file-ops.ts:369 already returns
   `isFile`/`isDirectory` per entry), reads each text file via
   `(read-file-content path)` (file-ops.ts:115), and runs the existing
   line-by-line match loop already proven in `search-find-all-matches`
   (search-ops.ts:651).
2. Results are written into a **`*grep*`** special buffer (new buffer name,
   reserved alongside `*scratch*`/`*Messages*`/`*daemon*` per
   `src/editor/CLAUDE.md`) in `file:line:col: text` rows.
3. A new `(grep-jump)` command (bound to `Enter` in the `*grep*` buffer) parses
   the row, opens the file (`openFile`), and moves the cursor. Emacs-style
   `n`/`N` step to the next/previous row.
4. Subprocess (`rg`/`grep`) dispatch is an **optional** optimization, gated on
   availability — the primitive-based path is the portable default and keeps
   zero-external-dependencies intact.

### Solution sketch — recover-session

1. Auto-save artifacts: extend `WorkspaceManager` (`src/core/workspace.ts`) or a
   new helper to write per-buffer auto-save files into `TMAX_WORKSPACE_DIR`
   (the dir already resolved at workspace.ts:39) on a timer / dirty-flag, and
   to **clean them on a clean `:w`/quit** so they only survive a crash.
2. A new `src/editor/api/recover-ops.ts` exposes `(recover-session)`: it scans
   `TMAX_WORKSPACE_DIR` for auto-save artifacts (reusing `read-dir`,
   file-ops.ts:369), lists them in a `*recover*` buffer with source file + mtime,
   and on selection reads the artifact (`read-file-content`) and reopens the
   target buffer with the recovered content.
3. Decide and document the relationship to the **existing** stale-workspace
   restore on startup (server `cleanStart` path, see BUG-58) — recover-session
   is the **interactive**, per-buffer path; the startup restore is the
   automatic, whole-workspace path. They must not fight over the same files.

### Solution sketch — jump-to-register (window-config)

1. Extend `RegisterState` (`src/editor/api/evil-integration.ts:33`) to carry an
   **optional** window-config slot: a snapshot of the `Window[]` list
   (`window-list`, `src/editor/api/window-ops.ts:177`) plus the current window
   index and per-window cursor/buffer-name. Text registers (the `string[]`
   store) stay untouched — this is a **new**, typed slot, not a string overload.
2. New ops on `RegisterOps` (`bindRegisters`, evil-integration.ts:74):
   `windowConfigToRegister(name)` snapshots, `jumpToRegister(name)` restores.
   Exposed as T-Lisp `(window-config-to-register "r")` and `(jump-to-register "r")`.
3. `jump-to-register` restores the saved `Window[]` (via the existing
   `setWindows` callback on `createWindowOps`, window-ops.ts:26) and the saved
   buffer/cursor — reusing the window model already in `window-ops.ts`, no new
   window primitive needed.

### Solution sketch — info

1. Add a **tree** model. `documentation.ts` is flat
   (`DOCUMENTATION_DATABASE: DocumentationEntry[]`); the future spec introduces a
   `DocNode` tree (parent/children) — either reorganising the existing DB or
   layering a tree index on top — so `n`/`p`/`u`/`Enter` navigation is meaningful.
2. A new `src/editor/api/info-ops.ts` exposes `(info &optional node)` that opens
   an `*info*` special buffer rendering the tree node; the buffer's keymap (a
   T-Lisp command library, per `src/editor/CLAUDE.md`) implements
   `next`/`prev`/`up`/`enter`. This is distinct from the **flat**
   `(documentation-list)`/`(documentation-search)` already shipped
   (documentation.ts:448) — those remain as quick lookup, `info` is the
   navigable manual.

### Solution sketch — tutorial

1. Ship a `tutorial.tlisp` (under `src/tlisp/core/` alongside other shipped
   `.tlisp`, per `src/editor/CLAUDE.md`'s "What belongs where") that, when
   evaluated, opens a `*tutorial*` buffer with a guided lesson and a keymap
   that advances steps.
2. Expose `(tutorial)` — a thin T-Lisp function that creates/switches to the
   `*tutorial*` buffer. The lesson content lives in T-Lisp/data, not in the TS
   core (TypeScript provides primitives only, per `src/editor/CLAUDE.md`).

## Relevant Files

All paths below were read before this section was written. They are the
**anchor** files the future implementer touches.

### grep
- **`src/editor/api/file-ops.ts`** — `read-dir` (line 369, returns
  `isFile`/`isDirectory`/`size`/`modified` per entry) and `read-file-content`
  (line 115, with the UTF-8/binary guard from BUG-56) are the building blocks.
- **`src/editor/api/search-ops.ts`** — `search-find-all-matches` (line 651) is
  the per-buffer match loop to reuse for file contents.
- **`src/editor/api/buffer-ops.ts`** — `buffer-create`/`buffer-switch`
  (lines 69, 88) for the new `*grep*` results buffer.
- **NEW `src/editor/api/grep-ops.ts`** — the new module (mirrors
  `createSearchOps`'s factory shape).
- **`src/editor/tlisp-api.ts`** — wire `createGrepOps` here, next to
  `createSearchOps` (line 257).

### recover-session
- **`src/core/workspace.ts`** — `WorkspaceManager`, `defaultWorkspaceDir()`
  (line 39, the `TMAX_WORKSPACE_DIR` source of truth), workspace save/load.
- **`src/editor/runtime/workspace-runtime.ts`** + **`src/server/server.ts`** —
  the existing stale-workspace restore path (cleanStart, BUG-58 context); the
  recover-session interactive path must coexist with this.
- **`src/editor/api/file-ops.ts`** — `read-dir` (369) / `read-file-content`
  (115) / `write-file-content` (69) for the auto-save artifacts.
- **NEW `src/editor/api/recover-ops.ts`** — the new module.
- **`src/editor/tlisp-api.ts`** — wire `createRecoverOps` here.

### jump-to-register (window-config)
- **`src/editor/api/evil-integration.ts`** — `RegisterState` (line 33) and
  `bindRegisters`/`RegisterOps` (line 74) gain a window-config slot.
- **`src/editor/api/window-ops.ts`** — `window-list` (line 177) and the
  `setWindows`/`setCurrentWindowIndex` callbacks (lines 26-27) are the restore
  path; `Window` contract in `src/core/contracts/editor.ts`.
- **`src/editor/tlisp-api.ts`** — `createEvilIntegrationOps` is wired at line
  462; the new window-config functions ride along on the same `RegisterOps`.

### info
- **`src/editor/api/documentation.ts`** — the flat `DOCUMENTATION_DATABASE`
  (line 37) and `createDocumentationOps` (line 448); the future spec either
  reorganises this into a tree or layers a tree index on top.
- **NEW `src/editor/api/info-ops.ts`** — the new tree-reader module.
- **`src/editor/tlisp-api.ts`** — wire `createInfoOps` next to
  `createDocumentationOps` (line 512).

### tutorial
- **NEW `src/tlisp/core/.../tutorial.tlisp`** (path TBD per the T-Lisp module
  layout) — the lesson script + `(tutorial)` function + `*tutorial*` buffer
  keymap. Per `src/editor/CLAUDE.md`, lesson **logic** belongs in T-Lisp, not
  the TS core.
- **`src/editor/api/buffer-ops.ts`** — `buffer-create`/`buffer-switch`
  primitives the tutorial calls.

## Implementation Plan

> **Not executed this pass.** The plan below is the recommended sequence for the
> future implementer of **one** chosen sub-feature. Each sub-feature is
> independent; do not attempt more than one per pass.

1. **Pick exactly one** sub-feature from the five above. Open a dedicated spec
   (e.g. `SPEC-0NN-grep.md`) that lifts this meta-spec's mini-criteria into
   full acceptance criteria + an eval playbook, and resolves the open design
   questions (subprocess vs. primitive grep; auto-save file naming;
   window-config register slot shape; DocNode tree model; tutorial lesson
   outline).
2. Read every file cited in that sub-feature's **Relevant Files** (they are
   already verified to exist; do not re-hallucinate paths).
3. Add the new module under `src/editor/api/` (or the shipped `.tlisp` for
   tutorial) following the `create*Ops` factory pattern already established.
4. Wire it into `src/editor/tlisp-api.ts` next to its sibling factory.
5. Give every new command a **docstring** (so it appears in M-x completion per
   `command-detail-interactive-p`, `execute-extended-command.tlisp:15-19`) and,
   where appropriate, a keybinding.
6. Add unit tests (primitive-level) and an e2e playbook; run
   `bun run typecheck:src`, `bun run typecheck:test`, `bun run test:unit`,
   and the relevant e2e harness before claiming done.
7. Update this meta-spec: move the finished sub-feature's status line from
   "Deferred" to "Done — see SPEC-0NN" and leave the others deferred.

## Test Plan

- **No eval-NN playbook is assigned to this meta-spec** (playbook: N/A). All
  five sub-features are **excluded from the eval-22..47 run** for this pass —
  they ship no code and have no e2e assertions.
- When a future spec implements a sub-feature, that spec owns its own
  eval-NN playbook and its own unit/integration coverage. The mini-criteria in
  **Completion Criteria** above are the seed for that future playbook.
- Per-sub-feature intended coverage (for the future implementer, not now):
  - grep: unit-test the match-row formatter + row→file parse; e2e a temp
    fixture tree, Enter-to-jump, and `n`/`N` stepping.
  - recover-session: unit-test the artifact scan + sort by mtime; e2e a
    forced-crash fixture, list, and per-buffer restore; assert a clean
    `:w`/quit leaves **no** recoverable artifact (the auto-save must be
    reaped).
  - jump-to-register: unit-test snapshot/restore round-trip of a multi-window
    layout; assert a window-config register is **not** returned by text
    register ops (`get-register`, `register-list`).
  - info: unit-test the tree navigation (`next`/`prev`/`up`/`enter`) over a
    small fixture tree; e2e opening a known node.
  - tutorial: e2e `M-x tutorial` opens `*tutorial*` with non-empty lesson
    content and the first step's key advances to the next step.

## M-x Discoverability

A function appears in M-x completion **iff** it has a docstring **or** a
keybinding, per `command-detail-interactive-p` in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`:

```lisp
(defun command-detail-interactive-p (details)
  (or
    (> (length (hashmap-get details "documentation")) 0)
    (not (null (hashmap-get details "bindings")))))
```

Therefore, when each deferred command is implemented in its own future spec,
it **MUST** receive:

- a non-empty T-Lisp docstring (`(defun name () "doc" …)`), and/or
- a keybinding (e.g. a normal-mode binding for `jump-to-register`, a buffer-local
  binding in `*grep*`/`*info*`/`*recover*`/`*tutorial*`),

or it will be silently invisible in M-x despite being callable. The reserved
command names are: `grep`, `grep-jump`, `recover-session`,
`window-config-to-register`, `jump-to-register`, `info`, `tutorial`. No code is
added this pass, so no discoverability contract is created yet — this section
exists so the future implementer cannot ship a "missing from M-x" regression.

## Deferral Rationale

These five features are deferred (not dropped) because:

- Each is a **new subsystem** (results buffer lifecycle, auto-save artifact
  lifecycle, a new register capability, a tree-shaped reader model, a shipped
  lesson script). Bundling any into the current surgical pass would violate the
  project's "simplicity first / surgical changes" rules
  (`CLAUDE.md` §2, §3) and risk shipping half-built subsystems.
- They are **independent**: deferring all five costs nothing in coherence —
  each can land later in any order without touching the others, and the audit
  gaps they close are individually valuable, not coupled.
- The **primitives** they need (`read-dir`, `read-file-content`,
  `search-find-all-matches`, `window-list`, the workspace dir, the register
  factory pattern) already exist and are cited above, so the future work is
  integration + a new buffer/script, not new core plumbing.
- Deferring is **explicit and auditable** here, not silent: the reserved M-x
  names, the verified anchor files, and the per-sub-feature acceptance criteria
  are on record so a future spec can pick one up without re-discovery.

Out of scope for this meta-spec: any actual TypeScript/T-Lisp implementation of
the five commands, any new test file, and any keybinding. Those belong to the
per-sub-feature spec that lifts one of these sketches into a full plan.
