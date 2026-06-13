# RFC-014A: shell-mode — Interactive Terminal Emulator

**Date:** 2026-06-12
**Status:** Proposed
**Author:** Mekael Turner
**Parent:** [RFC-014: Workspace System](RFC-014-workspace-system.md)

## Summary

An interactive terminal emulator running inside tmax windows. `M-x shell` opens a shell buffer backed by a real PTY — the user's system shell with full color support, cursor addressing, and all the programs that run in a terminal. This is the feature that replaces tmux's "run anything in a pane" capability.

The initial implementation parses PTY output into a virtual screen buffer (rows × cols grid of characters + attributes), then composites each terminal window's grid into the correct terminal region during rendering. This is what tmux does — each pane's PTY output is parsed into a grid, then all panes are composited with position translation. Raw passthrough only works for a single full-screen window; splits require a screen buffer from day one.

## Motivation

tmax can only render editor buffers today. Running `bun test --watch`, a REPL, `git log`, or an AI agent CLI requires switching to a separate tmux pane. This breaks the workspace model — the user's working context is split across two tools.

Emacs solved this with `shell-mode`, `term-mode`, and `eshell`. tmax needs the same capability: any terminal program runs inside a tmax window, managed alongside editor buffers.

## Design

### Window Type Extension

Windows currently hold editor buffers only. This RFC extends windows to hold either:

```typescript
type WindowContent =
  | { type: 'editor'; buffer: string }           // buffer name (existing)
  | { type: 'terminal'; pty: PTYState }          // new: shell-mode
```

A `terminal` window has no buffer name. Instead it owns a PTY process and renders its output directly into the window cell.

### PTY Management (TypeScript)

The TypeScript core gains a PTY manager:

```
PTYManager
├── spawn(shell?: string, cwd?: string, env?: Record<string, string>): PTYHandle
├── write(handle: PTYHandle, data: string): void
├── resize(handle: PTYHandle, cols: number, rows: number): void
├── kill(handle: PTYHandle, signal?: string): void
├── onOutput(handle: PTYHandle, callback: (data: string) => void): void
└── onExit(handle: PTYHandle, callback: (code: number) => void): void
```

**Implementation:**
- Use `node-pty` (Bun-compatible) or Bun's `Bun.spawn` with PTY allocation via `pty` flag
- Shell defaults to `$SHELL`, falls back to `/bin/sh`
- Working directory defaults to the workspace's project root, or `$HOME`
- Environment inherits the daemon's env plus `TERM=xterm-256color`, `COLORTERM=truecolor`
- Resize events propagate from window layout changes to the PTY

### Rendering Model

Terminal windows parse PTY output into a virtual screen buffer, then composite into the terminal — exactly like tmux.

**Virtual screen buffer.**

Each terminal window maintains a grid matching its PTY dimensions:

```
ScreenBuffer
├── width: number          // matches window cell columns
├── height: number         // matches window cell rows
├── cells: Cell[][]        // grid[row][col]
├── cursor: { row, col, visible }
├── scrollRegion?: { top, bottom }
├── alternateBuffer?: ScreenBuffer   // switched by \x1b[?1049h
├── savedCursor?: CursorState        // saved on alternate screen switch
└── scrollback: Ring<Line>           // lines scrolled off top
```

Each `Cell` holds a character + attributes (fg, bg, bold, underline, blink, reverse):

```typescript
interface Cell {
  char: string;        // single character (may be wide, e.g. CJK)
  attrs: Attrs;        // { fg, bg, bold, underline, blink, reverse }
}
```

**Why a screen buffer is required (not optional):**

Raw ANSI passthrough — writing PTY bytes straight to the terminal — only works for a single full-screen window. The moment you split the screen, cursor addressing breaks:

- `htop` sends `\x1b[1;1H` meaning "row 1, col 1 of my terminal." In a split starting at row 15, that must become `\x1b[15;1H`.
- `\x1b[2J` (clear screen) must clear only the window cell, not the entire terminal.
- Scroll regions (`\x1b[1;10r`) must be translated by the window's offset.
- Alternate screen switches (`\x1b[?1049h`) must be scoped to the window cell.

