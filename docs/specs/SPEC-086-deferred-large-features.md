# Feature: Deferred large M-x features — grep, recover-session, jump-to-register (window-config), info, tutorial

> **Status: Deferred — implement per-sub-feature in dedicated sessions.**
> This meta-spec ships **no code**. Each sub-feature below is an independent
> subsystem; a future spec lifts **one** of the sketches here into a full plan
> + acceptance criteria + eval playbook and implements it. The per-sub-feature
> mini-criteria in **Completion Criteria** are the seed contract for that day.

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

> None of the criteria below are claimed as done by this meta-spec. They are the
> **acceptance criteria for the future implementer** of each sub-feature; this
> meta-spec's only deliverable is the catalog itself plus its five sub-sections.

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
- [x] This meta-spec exists at `docs/specs/SPEC-086-deferred-large-features.md`
  with a sub-section per sub-feature (Goals + Completion Criteria + Root Cause +
  Implementation sketch + Relevant Files) and a visible **"Deferred — implement
  per-sub-feature in dedicated sessions"** status + rationale block. (The only
  criterion this pass delivers.)

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
Read/Grep), the accurate root cause (why it is missing today), a tmax-specific
implementation sketch grounded in the existing factory / T-Lisp-layer patterns,
and the precise new file(s) the future implementer should add. A future spec
picks **one** sub-feature and implements it against the criteria above.

The five sub-features are **independent**: each can be shipped (and tested) on
its own, in any order, without touching the others.

## User Story

As a **tmax maintainer planning the post-alpha implementation backlog**,
I want **each large deferred M-x feature captured as a spec with its real
integration point, root cause, and design sketch, explicitly marked deferred**,
So that **a future implementation pass can pick exactly one up without
re-discovering the audit gap, re-reading the whole codebase, or accidentally
duplicating it under a different name.**

## Cross-Cutting Root Cause (investigated 2026-08-06)

All five features share the **same structural reason they are missing**, not
five different bugs:

- The `src/editor/api/*.ts` layer is deliberately **primitives-only** (`src/editor/CLAUDE.md`:
  "TypeScript here provides primitives ONLY. Editor logic lives in T-Lisp"). The
  primitives each feature needs (`read-dir`, `read-file-content`,
  `search-find-all-matches`, `window-list`, the workspace dir, the register
  factory) **already exist** — what is missing is the *composition layer*: a new
  `create*Ops` factory that holds the per-editor bookkeeping the T-Lisp layer
  cannot compute itself, plus a T-Lisp command module under
  `src/tlisp/core/commands/*.tlisp` that does the actual work.
- That composition layer follows one proven shape: a `create*Ops(): Map<string, TLispFunctionImpl>`
  factory wired as a contribution in `src/editor/tlisp-api.ts` (alongside
  `createSearchOps` at `tlisp-api.ts:257`, `createOccurOps`, `createEvilIntegrationOps`
  at `:469`, `createDocumentationOps` at `:519`), with the user-facing `(defun …)`
  logic living in a sibling `src/tlisp/core/commands/<name>.tlisp` that is
  auto-loaded by a `(require-module editor/commands/<name>)` line in
  `src/tlisp/core/bindings/normal.tlisp` (the occur module is required at
  `normal.tlisp:55` — the canonical place to register a new command module).
- The closest existing analog is **`occur`** (SPEC-082): a results buffer
  (`*Occur*`) built by composing `search-find-all-matches` + `buffer-create` +
  `jump-to-line`, with a thin primitives module (`src/editor/api/occur-ops.ts`,
  ~156 lines) that holds **only** the piece T-Lisp cannot compute — the
  `*Occur*`↔source-buffer name mapping. **grep is the multi-file generalization
  of occur; info/jump-to-register follow the same factory split; recover-session
  and tutorial are the same shape with different bookkeeping.**

Per-sub-feature root cause is in each section below.

## M-x Discoverability (applies to every sub-feature)

A function appears in M-x completion **iff** it has a docstring **or** a
keybinding, per `command-detail-interactive-p` in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`:

```lisp
(defun command-detail-interactive-p (details)
  (or
    (> (length (hashmap-get details "documentation")) 0)
    (not (null (hashmap-get details "bindings")))))
