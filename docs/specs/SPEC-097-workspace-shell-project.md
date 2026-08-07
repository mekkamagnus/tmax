# Feature: Workspace sub-RFCs — shell-mode (PTY terminal) + project-mode

## Feature Description

The workspace core (RFC-014) is already 90% built. This spec covers the two remaining
sub-RFCs that make tmax a self-contained editing + terminal + project environment:

- **shell-mode (RFC-014A / #155)**: A real PTY-backed terminal emulator. `M-x shell`
  opens the user's shell with full ANSI/cursor support. **Coding agents** (Claude Code,
  Codex, Pi) run interactively in tmax windows — the primary use case. Uses `node-pty`
  (the one justified native dependency: interactive agents are full-screen TUI apps that
  require a real PTY).
- **project-mode (RFC-014B / #156)**: Project-aware file discovery (`SPC p f`) and
  search (`SPC p s`).

## User Story

As a tmax user,
I want to run Claude Code / Codex / Pi in one tmax window while editing in another,
and find files across my project,
So that my entire workflow lives inside tmax — no tmux needed.

## Problem Statement

tmax can only render editor buffers today. Running an interactive coding agent CLI
(a full-screen TUI) or finding project files requires tmux + external tools. The
workspace core (multi-workspace, persistence, auto-save, frame binding) already
exists — the gaps are the terminal emulator and project awareness.

## Solution Statement

### Phase 1: Shell-mode — PTY terminal emulator

1. **`node-pty`** as a dependency. Justification: interactive coding agents (Claude
   Code, Codex, Pi) are full-screen TUI apps that call `isatty()` and require a real
   PTY — pipes don't work. `node-pty` is the proven standard (VS Code, Hyper use it).

2. **PTY manager** (`src/core/pty.ts`):
   - `spawn({ command?, cwd?, env?, cols, rows }) → PTYHandle`
   - `write(handle, data)`, `resize(handle, cols, rows)`, `kill(handle, signal?)`
   - `onOutput(handle, cb)`, `onExit(handle, cb)`

3. **ANSI parser** (`src/syntax/ansi-parser.ts`):
   - State machine parsing PTY output → screen-buffer operations
   - xterm subset: cursor movement (CUU/CUD/CUF/CUB/CUP/CHA), erase (ED/EL),
     SGR colors/attributes, scroll regions (DECSTBM), alternate screen (`?1049h/l`),
     cursor visibility (`?25h/l`), OSC window title

4. **Screen buffer** (`src/core/screen-buffer.ts`):
   - `rows × cols` grid of `Cell { char, fg, bg, bold, underline, ... }`
   - cursor position, scroll region, alternate buffer, scrollback ring (10k cap)
   - `resize(rows, cols)`, `apply(ScreenOp)`, `getLine(row)`, `getScrollbackLines()`

5. **Terminal window rendering**:
   - The daemon composites the screen buffer into ANSI lines, sent as `visibleLines`
     in the existing JSON-RPC protocol (no protocol change for MVP).
   - Terminal windows co-exist with editor windows in splits (position translation).

6. **Input routing + T-Lisp API** (`src/editor/api/shell-ops.ts`):
   - `shell` — open a terminal window (PTY + screen buffer)
   - All keystrokes → PTY (via `shell-send`), except `C-\` (terminal-normal mode)
   - Terminal-normal: scrollback navigation, `i` to re-enter
   - `shell-resize` (on window resize), `shell-kill`, `shell-process-state`

### Phase 2: Project-mode — file discovery + search

7. **Root detection** — walk up from current file for markers (`.git`, `package.json`,
   `go.mod`, `Cargo.toml`, `.tmax.project`).

8. **File discovery** — walk tree respecting `.gitignore`, lazy cache.
   `SPC p f` → `project-find-file` (completing-read over cached files).

9. **Search** — `SPC p s` → `project-search` (pattern match across files), results in
   `*Search Results*` buffer (`file:line: text`, Enter opens).

10. **Workspace-project binding** + `.tmax.project` config (ignore patterns, open-on-start).

## Relevant Files

**Existing (extend):**
- `src/core/contracts/workspace.ts` — `ScrollbackBuffer` type (defined)
- `src/core/contracts/editor.ts` — `Window.scrollback` field (declared)
- `src/server/server.ts` — daemon, workspace map
- `src/client/tui-client.ts` — TUI rendering pipeline
- `src/tlisp/core/commands/buffers.tlisp` — special buffer pattern

**New Files:**
- `src/core/pty.ts` — PTY manager (node-pty wrapper)
- `src/core/screen-buffer.ts` — virtual screen (grid + cursor + scrollback)
- `src/syntax/ansi-parser.ts` — ANSI escape parser → ScreenOp stream
- `src/editor/api/shell-ops.ts` — T-Lisp shell primitives
- `src/editor/api/project-ops.ts` — T-Lisp project primitives
- `src/tlisp/core/modes/shell-mode.tlisp` — interactive shell major mode
- `src/tlisp/core/commands/project.tlisp` — project commands
- Tests: `pty.test.ts`, `screen-buffer.test.ts`, `ansi-parser.test.ts`, `shell-mode.test.ts`, `project-mode.test.ts`

## Implementation Plan

### Phase 1: Shell-mode (PTY terminal emulator)
Foundation: add `node-pty` → PTY manager → ANSI parser → screen buffer → terminal rendering → `M-x shell`.
**Ships when**: Claude Code / Codex / Pi runs interactively in a tmax window.

### Phase 2: Project-mode (file discovery + search)
Project root detection → file walk → `SPC p f` / `SPC p s` → workspace-project binding.

## Step by Step Tasks

### Task 1: Add node-pty + PTY manager (`src/core/pty.ts`)
- `bun add node-pty` (the one native dependency — justified by the interactive-agent use case).
- Implement `PTYManager`: spawn, write, resize, kill, onOutput, onExit.
- Default: `$SHELL` or `/bin/sh`, cwd = project root (if detected) or `$HOME`.
- Tests: spawn → output, write → echo, resize → dimensions change, kill → exit.

### Task 2: ANSI parser (`src/syntax/ansi-parser.ts`)
- State machine: CSI (cursor, erase, SGR, scroll), OSC (title), alt-screen, cursor visibility.
- Output: `ScreenOp[]` (writeChar, moveCursor, eraseLine, eraseScreen, scrollUp, setSGR, etc.).
- Handle incomplete sequences (buffer partial escapes).
- Tests: each escape type, partial sequences, 256-color, true-color.

### Task 3: Screen buffer (`src/core/screen-buffer.ts`)
- `Cell[][]` grid + cursor + scrollRegion + alternateBuffer + scrollback ring.
- `apply(ScreenOp)` applies parser output. `resize`, `getLine`, `getScrollbackLines`.
- Tests: write, scroll, resize, alt-screen, scrollback ring.

### Task 4: Terminal window type + rendering
- Extend Window to hold a `ScreenBuffer` (terminal) instead of an editor buffer.
- Render: composite the screen buffer rows → ANSI lines → send as `visibleLines`.
- Co-exist with editor windows in splits.
- Tests: terminal shows shell prompt; `ls` output renders; split layout works.

### Task 5: Shell-mode T-Lisp API + input routing
- `shell` (open terminal), `shell-send` (write to PTY), `shell-resize`, `shell-kill`.
- Input routing: terminal window → all keys to PTY except `C-\`.
- Terminal-normal mode: `C-\` toggles, scrollback navigation, `i` re-enters.
- `M-x shell` entry point.
- Tests: `M-x shell` opens prompt; typing echoes; `C-\` toggles normal mode.

### Task 6: Project root detection (`src/editor/api/project-ops.ts`)
- `project-detect-root(path)`: walk up for `.git`, `package.json`, `go.mod`, etc.
- `project-root`, `project-name` T-Lisp primitives.
- Bind to workspace; show in status line.
- Tests: git repo detected; no markers → undefined; nested markers.

### Task 7: File discovery + `SPC p f`
- `project-files`: walk tree, `.gitignore`-respect, lazy cache.
- `project-find-file`: completing-read → open file.
- `SPC p f` key binding.
- Tests: file list appears; gitignore'd files excluded; refresh re-scans.

### Task 8: Project search + `*Search Results*`
- `project-search(pattern)`: scan files, collect `file:line: text`.
- `*Search Results*` special buffer; Enter opens file at line.
- `SPC p s` key binding.
- Tests: search finds matches; Enter navigates; buffer is read-only.

### Task 9: `.tmax.project` config + binding
- Parse `.tmax.project` (T-Lisp format): name, ignore, open-on-start.
- Workspace-project binding on restore.
- Tests: config respected; workspace restore re-detects root.

### Task 10: Integration + validation
- Wire modes into `normal.tlisp`.
- Full typecheck + test suite + tmax-use e2e.
- Manual: `M-x shell` → run `claude` (Claude Code) interactively. `SPC p f` → find file.

## Acceptance Criteria

- [ ] `M-x shell` opens a terminal; Claude Code / Codex / Pi runs interactively.
- [ ] Terminal windows co-exist with editor windows in splits.
- [ ] `C-\` enters terminal-normal mode (scrollback navigation).
- [ ] `SPC p f` finds files in a project (respects `.gitignore`).
- [ ] `SPC p s` searches across project files with a results buffer.
- [ ] Project root auto-detected; shown in status line.
- [ ] `bun run typecheck` clean; all new tests pass; existing suite no new failures.

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/pty.test.ts test/unit/screen-buffer.test.ts test/unit/ansi-parser.test.ts`
- `bun test test/unit/shell-mode.test.ts test/unit/project-mode.test.ts`
- `bun run test:tmax-use`
- Manual: `tmax` → `M-x shell` → `claude` → interact with the agent → `SPC p f` → `SPC p s`

## Notes

- **node-pty is the one justified external dependency.** Interactive coding agents are
  full-screen TUIs that require a real PTY. This is the same decision VS Code, Hyper,
  and tmux make. If Bun adds native PTY support later, switch to it.
- **Phase 1 (shell-mode) is the higher-value piece** — it's what replaces tmux for the
  agent-development workflow. Phase 2 (project-mode) is more mechanical.
- **Rendering MVP**: daemon composites screen buffer → ANSI lines → existing protocol.
  Richer client-side rendering (cell grid serialization) is a follow-up if needed.
- **Unblocks**: #155 (shell-mode) + #156 (project-mode).
