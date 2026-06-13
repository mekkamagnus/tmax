# RFC-014: Workspace System — Native tmux Replacement

**Date:** 2026-06-12
**Status:** Proposed
**Author:** Mekael Turner
**Scope:** Umbrella RFC — defines long-term architecture for replacing tmux dependency with native workspace management; implementation staged via sub-RFCs

## Summary

An umbrella RFC defining native workspace, session, and terminal multiplexing for tmax. The goal: replace the tmux layer entirely. tmax workspaces are persistent, named, crash-surviving sessions — each holding its own set of windows (splits), buffers, shell terminals, and project context. Via shell-mode, any terminal application runs inside tmax panes (Codex, Claude Code, Gemini CLI, Pi, test runners, REPLs). The daemon/client architecture already provides detach/reattach; this RFC extends it with workspace persistence, independent named workspaces, scrollback buffers, project awareness, and agent-aware process monitoring.

### Sub-RFCs

This RFC is too large to implement as a single unit. It is split into separately reviewable sub-RFCs:

| Sub-RFC | Scope | Dependencies | Status |
|---------|-------|-------------|--------|
| **[RFC-014A](RFC-014A-shell-mode.md): shell-mode** | Interactive terminal emulator: PTY allocation, ANSI passthrough, shell buffer, process management | Editor core, window splitting | Proposed |
| **[RFC-014B](RFC-014B-project-mode.md): project-mode** | Project root detection, file finding, search, `.project` config, workspace-project binding | Workspace core (this RFC) | Proposed |

### What This RFC Covers (Not Delegated to Sub-RFCs)

1. Workspace persistence (desktop save, session files, buffer serialization)
2. Named independent workspaces (multi-session daemon)
3. Scrollback buffers (ring buffer per window, full search/copy)
4. Window management across workspaces (move windows between workspaces)
5. Agent-aware process monitoring (CLI done-detection)
6. Test/demo backend abstraction (tmux or native workspace)

## Motivation

tmax currently depends on tmux for three things it cannot do itself:

1. **State survival.** SSH drops, terminal crashes, and intentional detach all kill the daemon's in-memory state. No session persistence exists.

2. **Workspace isolation.** One daemon, one global state. Frames give independent viewports per client but share buffers, windows, and interpreter. There is no equivalent of `tmux new -s project-a`.

3. **Terminal multiplexing.** tmax can only render its own editor buffers. Running a shell, test watcher, REPL, or AI agent requires tmux panes — the editor has no PTY management.

These are not minor gaps. They mean tmax cannot be a developer's primary workspace without tmux underneath. This RFC closes all three by internalizing workspace management (the Emacs approach), making tmux optional rather than required.

## Design Principles

1. **Path A: Internalize, don't coexist.** tmax becomes the workspace manager. tmux remains supported as a test/demo backend but is no longer required for daily use.

2. **Workspace = persistent session.** A workspace has a name, a set of windows, a buffer list, a project binding, and a serialized state file. It survives daemon restarts, SSH drops, and terminal crashes.

3. **Shell buffers as first-class windows.** Any window can hold either an editor buffer or a terminal emulator (shell-mode). Both are first-class; both participate in window cycling, resizing, and layout.

4. **Agent-aware.** The system can detect when terminal processes (Codex, Claude Code, Gemini CLI, Pi) finish. Window status reflects process state. No polling — use `waitpid`/`SIGCHLD` or PTY poll.

5. **Incremental delivery.** Each piece ships independently. Workspace persistence does not require shell-mode. Project-mode does not require agent awareness. The test/demo backend switch is a thin abstraction.

## Architecture

### Workspace State

A workspace is the unit of persistence and isolation:

```
Workspace
├── id: string (UUID)
├── name: string (user-assigned, e.g. "project-a")
├── projectRoot?: string (git root, see RFC-014B)
├── windows: Window[]
│   ├── editor windows (buffer + cursor + viewport)
│   └── terminal windows (shell-mode, PTY + scrollback)
├── buffers: Map<string, BufferState>
│   ├── name, content, filename, modified, major-mode
│   └── undo history (when available)
├── tabs: Tab[]
├── currentWindowIndex: number
├── currentTabIndex: number
└── metadata: { createdAt, lastAccessed, autoSavePath }
```

**Tab scope note:** Tabs appear in the data model but are deferred from initial implementation. The first iteration ships with windows only (splits). Tabs add a second dimension of organization (windows within tabs) and follow after window management is stable. The data model includes tabs so that serialization is forward-compatible.

**What is workspace-local vs shared (daemon-global):**

| Workspace-Local | Daemon-Global |
|----------------|---------------|
| Buffer list and contents | T-Lisp interpreter state |
| Windows, tabs, layout | Kill ring |
| Cursor positions, viewports | Configuration (init.tlisp) |
| Shell processes | Macro definitions |
| Project binding | Plugin state |