```

Therefore, when each deferred command is implemented, it **MUST** receive a
non-empty T-Lisp docstring (`(defun name () "doc" …)`) and/or a keybinding, or
it will be silently invisible in M-x despite being callable. The reserved
command names are: `grep`, `grep-jump`, `recover-session`,
`window-config-to-register`, `jump-to-register`, `info`, `tutorial`. The
occur module (`src/tlisp/core/commands/occur.tlisp:193-195`) is the reference
for "command defun + `(key-bind …)` + `(provide …)` in one file".

---

## Sub-feature: grep

### Root Cause (investigated 2026-08-06)

`read-dir` (`src/editor/api/file-ops.ts:369`, returns per-entry
`isFile`/`isDirectory`/`size`/`modified`) and the `search-find-all-matches`
primitive (`src/editor/api/search-ops.ts:651`, line-by-line substring match
returning `(line col)` pairs) both exist, but **nothing composes them across
files**. `search-find-all-matches` is hard-wired to the *current buffer*
(`getCurrentBuffer()` at `search-ops.ts:663`), and there is no `*grep*` buffer,
no row→file jump, and no `(grep …)` T-Lisp function. The single-buffer `occur`
command (`src/tlisp/core/commands/occur.tlisp`) is the existing pattern; grep is
its project-wide generalization, and the gap is purely "no one has written the
multi-file walk + per-file results assembly".

### Design (1 paragraph)

`grep` is a multi-file `occur`: walk a directory recursively with `read-dir`,
read each text file with `read-file-content` (reusing its UTF-8/binary guard,
BUG-56), run the proven substring match loop per file, and write
`file:line:col: text` rows into a `*grep*` special buffer. Result-navigation
keys (RET to parse a row, open the file, and jump to the line/col; `n`/`N` to
step rows) are bound via a **dedicated `grep` major mode** (`major-mode-register`
+ 4-arg `key-bind … major-mode`), NOT a global keymap with a buffer-current
guard — see the Codex adversarial review below for why. The TS layer holds
**only** the row→`{file,line,col}` mapping T-Lisp cannot re-derive from rendered
text cheaply; everything else (walk, match, jump) is T-Lisp composing existing
primitives, mirroring occur exactly.

### Relevant primitives that already exist (compose, do not reinvent)

- `read-dir` — `src/editor/api/file-ops.ts:369` (recursive walk: filter on
  `isDirectory` and recurse).
- `read-file-content` — `src/editor/api/file-ops.ts:115` (UTF-8 round-trip
  guard from BUG-56 refuses binary files; reuse so grep skips binaries safely).
- `search-find-all-matches` — `src/editor/api/search-ops.ts:651` (per-buffer
  match loop; the per-file loop in grep copies its `indexOf` shape but reads the
  file string, not the current buffer).
- `buffer-create` / `buffer-switch` / `buffer-insert-at-position` /
  `buffer-replace-range` / `buffer-line` / `buffer-line-count` —
  `src/editor/api/buffer-ops.ts` (used verbatim by occur.tlisp to build/clear
  `*Occur*`).
- `jump-to-line` — `src/editor/api/jump-ops.ts` (1-indexed, used by occur-jump).
- The `occur` reference implementation — `src/editor/api/occur-ops.ts` (the
  ~156-line primitives-only template) + `src/tlisp/core/commands/occur.tlisp`
  (the T-Lisp logic).

### New files needed

- **NEW `src/editor/api/grep-ops.ts`** — `createGrepOps(): Map<string, TLispFunctionImpl>`,
  mirrors `createOccurOps` (`occur-ops.ts:44`). Holds a per-editor
  `Map<row-number, {file, line, col}>` populated as the `*grep*` buffer is
  built, and exposes `grep-row-set`, `grep-row-get`, `grep-buffer-name`
  primitives (no docstrings → not user commands, exactly like
  `occur-set-source`/`occur-source-get`/`occur-buffer-name`).
- **NEW `src/tlisp/core/commands/grep.tlisp`** — `defmodule editor/commands/grep`
  exporting `grep`, `grep-jump`, `grep-prompt`. Port `occur.tlisp`'s structure
  (header line, per-row insert, RET guarded jump, `SPC s p` / `SPC s g` prompt
  binding) but walk files via `read-dir` + `read-file-content` instead of
  `search-find-all-matches` on the current buffer. **Register a `grep` major
  mode** (`major-mode-register "grep" '() "fundamental"`), `(major-mode-set "grep")`
  on entering `*grep*`, and scope RET/n/N with the 4-arg `key-bind … major-mode`
  form instead of occur's global RET + buffer-current guard (see Codex review).
- **Wire** `createGrepOps` as a contribution in `src/editor/tlisp-api.ts` next
  to the occur contribution (`tlisp-api.ts:1832-1841`), and add
  `(require-module editor/commands/grep)` to
  `src/tlisp/core/bindings/normal.tlisp` near line 55.

### Approach

1. Copy `occur-ops.ts` → `grep-ops.ts`; replace the `Map<occur-buf, source-buf>`
   string with `Map<row-number, {file, line, col}>` and rename the three
   primitives. Keep the `*grep*` canonical name constant.
2. Copy `occur.tlisp` → `grep.tlisp`; swap the match phase: add a
   `grep--walk-dir` helper that recurses via `read-dir`, skips directories and
   binary read failures (`read-file-content` returns nil), and for each text
   file collects `(file line col text)` rows via the same `indexOf` loop
   `search-find-all-matches` uses. Write rows into `*grep*` with
   `buffer-insert-at-position` and call `grep-row-set` per row so the index
   matches the rendered row.
3. `grep-jump` (bound to RET **in the `grep` major mode**, via the 4-arg
   `key-bind` form, not globally) reads the row index from `(cursor-line)`, calls
   `grep-row-get`, opens the file (`find-file`/`openFile` — see how
   `find-file.tlisp` opens a path), and `jump-to-line`s to the recorded line.
   `n`/`N` move the cursor a row and re-jump — also major-mode-scoped, since a
   global `n`/`N` would steal isearch-next in every other buffer (see Codex
   review).
4. Subprocess `rg`/`grep` dispatch is an **optional** later optimization gated
   on availability; the primitive-based path is the portable default and keeps
   zero-external-dependencies intact.

