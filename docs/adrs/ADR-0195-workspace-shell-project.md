# ADR-0195 — Workspace sub-RFCs: shell-mode (PTY terminal) + project-mode (`#164`)

## Status

Accepted

## Context

Issues #155 (shell-mode) and #156 (project-mode) were both blocked on RFC-014
(workspace system). Investigation found the workspace core (multi-workspace
daemon, persistence, auto-save, per-frame binding, ScrollbackBuffer types) was
already 90% implemented. The actual missing pieces were:
1. A PTY-backed terminal emulator for running interactive shells and coding
   agents (Claude Code, Codex, Pi) inside tmax windows.
2. Project-aware file discovery and search (SPC p f / SPC p s).

## Decision

### PTY: Bun native terminal API (zero-dependency)

node-pty is architecturally incompatible with Bun (microsoft/node-pty#632 closed
out-of-scope — NAN/V8 symbols Bun doesn't have). The `script(1)` wrapper works
but has echo leakage and no proper signal forwarding. Bun shipped first-party
PTY support in v1.3.5 via `Bun.spawn({ terminal })` — tmax is on v1.3.8, so it's
already available. This is the correct, zero-dependency path.

### Shell-mode: terminal editor mode + PTY handler

Added a new `"terminal"` editor mode (all EditorMode unions updated). The
terminal-handler routes keystrokes to the PTY (Enter→\r, Backspace→\x7f,
arrows→ESC sequences, Ctrl→control bytes). C-\ exits. `M-x shell` creates a
PTY via the TerminalManager, enters terminal mode.

### Security: shell-ops hardening

Automated security review caught: (1) arbitrary command execution via the `command`
parameter — removed; only `$SHELL` is spawned. (2) predictable terminal IDs —
switched to `crypto.randomUUID()`. (3) raw bytes to PTY via write — acknowledged
as intended behavior (PTY write IS keyboard input).

### Project-mode: TS primitives + T-Lisp commands

Three TS primitives: `project-detect-root`, `project-files-walk` (respects
default ignores + custom), `project-search`. T-Lisp layer: `project-find-file`
(completing-read over files), `project-search-cmd` (→ *Search Results* buffer),
`project-dired`, `project-status`. Key bindings: SPC p f/s/d/r.

## Consequences

- `M-x shell` opens an interactive terminal; `C-\` (Ctrl-backslash) exits to
  the editor. Coding agents (Claude Code, Codex, Pi) can run interactively.
- `SPC p f` finds any file in the project (respects default ignores:
  node_modules, .git, dist, build, etc. — not a full .gitignore parser yet).
- `SPC p s` searches across project files, results in a read-only
  `*Search Results*` buffer (Enter-to-navigate pending).
- Zero new dependencies (Bun native PTY).
- **Remaining integration work** (explicitly out of scope for this deliverable):
  - Terminal rendering (screen buffer → visibleLines in the display pipeline)
  - Window coexistence (Window.isTerminal/terminalId declared but not yet
    populated; terminal mode uses a single full-screen terminal, not split windows)
  - `.gitignore` parsing (currently uses hardcoded DEFAULT_IGNORES)
  - Search-results Enter navigation
  - Project root in the persistent status line
- Verify-gate (SPEC-097): **PASS** for the implemented scope (PTY infrastructure,
  ANSI parser, screen buffer, terminal mode + key routing, project primitives +
  commands). The remaining items above are scoped as follow-up work.
