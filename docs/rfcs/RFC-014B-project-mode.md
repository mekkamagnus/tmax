# RFC-014B: project-mode — Project Awareness and File Management

**Date:** 2026-06-12
**Status:** Proposed
**Author:** Mekael Turner
**Parent:** [RFC-014: Workspace System](RFC-014-workspace-system.md)

## Summary

Project awareness for tmax workspaces. A project is a directory tree with a recognized root marker (`.git`, `.hg`, `package.json`, `.project`). Once bound to a workspace, the project provides file discovery, project-wide search, directory-aware completion, and workspace-project persistence — the workspace remembers which project it belongs to across restarts.

This is a major mode + a set of T-Lisp commands, not a UI feature. The mode activates automatically when a workspace has a project root; the commands provide the project-level operations that replace `find`, `grep`, and tmux window-per-directory workflows.

## Motivation

Developers work in projects, not files. Today tmax has no concept of project — opening `src/editor/editor.ts` is an isolated act. There's no way to:

- Find other files in the same project
- Search across project files
- Know which project a workspace belongs to
- Have the shell default to the project root
- Jump between projects without losing context

tmux partially addresses this through per-project sessions (`tmux new -s project-a`), but the editor itself is project-blind. Project-mode makes tmax project-aware at the editor level, and the workspace system carries the binding across restarts.

## Design

### Project Root Detection

Heuristic search upward from the current file's directory (or CWD if no file):

1. **VCS markers:** `.git`, `.hg`, `.svn`
2. **Project files:** `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `bun.lock`, `bunfig.toml`
3. **Explicit marker:** `.tmax.project` or `.project` (user-created)
4. **Fallback:** `$HOME` (no project detected)

The first marker found walking upward wins. Detection runs:
- On file open (if no project is bound)
- On `project-detect` command
- On workspace restore (re-validate that the root still exists)

### Project State

```
Project
├── root: string                    // absolute path to project root
├── name: string                    // directory basename or .project config
├── vcs: 'git' | 'hg' | 'svn' | 'none'
├── ignorePatterns: string[]        // from .gitignore, .tmaxignore
├── fileCache: Map<string, FileInfo> // lazy-populated
└── config?: ProjectConfig          // from .tmax.project
```

**`.tmax.project` configuration file (optional):**

```lisp
;; .tmax.project — placed in project root
(name "my-project")
(ignore "node_modules" ".git" "dist" "build")
(shell-default-dir "src")
(open-on-start "README.md" "src/main.ts")
(workspace-layout
  (window (file "src/main.ts") (split vertical))
  (window (shell)))