### Sub-feature completion criteria (verifiable)

- [ ] `(grep "TODO")` against a 3-file temp fixture fills `*grep*` with one row
  per match across all three files, in `file:line:col: text` form.
- [ ] RET on a `*grep*` row opens the file and lands the cursor on the recorded
  line+col.
- [ ] `n` / `N` step to the next/previous row and re-jump.
- [ ] Binary/non-UTF-8 files in the tree are silently skipped (no crash, no row).
- [ ] `grep` appears in `M-x` completion (docstring present).

---

## Sub-feature: recover-session

### Root Cause (investigated 2026-08-06)

`WorkspaceManager` persists the **whole workspace** atomically to
`TMAX_WORKSPACE_DIR` (`src/core/workspace.ts:41-43`, `defaultWorkspaceDir()`;
save path `writeWorkspaceData` at `:269`; serialized `WorkspaceData` shape at
`src/core/contracts/workspace.ts:104` with `buffers[].modified`/`filename`/
`content`). The daemon also restores a stale workspace on startup (server
`cleanStart`, BUG-58 context). **What does not exist**: a per-buffer auto-save
artifact that survives an abnormal exit, and an **interactive, per-buffer
recover** command. So if a session crashes between workspace saves (or the
startup restore is bypassed), a dirty buffer's unsaved text is silently
unrecoverable from inside the editor. There is no `*recover*` buffer and no
`(recover-session)` function — the gap is the missing artifact lifecycle +
the missing scan/restore command, not missing storage plumbing.

### Design (1 paragraph)