**T-Lisp namespace model:** The interpreter uses a fully global namespace (Emacs model). All function definitions, variable bindings, and macro definitions are shared across all workspaces. Workspace kill never unloads functions or variables. This matches Emacs behavior: `init.tlisp` runs once at daemon startup, and every workspace sees the same definitions. The tradeoff is that workspaces cannot have conflicting definitions of the same symbol, but this is the same constraint Emacs users already work within and is well-understood.

**Buffer namespace model:** File buffers and `*scratch*` are per-workspace — each workspace has its own isolated buffer list. `*Messages*` is daemon-global (one log for all workspaces). Switching workspaces switches the entire buffer namespace except `*Messages*`, which accumulates entries from all workspaces. User buffers (files) can have the same name in different workspaces without collision.

### Workspace Persistence

**Desktop save model.** Workspaces serialize to `~/.config/tmax/workspaces/<name>.json` (or `.tlisp` for human-editable format). Serialization includes:

- Buffer list: name, content, filename, modified flag, major mode, cursor position
- Window layout: split types, dimensions, buffer assignments
- Tab configuration
- Shell process working directories (not process state — shells restart on restore)
- Project root
- Format version (`version: 1`) for forward-compatible migration

**Format versioning strategy:** Additive-only schema evolution. New versions add fields with sensible defaults. Old fields are never removed or renamed. On load, missing fields are filled with defaults. If the loaded version is newer than the running tmax version (downgrade scenario), refuse to load with a clear error message: "Workspace was saved by tmax vN, you are running vM. Please upgrade."

**Atomic write + backup.** Every serialization uses atomic write to prevent corruption on crash:

1. Write workspace to `<name>.json.tmp`
2. If a previous `<name>.json` exists, rename it to `<name>.json~` (one-generation backup)
3. Rename `<name>.json.tmp` to `<name>.json`

On load, if `<name>.json` fails to parse, the system offers to restore from `<name>.json~`. If both are corrupt, log an error and create an empty workspace.

**Serialization triggers:**
- On workspace switch (`workspace-switch`)
- On explicit save (`workspace-save`)
- Periodically (auto-save interval, default 30s, configurable; maximum dirty interval 120s — see "auto-save during heavy editing" below)
- On daemon shutdown (`SIGTERM`, `shutdown` RPC)
- On buffer modification (debounced, content hash comparison to avoid redundant writes)

**Restore behavior:**
- Reopen all buffers with saved content (or re-read from disk if unmodified)
- Recreate window layout with correct dimensions
- Reopen shells in saved working directories
- Place cursors at saved positions
- If a buffer's file changed on disk since serialization, offer `recover-file` prompt with choices: (a) keep disk version, (b) restore workspace version, (c) open both in a diff view
- If multiple buffers have changed-on-disk conflicts, present a batch prompt listing all affected buffers

### Named Independent Workspaces

The daemon evolves from single-session to multi-session:

```
TmaxServer
├── workspaces: Map<string, Workspace>
├── activeWorkspaceId: string
├── clients: Map<string, ClientConnection>
│   └── each client targets a workspace
└── frames: Map<string, Frame>
    └── each frame targets a workspace
```

**New T-Lisp commands:**

| Command | Description |
|---------|-------------|
| `workspace-list` | List all workspace names with metadata (active/inactive, last-accessed, project name, window count) |
| `workspace-new <name>` | Create a new empty workspace |
| `workspace-switch <name>` | Switch to an existing workspace (saves current) |
| `workspace-kill <name>` | Delete a workspace (prompts for unsaved buffers and running processes — see below) |
| `workspace-rename <old> <new>` | Rename a workspace |
| `workspace-save` | Persist current workspace to disk |
| `workspace-load <name>` | Load a workspace from disk without switching (pre-loading for faster switch later) |
| `workspace-move-window <workspace>` | Move current window to another workspace |

**Workspace name rules:** Names must contain only letters, digits, hyphens, and underscores. Maximum 64 characters. No path separators, no spaces. `workspace-new` with an existing name returns an error. These rules ensure names are safe as filenames (`~/.config/tmax/workspaces/<name>.json`) and as CLI arguments.

**Workspace kill with running processes.** When a workspace has active terminal windows (running PTY processes), `workspace-kill` presents a prompt listing all running processes with their names and PIDs. Choices: (a) kill all processes and delete workspace, (b) cancel. No process migration option — migration is not feasible in practice (child processes have fixed parent PIDs and working directories).

**PTY resize debouncing.** When a terminal window is resized (split adjustments, window moves), PTY resize events are debounced at 100ms. The PTY receives only the final dimensions, avoiding rapid `ioctl` calls during transient layout adjustments.