tmux solves this by parsing all ANSI output into a per-pane grid, then compositing panes with position translation. tmax must do the same — there is no shortcut.

**ANSI parser.**

The parser processes PTY output byte-by-byte into screen buffer mutations. Required escape sequences (the subset needed for real CLI programs to display correctly):

| Category | Sequences | Used by |
|----------|-----------|---------|
| Cursor movement | CUU/CUD/CUF/CUB, CUP, CHA, ED, EL | Every TUI program |
| Colors / attributes | SGR (`\x1b[...m`) | `ls --color`, `git log`, everything |
| Scroll regions | DECSTBM (`\x1b[...r`) | `vim`, `less`, `htop` |
| Alternate screen | `\x1b[?1049h`/`l` | `vim`, `htop`, `less`, `top` |
| Scroll up | SU (`\x1b[...S`) | `dmesg`, build output |
| Save/restore cursor | DECSC/DECRC | `vim`, `htop` |
| Character set | UTF-8 (no translation needed) | All |
| Bracketed paste | `\x1b[?2004h`/`l` | Shell, `vim` |
| Window title | `\x1b]0;...\x07` | Shell prompt |
| Bell | `\x07` | Various |

This is a well-understood subset of VT100/xterm. Libraries like `xterm-headless` or a purpose-built parser (~500 lines) handle it.

**Compositing render.**

When the TUI client renders the terminal layout:

1. For each window cell that holds a terminal:
   a. Read the screen buffer's grid (rows × cols)
   b. For each cell in the grid, emit ANSI to the terminal at position `(windowRow + gridRow, windowCol + gridCol)` with the cell's attributes
2. For editor windows, render as today (buffer lines + highlights)
3. Draw window separators over the top

This is the same compositing loop tmux runs every frame. The screen buffer gives correct rendering in splits, tabs, and any layout.