Extend the workspace layer to write per-buffer auto-save artifacts into
`TMAX_WORKSPACE_DIR` (one file per dirty buffer, named by a stable hash of the
buffer's filename) on a dirty-flag/timer, and **reap them on clean `:w`/quit** so
they only survive a crash. A new `recover-session` command scans the dir for
orphaned artifacts, lists them in a `*recover*` buffer (source file + mtime),
and on selection reads the artifact and reopens the target buffer with the
recovered content. The interactive recover path is deliberately separate from
the automatic startup workspace-restore path — they must not fight over the same
files.

### Relevant primitives that already exist

- `defaultWorkspaceDir()` / `TMAX_WORKSPACE_DIR` — `src/core/workspace.ts:41`
  (the auto-save dir; reuse rather than introducing a new env var).
- `WorkspaceManager` — `src/core/workspace.ts:78` (atomic write + one-generation
  backup pattern at `writeWorkspaceData:269`; mirror its `fs.promises.writeFile`
  + rename atomicity for the per-buffer artifacts).
- `read-dir` / `read-file-content` / `write-file-content` —
  `src/editor/api/file-ops.ts:369` / `:115` / `:69` (scan + read + reap the
  artifacts).
- Buffer open/create primitives — `src/tlisp/core/commands/find-file.tlisp` +
  `buffer-create`/`buffer-switch` (`src/editor/api/buffer-ops.ts`).
- Server `cleanStart` restore path — `src/server/server.ts` +
  `src/editor/runtime/workspace-runtime.ts` (BUG-58 context); the
  recover-session path coexists with this and must not touch the same files.

### New files needed

- **Extend `src/core/workspace.ts`** (or add `src/core/auto-save.ts`) with a
  small `AutoSaveManager`: `writeArtifact(bufferName, filename, content)`,
  `listArtifacts()` (returns `{artifactPath, sourceFile, mtime}`),
  `readArtifact(path)`, `reapArtifact(path)` / `reapAll()`. Reuses
  `defaultWorkspaceDir()` + an `autosave/` subdir.
- **NEW `src/editor/api/recover-ops.ts`** — `createRecoverOps(filesystem): Map<string, TLispFunctionImpl>`,
  thin T-Lisp-facing wrappers over `AutoSaveManager` (mirror `createOccurOps`
  shape). Exposes `recover-list`, `recover-read`, `recover-reap` primitives
  (no docstrings → stay out of M-x; the user command is the T-Lisp `recover-session`).
- **NEW `src/tlisp/core/commands/recover-session.tlisp`** — the user-facing
  `(recover-session)` defun: call `recover-list`, render into `*recover*` with
  `buffer-insert-at-position`, and on a selected row call `recover-read` +
  `find-file` the source + `buffer-replace-range` the recovered content in.
- **Wire** `createRecoverOps` into `src/editor/tlisp-api.ts` and add
  `(require-module editor/commands/recover-session)` to `normal.tlisp`.
- **Hook the writer**: call `AutoSaveManager.writeArtifact` from the existing
  dirty-buffer / save path (find the buffer-modified transition in
  `src/editor/editor.ts` or buffer-ops) and `reapArtifact` from the clean
  `:w`/buffer-save path (`src/tlisp/core/commands/save.tlisp`).

### Approach

1. Decide the artifact naming: `<sha256(filename || buffer-name)>` under
  `${TMAX_WORKSPACE_DIR}/autosave/`, content = the dirty buffer text, with a
   small JSON sidecar or filename-encoded source path + mtime. Document it.
2. Implement `AutoSaveManager` in `src/core/` mirroring `WorkspaceManager`'s
   atomic-write + TaskEither error style.
3. Wire write-on-dirty + reap-on-clean. **Critical invariant** (assert in tests):
   a clean `:w` + quit leaves **zero** artifacts, so a recover list is empty
   after a graceful exit and only non-empty after a crash.
4. Implement `recover-session.tlisp` as an `occur`-style listing: `*recover*`
   buffer, one row per artifact, RET (or `y`) restores that one buffer.
5. Document the relationship to the startup workspace restore: startup restore
   = automatic, whole-workspace; `recover-session` = interactive, per-buffer,
   on-demand. They read different artifacts (workspace JSON vs. autosave
   files) so they cannot collide.

### Sub-feature completion criteria (verifiable)

- [ ] After a forced-crash fixture (dirty buffer, no clean `:w`),
      `M-x recover-session` lists that buffer in `*recover*` with source file +
      mtime.
- [ ] Restoring a listed buffer reopens the file buffer with the recovered
      (pre-crash) content.
- [ ] A clean `:w` + quit leaves **no** artifacts (recover list is empty) —
      the auto-save is reaped on graceful save.
- [ ] `recover-session` appears in `M-x` completion.

---

## Sub-feature: jump-to-register (window-config)

### Root Cause (investigated 2026-08-06)

The register system is **text-only by construction**:
`src/editor/api/evil-integration.ts:33` defines `RegisterState { storage: string[]; unnamed: string }`,
and `bindRegisters` (`:74`) only ever stores strings. There is no slot for a
window layout, and `(jump-to-register)` does not exist. The window model needed
to snapshot/restore **does** exist — `window-list` (`src/editor/api/window-ops.ts:177`,
returns each window as `(id cursorLine cursorColumn)` plus the buffer name is
reachable), `setWindows` (`window-ops.ts:26`, the restore callback), and the
`Window` contract (`src/core/contracts/editor.ts:148`, carries `bufferName`,
`cursorLine`, `cursorColumn`, `viewportTop/Left`, `splitType`, geometry). The
gap is a **typed window-config slot on `RegisterState`** + two ops; no new
window primitive is required.

### Design (1 paragraph)

Add an **optional, typed** `windowConfigs: Map<register-name, WindowConfigSnapshot>`
slot to `RegisterState` (a new shape, not a string overload — text registers in
`storage` stay untouched). `windowConfigToRegister(name)` snapshots the current
`Window[]` (ids, buffer names, cursor positions, viewport, split geometry) plus
the current window index into that map; `jumpToRegister(name)` restores it via
the existing `setWindows` / `setCurrentWindowIndex` callbacks and re-points each
window at its saved buffer. Text register ops (`get-register`, `register-list`)
never see window-config entries, so the two register kinds cannot be confused.

### Relevant primitives that already exist

- `RegisterState` + `bindRegisters` + `RegisterOps` —
  `src/editor/api/evil-integration.ts:33` / `:74` / `:63` (the place to add the
  slot and two methods).
- `window-list` — `src/editor/api/window-ops.ts:177` (snapshot source).
- `setWindows` / `setCurrentWindowIndex` callbacks — `window-ops.ts:26-27`
  (restore path; already plumbed through `createWindowOps`).
- `Window` contract — `src/core/contracts/editor.ts:148` (the fields to
  snapshot: `id`, `bufferName`, `cursorLine/Column`, `viewportTop/Left`,
  `splitType`, `height/width`, `row/col`).
- `createEvilIntegrationOps` wiring — `src/editor/tlisp-api.ts:469`.

### New files needed

- **Edit `src/editor/api/evil-integration.ts`**: add a `WindowConfigSnapshot`
  type + `windowConfigs: Map<string, WindowConfigSnapshot>` to `RegisterState`
  (`:33`); extend `bindRegisters` (`:74`) with `windowConfigToRegister(name,
  windows, currentIndex)` and `jumpToRegister(name)` methods on `RegisterOps`
  (`:63`); expose them via `createEvilIntegrationOps` (`:146`) as
  `(window-config-to-register "r")` and `(jump-to-register "r")`.
- **No new T-Lisp command module strictly required** — the two functions are
  primitives composed directly. Optionally add a tiny
  `src/tlisp/core/commands/registers.tlisp` if extra bindings are wanted (e.g.
  bind `jump-to-register` behind an SPC prefix). If added, require it from
  `normal.tlisp`.
- `listEntries` (`:118`) MUST **not** list window-config registers (they are not
  text) — keep them invisible to `register-list`.

### Approach

1. Define `WindowConfigSnapshot = { windows: Array<Pick<Window, 'id'|'bufferName'|'cursorLine'|'cursorColumn'|'viewportTop'|'viewportLeft'|'splitType'|'height'|'width'|'row'|'col'>>; currentIndex: number }`.
2. `windowConfigToRegister(name)`: read the live `Window[]` (via the
   `getWindows` already available to `createWindowOps`; pass an accessor into
   `bindRegisters` or read through `EditorModelAccess`), project each window to
   the snapshot fields, store under `state.windowConfigs.get(name)`.
3. `jumpToRegister(name)`: look up the snapshot, rebuild `Window[]` (re-attach
   each `bufferName` to its live `TextBuffer` via the buffer manager), call
   `setWindows(...)` + `setCurrentWindowIndex(...)`. Reuse the same restore
   path `set-windows` (`window-ops.ts`) already uses.
4. Keep text ops unchanged: `get`/`set`/`listEntries` only touch `storage` /
   `unnamed`, so a window-config register is invisible to them — assert this in
   tests.

### Sub-feature completion criteria (verifiable)

- [ ] `(window-config-to-register "r")` then changing the window layout, then
      `(jump-to-register "r")` restores the exact saved layout (window count,
      per-window buffer + cursor + viewport).
- [ ] A window-config register is **not** returned by `get-register` /
      `register-list` (text and window-config registers are disjoint).
- [ ] `window-config-to-register` and `jump-to-register` appear in `M-x`.

---

## Sub-feature: info

### Root Cause (investigated 2026-08-06)

`src/editor/api/documentation.ts:37` holds the doc catalogue as a **flat**
`DOCUMENTATION_DATABASE: DocumentationEntry[]` (each entry has `name`,
`category`, `signature`, `description`, `examples`, `related`, `type`), and
`createDocumentationOps` (`:635`) exposes only flat queries:
`(documentation-list)` (`:642`), `(documentation-search)` (`:657`), plus
`getDocumentation`/`getByCategory`/`getCategories` helpers (`:581`/`:596`/`:588`).
There is **no tree** — no parent/child/sibling structure — so the `n`/`p`/`u`/
`Enter` navigation users expect from `M-x info` is meaningless against the
current data. The gap is a tree model (either reorganise the DB or layer a tree
index on top by `category` → entry) plus a navigable `*info*` buffer.

### Design (1 paragraph)

Introduce a `DocNode` tree — minimally, group the existing flat
`DOCUMENTATION_DATABASE` by `category` (root → category nodes → entry leaves),
with optional `related` links as cross-references. A new `info` command opens an
`*info*` special buffer rendering the current node (header + body + child list)
and the navigation keys (`next`/`prev`/`up`/`Enter`) are bound via a dedicated
`info` major mode (`major-mode-register` + 4-arg `key-bind … major-mode`), NOT a
buffer-local keymap — see the Codex adversarial review for why (a global n/p/u
would steal normal-mode paragraph/search-next keys). This is distinct from the
**flat** `(documentation-list)` / `(documentation-search)` already shipped —
those stay as quick lookup; `info` is the navigable manual.

### Relevant primitives that already exist

- `DOCUMENTATION_DATABASE` + `DocumentationEntry` —
  `src/editor/api/documentation.ts:37` / (interface at `:~20`, fields include
  `category` and `related` — the natural tree edges).
- `createDocumentationOps` + `listDocumentation` / `getByCategory` /
  `getCategories` — `documentation.ts:635` / `:560` / `:596` / `:588` (build the
  tree from these; no new data source needed for the MVP).
- Buffer-create/switch/insert/clear primitives — `src/editor/api/buffer-ops.ts`
  (same set occur/info render into a special buffer).
- `createDocumentationOps` wiring — `src/editor/tlisp-api.ts:519`.

### New files needed

- **Edit or extend `src/editor/api/documentation.ts`**: add a `DocNode` tree
  type (`{ id; title; body?; children: DocNode[]; parent?: DocNode; related?: string[] }`)
  and a `buildDocTree(): DocNode` that groups `DOCUMENTATION_DATABASE` by
  `category` (one category node per `getCategories()` result, one child leaf per
  entry in `getByCategory(cat)`). Keep the flat DB + ops intact.
- **NEW `src/editor/api/info-ops.ts`** — `createInfoOps(): Map<string, TLispFunctionImpl>`,
  exposing `info-node-get`/`info-node-children`/`info-node-parent`/
  `info-render-node` primitives plus a per-editor "current node" cursor (the one
  piece T-Lisp cannot re-derive cheaply). Mirrors `createOccurOps`.
- **NEW `src/tlisp/core/commands/info.tlisp`** — `(info &optional node)` opens
  `*info*` at the root (or named node), renders via `info-render-node`, and binds
  `n`/`p`/`u`/`RET` via a **dedicated `info` major mode** (`major-mode-register`
  + 4-arg `key-bind … major-mode` + `major-mode-set "info"` on entering `*info*`),
  not a buffer-local keymap (see Codex review).
- **Wire** `createInfoOps` next to `createDocumentationOps`
  (`tlisp-api.ts:519`) and add `(require-module editor/commands/info)` to
  `normal.tlisp`.

### Approach

1. MVP tree = category grouping (no schema change to `DOCUMENTATION_DATABASE`).
  Later: promote `related` into real edges, or ship `.info` files. Keep the
   flat API as-is so `documentation-search` keeps working.
2. `info-ops.ts` holds `currentNodeId`; the T-Lisp layer calls
   `info-node-children`/`info-node-parent` to navigate and `info-render-node`
   to (re)build the `*info*` body (clear + insert, exactly like occur's
   clear+insert).
3. `info-jump` (RET) reads the child under point and descends; `up`/`next`/
   `prev` move the current-node cursor and re-render.

### Sub-feature completion criteria (verifiable)

- [ ] `(info)` opens `*info*` showing the root (category list).
- [ ] `Enter` on a category descends to its entries; `u` returns to the parent;
      `n`/`p` move between siblings.
- [ ] Opening a known node renders its `signature`/`description`/`examples`
      (sourced from the existing DB — no content duplication).
- [ ] The flat `(documentation-list)` / `(documentation-search)` still work
      unchanged.
- [ ] `info` appears in `M-x` completion.

---

## Sub-feature: tutorial

### Root Cause (investigated 2026-08-06)

There is no shipped tutorial buffer and no `(tutorial)` function — purely a
missing shipped lesson, not a missing primitive. The T-Lisp command-module
infrastructure to host it is fully in place: every shipped command lives as
`src/tlisp/core/commands/<name>.tlisp`, is auto-loaded by a
`(require-module editor/commands/<name>)` line in
`src/tlisp/core/bindings/normal.tlisp` (the occur module is required at
`normal.tlisp:55` — the canonical registration point), and follows the
`defun` + `(key-bind …)` + `(provide "name")` shape documented in
`src/tlisp/CLAUDE.md`. The buffer primitives it needs (`buffer-create`,
`buffer-switch`, `buffer-insert-at-position`) already exist. Per
`src/editor/CLAUDE.md` the lesson **logic** belongs in T-Lisp, not the TS core.

### Design (1 paragraph)

Ship a `tutorial.tlisp` under `src/tlisp/core/commands/` (alongside the other
shipped command modules) that, when its `(tutorial)` function is called,
creates/switches to a `*tutorial*` buffer and renders the first step of a guided
modal-editing lesson. The lesson state (current step) lives in a T-Lisp
module-level variable; a `*tutorial*`-local binding advances to the next step,
re-renders the buffer, and checks the step's expected keystroke. The TS layer is
untouched — this is pure T-Lisp composing existing buffer primitives, exactly as
`src/tlisp/CLAUDE.md` prescribes.

### Relevant primitives that already exist

- The command-module load path — `(require-module editor/commands/<name>)` in
  `src/tlisp/core/bindings/normal.tlisp:55` (add one line for tutorial).
- `buffer-create` / `buffer-switch` / `buffer-insert-at-position` /
  `buffer-replace-range` / `buffer-line-count` — `src/editor/api/buffer-ops.ts`
  (the same set occur uses to build/clear a special buffer).
- `(key-bind …)` — used by every command module (e.g. `occur.tlisp:193`).
- `(message …)` — for step feedback.

### New files needed

- **NEW `src/tlisp/core/commands/tutorial.tlisp`** — `defmodule editor/commands/tutorial`
  exporting `tutorial` (and helpers like `tutorial--render-step`,
  `tutorial--next-step`). Holds a `(defvar tutorial--step 0)` and a lesson data
  structure (a T-Lisp list of step strings / expected keys). Creates the
  `*tutorial*` buffer on first call, clears + re-renders on each step.
- **One-line edit** to `src/tlisp/core/bindings/normal.tlisp`: add
  `(require-module editor/commands/tutorial)` near line 55.
- **No TypeScript changes** — this is the one sub-feature that is T-Lisp-only.

### Approach

1. Author 5-8 short steps: "move with h j k l", "enter insert with i, leave with
   Escape", "save with :w, quit with :q", "search with /", "open the M-x menu
   with SPC ;". Each step is a `(title body expected-key next-fn)` entry.
2. `tutorial` creates `*tutorial*` if absent, switches to it, renders step 0 in
   normal mode.
3. A `*tutorial*`-local binding (guarded by `(buffer-current) == "*tutorial*"`,
   the occur-jump pattern) calls `tutorial--next-step` on the expected key;
   mismatched keys show a `(message …)` hint rather than advancing.
4. `(tutorial)` returns the buffer name `"*tutorial*"`.
5. Keep the lesson data in T-Lisp (a quoted list), not the TS core, per
   `src/editor/CLAUDE.md`.

### Sub-feature completion criteria (verifiable)

- [ ] `M-x tutorial` opens `*tutorial*` with non-empty first-step content.
- [ ] The first step's expected key advances to step 2 (buffer re-renders).
- [ ] `(tutorial)` returns `"*tutorial*"`.
- [ ] `tutorial` appears in `M-x` completion (docstring present).

---

## Codex adversarial review (2026-08-06) — correction

The grep and info sub-feature sketches above assume "buffer-local" key bindings
for `*grep*`/`*info*` result navigation (n/N/hjkl/RET and n/p/u/RET). **That
machinery does not exist in tmax.** Unlike `occur`'s RET — which is bound in the
global normal keymap and is a near-no-op everywhere else — globally binding `n`,
`N`, `p`, `u` for these buffers would **steal** real normal-mode keys (isearch
next/prev `n`/`N`, paragraph motion) in every other buffer, and a
`(buffer-current == *grep*)` guard inside the command does not help because the
key is intercepted before its normal handler ever runs.

**Corrected approach (applies to the grep and info sub-sections):** scope the
result-navigation keys with a **dedicated major mode**, using the existing
machinery — `(major-mode-register "grep" ...)` / `(major-mode-register "info" ...)`,
`(major-mode-set "grep")` on entering the special buffer, and the 4-arg
`(key-bind key command mode major-mode)` form (verified in
`src/editor/editor.ts:458-511`, used by `markdown.tlisp`). This adds no new
TS machinery; it reuses the major-mode-keymap dispatch path. The **global** key
each command keeps is only its SPC-prefixed launcher (`SPC s p`/`SPC s g` for
grep), never `n`/`N`/`RET`. The implementer should re-derive the exact per-major
mode key set from the occur pattern rather than copying occur's global-RET guard.

## Implementation Plan

> **Not executed this pass.** The plan below is the recommended sequence for the
> future implementer of **one** chosen sub-feature. Each sub-feature is
> independent; do not attempt more than one per pass.

1. **Pick exactly one** sub-feature from the five above. Open a dedicated spec
   (e.g. `SPEC-0NN-grep.md`) that lifts this meta-spec's mini-criteria into
   full acceptance criteria + an eval playbook, and resolves the open design
   questions named in that sub-feature's Approach (subprocess vs. primitive
   grep; auto-save artifact naming + write-on-dirty hook point;
   `WindowConfigSnapshot` exact field set + buffer re-attach; DocNode tree
   shape — category-grouping MVP vs. real edges; tutorial lesson outline).