**CLI commands:**

```bash
tmax                          # Open last active workspace
tmax -w project-a             # Open specific workspace
tmax -w new:project-b         # Create and open new workspace
tmax --workspaces             # List all workspaces
tmax --workspace-kill name    # Kill workspace from CLI
```

**Client routing.** Each TUI client connects to a specific workspace via `connect-frame` RPC (extended with `workspaceId` parameter). The daemon routes keypresses, renders, and syncs frames per-workspace.

**Concurrent clients.** Multiple clients can connect to the same workspace (tmux model). All clients share the same buffer state — last keystroke wins, no merge or conflict detection. This matches tmux's behavior where all attached clients see the same session. Concurrent editing is not collaborative editing; it's multiple viewports into one state.

### Scrollback Buffer

Every window maintains a scrollback ring buffer. Scrollback is primarily valuable for terminal windows; for editor windows it tracks viewport-position history only (not content, since the buffer itself is fully navigable).

```
ScrollbackBuffer
├── lines: Ring<string>      // configurable capacity (default 50000 for terminal, not used for editor)
├── viewportOffset: number   // 0 = live, >0 = scrolled up
├── searchResults?: number[] // line indices matching current search
└── searchIndex?: number     // current match position
```

**Key bindings (terminal-normal mode — see below):**

| Key | Action |
|-----|--------|
| `C-u` / `C-b` | Scroll up half page / full page |
| `C-d` / `C-f` | Scroll down half page / full page |
| `g g` | Jump to top of scrollback |
| `G` | Jump to bottom (live) |
| `/` | Search forward in scrollback |
| `?` | Search backward in scrollback |
| `n` / `N` | Next/previous search match |
| `y y` | Yank visible scrollback region |