**Input handling in terminal windows:**
- All keystrokes go directly to the PTY (like tmux's send-keys)
- No normal-mode processing, no key bindings — the shell owns input
- Escape sequences pass through (arrow keys, function keys, etc.)
- One escape hatch: a configurable prefix key (default `C-\`) enters a "terminal normal mode" for scrollback navigation, copy, and window switching

### Scrollback in Terminal Windows

Terminal windows share the same scrollback infrastructure defined in RFC-014. When the screen buffer scrolls (content moves past the top row), scrolled-off lines are appended to the ring buffer as `Line` objects (character array + attributes per line).

Because the screen buffer tracks the visual state, scrollback captures exactly what the user saw — including colors, wide characters, and cursor-positioned output. `grep` output, build logs, and `htop` screens all produce accurate scrollback.

**Accessing scrollback:**
1. Press `C-\` to enter terminal normal mode
2. Use standard scroll (`C-u`, `C-d`, `g`, `G`) and search (`/`, `?`, `n`, `N`)
3. Yank with `y y` (copies scrollback lines to kill ring)
4. Press `i` or `C-\` to return to the shell

### Agent Awareness

Shell-mode provides the process monitoring foundation described in RFC-014:

- **Process name detection:** On PTY spawn, record the child process name. When the shell launches a subprocess (e.g., `claude-code`), detect it via `/proc/<pid>/cmdline` (Linux) or `ps` (macOS).
- **Exit detection:** `onExit` callback fires when the PTY's foreground process exits. The shell prompt returning is the natural signal.
- **Status reporting:** Terminal windows report `processState` and `exitCode` to the workspace for tab bar and status line rendering.

**Agent-specific integrations (via T-Lisp, not hard-coded):**

The system provides hooks; agents are detected by convention:

```lisp
;; In init.tlisp or a Loom package
(add-hook 'process-exit-hook
  (lambda (window process-name exit-code)
    (when (string-match process-name "claude\\|codex\\|gemini\\|pi")
      (message "Agent %s finished (exit %d)" process-name exit-code))))
```

### T-Lisp API

| Function | Description |
|----------|-------------|
| `shell` | Open a new terminal window with the user's shell |
| `shell-command <cmd>` | Run a command in a new terminal window |
| `shell-send <window-id> <input>` | Send text to a terminal window's PTY |
| `shell-resize <window-id> <cols> <rows>` | Resize a terminal window's PTY |
| `shell-kill <window-id>` | Kill the terminal window's process |
| `shell-process-state <window-id>` | Get process state, name, exit code |
| `terminal-normal-mode` | Enter scrollback/copy mode for terminal window |

### Key Bindings

| Key | Context | Action |
|-----|---------|--------|
| `M-x shell` | Any | Open shell in new window |
| `M-x shell-command` | Any | Run command in new terminal window |
| `C-\` | Terminal (shell mode) | Enter terminal normal mode |
| `C-\` | Terminal (normal mode) | Return to shell |
| `i` | Terminal (normal mode) | Return to shell |
| Standard vim keys | Terminal (normal mode) | Scroll, search, yank scrollback |

## Implementation Phases

### Phase 1: Terminal with Screen Buffer (MVP)

The MVP must display shell applications correctly in split windows. This requires the screen buffer from the start.

- PTY spawn with `$SHELL`, sized to window cell dimensions
- ANSI parser → virtual screen buffer (cursor movement, colors, clear, scroll regions, alternate screen)
- Compositing render: translate screen buffer grid to terminal positions in window cell
- Keystroke forwarding to PTY
- `C-\` escape hatch to terminal normal mode
- Scrollback: scrolled-off screen buffer lines → ring buffer
- `shell` T-Lisp command
- Window layout handles terminal-type windows

**Ships when:** User can open a shell, run commands, see colors, split the window with an editor pane, and have both display correctly. `htop` and `vim` render properly in a split.

### Phase 2: Interactive Polish

- Bracketed paste mode passthrough
- Mouse protocol passthrough (for `htop` mouse, `vim` mouse scrolling)
- Terminal title parsing → window name
- Bell handling (visual bell in status line)
- Accurate content extraction for search/copy in scrollback
- Works on any frontend (not just ANSI terminals — screen buffer is frontend-independent)

**Ships when:** Terminal programs behave identically to running in a bare terminal, including mouse interaction.

### Phase 3: Advanced Features

- Unicode wide character handling (CJK, emoji — double-width cell tracking)
- Scroll region edge cases (nested regions, origin mode)
- Sixel/Kitty image passthrough (for terminal image viewers)
- Terminal multiplexing within a window (tmux-in-tmax compatibility)
- Screen buffer diffing for efficient re-render (only redraw changed cells)

**Ships when:** Edge-case terminal programs work, rendering is efficient for high-output streams.

## Risks

| Risk | Mitigation |
|------|------------|
| PTY library compatibility (Bun + macOS + Linux) | Test `node-pty` and Bun's native PTY support early; fallback to `forkpty` via FFI |
| ANSI parser edge cases (incomplete sequences, non-standard escapes) | Start with well-tested sequences (xterm subset); extend based on real-world testing. Libraries like `xterm-headless` provide proven parsers. |
| Performance: high-volume PTY output (build logs) with screen buffer parsing | Buffer PTY output, batch parse + render at frame rate (16ms). Only render the final state per frame — intermediate states are dropped. |
| Shell editing conflicts with tmax key handling | All keys go to PTY, only `C-\` is intercepted. Clear visual indicator when in terminal mode vs editor mode. |
| Screen buffer memory usage (large terminal history) | Cap scrollback ring buffer (default 10000 lines). Only active window's buffer is fully rendered; background windows keep parsed grid but skip compositing. |

## Related

- [RFC-014: Workspace System](RFC-014-workspace-system.md) — parent RFC
- [RFC-014B: project-mode](RFC-014B-project-mode.md) — project root becomes default shell CWD
- [RFC-013: Fikra AI Harness](RFC-013-fikra-ai-harness.md) — AI agents run in shell-mode windows
- [modes.md](../modes.md) — shell-mode entry (interactive terminal, not `.sh` file editing)