2. Read every file cited in that sub-feature's **Relevant primitives** /
   **Relevant Files** (they are already verified to exist; do not
   re-hallucinate paths). Re-read the cited `occur` reference pair
   (`src/editor/api/occur-ops.ts` + `src/tlisp/core/commands/occur.tlisp`) — it
   is the template for grep, info, and (listing-style) recover-session.
3. Add the new `create*Ops` module under `src/editor/api/` following the
   `createOccurOps` factory shape (primitives only; per-editor closure state;
   no docstrings on internal helpers). For jump-to-register, edit
   `evil-integration.ts` in place instead. For tutorial, add **only** the
   `.tlisp` file (no TS).
4. Wire the new factory as a contribution in `src/editor/tlisp-api.ts` next to
   its sibling (`createOccurOps` at `:1832`, `createEvilIntegrationOps` at
   `:469`, `createDocumentationOps` at `:519`).
5. Add the T-Lisp command module under `src/tlisp/core/commands/<name>.tlisp`
   (skip for jump-to-register unless extra bindings are wanted) and register it
   with one `(require-module editor/commands/<name>)` line in
   `src/tlisp/core/bindings/normal.tlisp` near line 55.
6. Give every new user command a **docstring** (so it appears in M-x completion
   per `command-detail-interactive-p`, `execute-extended-command.tlisp:15-19`)
   and, where appropriate, a `(key-bind …)` (mirror `occur.tlisp:193-195`).