**Editor windows:** No content scrollback — the buffer itself is the full history. The scrollback buffer for editor windows tracks only viewport-position history (which region was visible), enabling `C-o` jump-back to previous viewport positions (like vim's jump list). Content search uses the standard editor `/` and `?` bindings against the buffer.

**Terminal windows:** The scrollback holds the full PTY output history. This is where scrollback matters most — `grep` output, test results, build logs are all searchable and copyable. Default capacity is 50,000 lines (configurable per-window).

**Terminal normal mode (`terminal-normal`).** A distinct mode from regular normal mode, activated by `C-\` in terminal windows. Has its own keymap with the scrollback bindings above. Does not conflict with regular normal-mode bindings. Press `i` or `C-\` to return to the shell.

**No special copy mode.** Since tmax is an editor, the entire scrollback is a buffer. Standard search (`/`, `?`), yank (`y`), and visual selection work directly in terminal-normal mode. This is a key advantage over tmux.

### Window Management Across Workspaces

Vim-style window management is the baseline (already implemented). The addition is cross-workspace window operations:

**`workspace-move-window <target>`:**
1. Removes current window from current workspace's window list
2. Adjusts layout of current workspace (rebalance remaining windows)
3. Adds window to target workspace's window list (appended to end)
4. If the moved window held an editor buffer, the buffer is copied into the target workspace (independent copy). Shared buffer references are a future enhancement.
5. If the moved window held a terminal, the PTY process is killed and a new shell starts in the target workspace's project root (process migration is not feasible in practice)

**`window-break-to-workspace`:** Creates a new workspace containing only the current window. Equivalent to tmux `break-pane`.

### Agent-Aware Process Monitoring

Terminal windows (shell-mode) can detect when their child process completes. This enables:

**Process state tracking:**

```
TerminalWindow
├── processState: 'running' | 'exited' | 'signaled'
├── exitCode?: number
├── processName?: string       // e.g. "codex", "claude", "gemini"
├── processStartedAt?: Date
└── processFinishedAt?: Date
```

**Agent detection heuristics:**
- Command-line pattern matching: `codex`, `claude`, `gemini`, `pi` in the PTY's child process name
- Exit code interpretation: 0 = success, non-zero = failure
- PTY EOF detection: shell prompt returns after command exits

**Status indicators:**
- Window status line shows process state: `[codex: running]`, `[claude: done ✓]`, `[tests: failed ✗]`
- Tab bar indicators: active tab shows spinner or checkmark based on window process states
- T-Lisp hook: `process-exit-hook` runs when a terminal window's process exits, enabling custom workflows

**Use case: AI agent orchestration.**
```
Workspace "tmax-dev"
├── Window 1: editor (src/editor/editor.ts)
├── Window 2: terminal (claude-code)     ← agent-aware
├── Window 3: terminal (codex)           ← agent-aware
└── Window 4: terminal (bun test --watch)
```

The user can see at a glance which agents have finished. A T-Lisp hook can auto-switch to the finished agent's window, or send a notification.

### Test/Demo Backend Abstraction

The existing test harness and demo system use tmux directly. This RFC adds a backend abstraction layer:

```
Backend (TypeScript interface — no T-Lisp backends; test infrastructure is TypeScript-only)
├── createSession(name: string): Session
├── createWindow(session, name, command): Window
├── sendKeys(target, keys): void
├── capturePane(target): string[]
├── killSession(name): void
└── listWindows(session): string[]
```

**Two implementations:**

| Backend | Use Case |
|---------|----------|
| `TmuxBackend` | Existing tmux-based testing (unchanged) |
| `NativeBackend` | Direct workspace/window control via daemon RPC |

The `NativeBackend` creates real tmax workspaces, opens files via the `open` RPC, sends keys via `keypress` RPC, and reads rendered output via `capture` RPC. No tmux required.

**Migration path:**
1. Abstract the existing Python harness to use the `Backend` interface
2. Implement `NativeBackend` using the existing daemon RPC
3. Tests can run in either mode: `--backend tmux` or `--backend native`
4. CI defaults to `native` (no tmux dependency); developers can use either

## PRD Alignment / Roadmap Placement

This RFC spans multiple phases. Dependency ordering:

```
Phase 1.5 (current)          Phase 2                        Phase 3
─────────────────            ──────────                     ──────────
Editor primitives            Workspace core                 Agent orchestration
                             Shell-mode (RFC-014A)          AI harness integration
                             Project-mode (RFC-014B)
                             Scrollback buffer
                             Test backend abstraction
                             Workspace persistence
```

| Component | Phase | Rationale |
|-----------|-------|-----------|
| Scrollback buffer | Phase 2 early | No external deps, extends existing window rendering |
| Workspace persistence | Phase 2 early | Serialization, file I/O, no new rendering needed |
| Named workspaces | Phase 2 mid | Requires daemon multi-session support |
| Shell-mode (RFC-014A) | Phase 2 mid | PTY management, terminal emulation, new window type |
| Project-mode (RFC-014B) | Phase 2 late | Depends on workspace persistence, file traversal |
| Window cross-workspace moves | Phase 2 late | Requires named workspaces + serialization |
| Agent-aware monitoring | Phase 3 early | Requires shell-mode process tracking |
| Test backend abstraction | Phase 2 (parallel) | Thin layer over existing RPC, can ship early |
| Demo backend abstraction | Phase 2 (parallel) | Same as test abstraction |

## Success Criteria

1. **tmux is optional.** A developer can use tmax as their sole workspace manager without tmux installed.
2. **Workspaces survive crashes.** Kill the daemon, restart it, get your workspace back with all buffers and layout.
3. **Shells run inside tmax.** `M-x shell` opens a terminal window. `bun test --watch` runs in a pane. AI agents run in panes.
4. **Projects are first-class.** Open a project, get its files, search across them, switch projects.
5. **Tests pass without tmux.** `--backend native` runs the full test suite via daemon RPC.
6. **Scrollback is searchable.** Terminal output history is a first-class buffer with `/`, `?`, `y`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PTY management is complex (signal handling, resize, encoding) | Shell-mode delayed or broken | Ship workspace persistence and scrollback first; shell-mode can follow |
| Terminal emulation incomplete (scroll regions, mouse, alternate screen) | Some CLI tools render incorrectly | Start with raw ANSI passthrough (like Emacs `term-mode`); full emulation is incremental |
| Multi-workspace daemon increases memory usage | Performance regression with many workspaces | Lazy-load: only active workspace is fully in memory; others stay serialized on disk |
| Buffer serialization of large files is slow | Workspace switch feels sluggish | Serialize only metadata + dirty content; clean buffers re-read from disk |
| Terminal windows lose state on cross-workspace move | User loses running processes | By design: PTY processes are killed and restarted. Documented behavior, not a bug. |

**Agent-aware monitoring has no dependency on Loom (RFC-010) or Fikra (RFC-013).** The `process-exit-hook` and agent detection heuristics are core T-Lisp features shipped with the workspace system. Fikra integration uses these hooks but is a separate concern that follows later.

## Related

- [RFC-014A: shell-mode](RFC-014A-shell-mode.md) — interactive terminal emulator
- [RFC-014B: project-mode](RFC-014B-project-mode.md) — project awareness and file management
- [RFC-002: Server/Client Architecture](RFC-002-server-client-architecture.md) — daemon/client foundation
- [RFC-013: Fikra AI Harness](RFC-013-fikra-ai-harness.md) — AI agent integration
- [modes.md](../modes.md) — mode inventory with shell-mode and project-mode entries