```

### Workspace-Project Binding

A workspace can be bound to one project (or none):

```lisp
(project-bind "/path/to/project-root")   ;; explicit
(project-unbind)                           ;; remove binding
(project-root)                             ;; query current root
```

On workspace restore, the project binding is re-validated. If the root directory no longer exists, the workspace opens without a project (warning in `*Messages*`).

The project root becomes the default CWD for new shell-mode windows in this workspace (see RFC-014A).

### Project File Discovery

**`project-find-file`** — interactive file finder:

1. Walk the project directory tree (respecting `.gitignore` and `.tmaxignore`)
2. Cache results in memory (invalidate on `project-refresh`)
3. Present candidates in the minibuffer with fuzzy matching
4. Selected file opens in current window

**Implementation notes:**
- Directory walking uses `Bun.file.readdir` with recursive option
- Ignore patterns use `.gitignore` parsing (extend existing `Glob` patterns)
- Cache is lazy: built on first `project-find-file`, invalidated on `project-refresh` or after 60s
- For large projects (>10k files), use streaming/deferred results with incremental filtering

**`project-find-dir`** — same as above but for directories (useful for `cd` in shell-mode).

### Project-Wide Search

**`project-search <pattern>`** — search across all project files:

1. Walk project files (same ignore rules as `project-find-file`)
2. Run pattern match (regex or literal) on each file's content
3. Collect results as `(file line-number line-text)` tuples
4. Open results in a `*Search Results*` buffer with navigable links

The `*Search Results*` buffer is a special buffer (like `*Messages*`) with its own mode:

```
src/editor/editor.ts:142:  constructor(config: EditorConfig) {
src/editor/editor.ts:198:  async openFile(filename: string): Promise<void> {
src/core/types.ts:55:  interface EditorConfig {
```

Pressing `Enter` on a result line opens the file at that line number. This is modeled on Emacs `xref` / `grep-mode`.

### T-Lisp API

| Function | Description |
|----------|-------------|
| `project-root` | Return current project root path |
| `project-name` | Return project name |
| `project-bind <path>` | Bind workspace to a project |
| `project-unbind` | Remove project binding |
| `project-find-file` | Interactive file finder (minibuffer completion) |
| `project-search <pattern>` | Search across project files |
| `project-refresh` | Invalidate file cache |
| `project-files` | Return list of all project files |
| `project-ignore-patterns` | Return current ignore patterns |

### project-mode (Major Mode)

**`project-mode`** is a special major mode — it doesn't activate per-buffer. Instead it's a workspace-level mode that activates when a project is bound:

- Provides project-aware minibuffer completion (file paths relative to root)
- Adds `SPC p` prefix for project commands (which-key integration)
- Shows project name in the status line
- Sets default CWD for shell-mode windows

**Key bindings (normal mode, `SPC p` prefix):**

| Key | Action |
|-----|--------|
| `SPC p f` | `project-find-file` |
| `SPC p s` | `project-search` |
| `SPC p r` | `project-refresh` |
| `SPC p p` | `project-switch` (switch to a different project's workspace) |
| `SPC p d` | Open project root in dired-like buffer |
| `SPC p b` | List project buffers only |

### Integration with Workspace System

- **Workspace save** serializes the project binding (root path + name)
- **Workspace restore** re-validates the project root and refreshes the file cache
- **`workspace-new`** with a path argument auto-binds the project: `workspace-new my-project /path/to/project`
- **Shell-mode** (RFC-014A) uses `project-root` as default CWD
- **`*Search Results*`** buffer is workspace-local

### Project Switching

Multiple workspaces can be bound to different projects. Switching projects means switching workspaces:

```lisp
(project-switch "other-project")
;; Equivalent to:
;; 1. workspace-save
;; 2. workspace-switch (or workspace-new) bound to target project
;; 3. project-bind if not already bound
```

The system maintains a project → workspace mapping for fast switching. If no workspace exists for a project, `project-switch` offers to create one.

## Implementation Phases

### Phase 1: Detection and Binding

- Project root detection (VCS + file markers)
- `project-root`, `project-bind`, `project-unbind` T-Lisp functions
- Workspace-project binding serialization
- Status line project name display
- `SPC p` prefix keymap

**Ships when:** Workspaces know which project they belong to, status line shows the name.

### Phase 2: File Discovery

- `project-find-file` with directory walking and `.gitignore` respect
- File cache with lazy population and time-based invalidation
- Minibuffer completion for file paths

**Ships when:** `SPC p f` finds any file in the project.

### Phase 3: Search

- `project-search` with pattern matching across files
- `*Search Results*` buffer with navigable links
- Result line → file:line navigation

**Ships when:** `SPC p s` searches the project, results are clickable.

### Phase 4: Project Config

- `.tmax.project` file parsing
- Workspace layout templates from project config
- Auto-open files on workspace restore

**Ships when:** Projects can define their preferred workspace layout.

## Risks

| Risk | Mitigation |
|------|------------|
| Large projects (100k+ files) make file walking slow | Lazy cache + streaming results; never walk synchronously for interactive use |
| `.gitignore` parsing is complex (negation patterns, nested ignores) | Start with basic glob patterns; add full gitignore spec incrementally |
| Project detection false positives (`.git` in home directory) | Check `.tmax.project` explicit marker first, then VCS markers. Never use `$HOME` as a project root — if the only marker found is in `$HOME`, treat it as no project detected. Cap upward walk at 20 directory levels. |
| `*Search Results*` buffer is a new special buffer type | Follow the `*Messages*` pattern: read-only, auto-generated, mode-specific keymap |
| `.tmax.project` parse errors | Warn in `*Messages*` with file path and error details. Bind project with defaults (root = directory containing the file, name = directory basename). User can fix the config file and run `project-refresh`. |

## Related

- [RFC-014: Workspace System](RFC-014-workspace-system.md) — parent RFC, workspace persistence
- [RFC-014A: shell-mode](RFC-014A-shell-mode.md) — shell CWD defaults to project root
- [modes.md](../modes.md) — project-mode entry and shell-mode (interactive) entry