7. Add unit tests (primitive-level, against the new `create*Ops` factory) and
   an e2e playbook; run `bun run typecheck:src`, `bun run typecheck:test`,
   `bun run test:unit`, and the relevant e2e harness before claiming done.
8. Update this meta-spec: move the finished sub-feature's status from
   "Deferred" to "Done — see SPEC-0NN" and leave the others deferred.

## Test Plan

- **No eval-NN playbook is assigned to this meta-spec** (playbook: N/A). All
  five sub-features are **excluded from the eval-22..47 run** for this pass —
  they ship no code and have no e2e assertions.
- When a future spec implements a sub-feature, that spec owns its own
  eval-NN playbook and its own unit/integration coverage. The mini-criteria in
  each sub-feature's **completion criteria** above are the seed for that future
  playbook.
- Per-sub-feature intended coverage (for the future implementer, not now):
  - **grep**: unit-test the row formatter + row→`{file,line,col}` round-trip in
    `grep-ops.ts`; e2e a temp fixture tree, Enter-to-jump, `n`/`N` stepping,
    and binary-skip.
  - **recover-session**: unit-test the artifact scan + mtime sort +
    write/reap lifecycle in `AutoSaveManager`; e2e a forced-crash fixture,
    list, per-buffer restore; **assert a clean `:w`/quit leaves no artifact**
    (the auto-save must be reaped — this is the key invariant).
  - **jump-to-register**: unit-test snapshot/restore round-trip of a
    multi-window layout; assert a window-config register is **not** returned by
    `get-register` / `register-list`.
  - **info**: unit-test the tree build (`buildDocTree`) +
    `next`/`prev`/`up`/`enter` navigation over a small fixture; e2e opening a
    known node.
  - **tutorial**: e2e `M-x tutorial` opens `*tutorial*` with non-empty content
    and the first step's expected key advances to step 2.

## Relevant Files (anchor index)

All paths below were read before this section was written. They are the
**anchor** files the future implementer touches, grouped by sub-feature.

### grep
- **`src/editor/api/file-ops.ts`** — `read-dir` (`:369`) + `read-file-content`
  (`:115`, UTF-8 guard BUG-56).
- **`src/editor/api/search-ops.ts`** — `search-find-all-matches` (`:651`, the
  per-buffer match loop to generalise across files).
- **`src/editor/api/buffer-ops.ts`** — `buffer-create`/`buffer-switch`/
  `buffer-insert-at-position`/`buffer-replace-range`/`buffer-line`/
  `buffer-line-count`.
- **`src/editor/api/occur-ops.ts`** — the ~156-line **template** to copy for
  `grep-ops.ts` (`createOccurOps` at `:44`).
- **`src/tlisp/core/commands/occur.tlisp`** — the **template** to copy for
  `grep.tlisp` (match→build listing→guarded RET jump; bindings at `:193-195`).
- **`src/editor/api/jump-ops.ts`** — `jump-to-line` (1-indexed) for `grep-jump`.
- **`src/tlisp/core/commands/find-file.tlisp`** — file-open path for the jump.
- **NEW `src/editor/api/grep-ops.ts`** + **NEW `src/tlisp/core/commands/grep.tlisp`**.
- **`src/editor/tlisp-api.ts`** — wire `createGrepOps` near `:1832` (occur).
- **`src/tlisp/core/bindings/normal.tlisp:55`** — add the require-module line.

### recover-session
- **`src/core/workspace.ts`** — `defaultWorkspaceDir()` (`:41`),
  `WorkspaceManager` (`:78`), `writeWorkspaceData` atomic write (`:269`).
- **`src/core/contracts/workspace.ts`** — `WorkspaceData` shape (`:104`).
- **`src/server/server.ts`** + **`src/editor/runtime/workspace-runtime.ts`** —
  the existing stale-workspace startup restore (cleanStart, BUG-58 context);
  recover-session coexists with this.
- **`src/editor/api/file-ops.ts`** — `read-dir`/`read-file-content`/
  `write-file-content` (`:369`/`:115`/`:69`).
- **`src/tlisp/core/commands/save.tlisp`** — the clean `:w` path to hook
  reap-on-save into.
- **NEW `src/core/auto-save.ts`** (or extend `workspace.ts`) + **NEW
  `src/editor/api/recover-ops.ts`** + **NEW
  `src/tlisp/core/commands/recover-session.tlisp`**.
- **`src/editor/tlisp-api.ts`** + **`src/tlisp/core/bindings/normal.tlisp`** —
  wire + require.

### jump-to-register (window-config)
- **`src/editor/api/evil-integration.ts`** — `RegisterState` (`:33`),
  `bindRegisters`/`RegisterOps` (`:74`/`:63`), `createEvilIntegrationOps`
  (`:146`), `listEntries` (`:118` — must stay text-only).
- **`src/editor/api/window-ops.ts`** — `window-list` (`:177`), `setWindows`/
  `setCurrentWindowIndex` callbacks (`:26-27`).
- **`src/core/contracts/editor.ts`** — `Window` interface (`:148`).
- **`src/editor/tlisp-api.ts:469`** — `createEvilIntegrationOps` wiring.
- (Optional NEW `src/tlisp/core/commands/registers.tlisp` for extra bindings.)

### info
- **`src/editor/api/documentation.ts`** — flat `DOCUMENTATION_DATABASE`
  (`:37`), `createDocumentationOps` (`:635`), `listDocumentation`/`getByCategory`/
  `getCategories` (`:560`/`:596`/`:588`).
- **`src/editor/api/occur-ops.ts`** — template for `createInfoOps` (per-editor
  "current node" cursor ≈ occur's source map).
- **NEW `src/editor/api/info-ops.ts`** + **NEW
  `src/tlisp/core/commands/info.tlisp`**.
- **`src/editor/tlisp-api.ts:519`** — wire `createInfoOps` next to
  `createDocumentationOps`.
- **`src/tlisp/core/bindings/normal.tlisp`** — require-module line.

### tutorial
- **NEW `src/tlisp/core/commands/tutorial.tlisp`** (T-Lisp only).
- **`src/tlisp/core/bindings/normal.tlisp:55`** — one
  `(require-module editor/commands/tutorial)` line.
- **`src/editor/api/buffer-ops.ts`** — buffer primitives the lesson calls.
- **`src/tlisp/CLAUDE.md`** + **`src/editor/CLAUDE.md`** — the
  "logic in T-Lisp, primitives in TS" rule this sub-feature follows.

## Deferral Rationale

These five features are deferred (not dropped) because:

- Each is a **new subsystem** (results-buffer lifecycle, auto-save artifact
  lifecycle, a new register capability, a tree-shaped reader model, a shipped
  lesson script). Bundling any into the current surgical pass would violate the
  project's "simplicity first / surgical changes" rules
  (`CLAUDE.md` §2, §3) and risk shipping half-built subsystems.
- They are **independent**: deferring all five costs nothing in coherence —
  each can land later in any order without touching the others, and the audit
  gaps they close are individually valuable, not coupled.
- The **primitives** they need (`read-dir`, `read-file-content`,
  `search-find-all-matches`, `window-list`, the workspace dir, the register
  factory, the command-module load path) already exist and are cited above, so
  the future work is integration + a new buffer/script, not new core plumbing.
  The `occur` subsystem (SPEC-082) is the proven template for four of the five.
- Deferring is **explicit and auditable** here, not silent: the reserved M-x
  names, the verified anchor files, the per-sub-feature root cause, and the
  per-sub-feature acceptance criteria are on record so a future spec can pick
  one up without re-discovery.

Out of scope for this meta-spec: any actual TypeScript/T-Lisp implementation of
the five commands, any new test file, and any keybinding. Those belong to the
per-sub-feature spec that lifts one of these sketches into a full plan.
