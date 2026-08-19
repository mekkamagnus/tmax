# ADR-0225: #201 / BUG-84 — shell-mode's last mile (claude + codex run in it)

- **Status**: accepted
- **Date**: 2026-08-19
- **Issues**: #201
- **Spec**: [BUG-84](../specs/BUG-84-shell-mode-unusable.md)

## Context

The user's bar: run `claude` and `codex` inside tmax's shell-mode. Investigation
found everything UNDER the feature worked (PTY via Bun.spawn terminal, ANSI
parse into a ScreenBuffer, key-to-bytes mapping, C-\ escape — 15/15 tests) and
nothing ABOVE it was wired:

1. `editor-set-mode`'s validModes omitted `'terminal'` — `shell-start`'s very
   first form threw `Invalid mode: terminal`.
2. `captureTerminalFrame` read `state.terminalLines`, which NOTHING populated —
   `shell-get-lines` had zero callers. Blank screen.
3. `boundp` was never a builtin — `terminal-handler`'s active-terminal lookup
   ALWAYS errored, so even with 1+2 fixed, keys never reached the PTY.

## Decision

- **One injection chokepoint**: `Editor.getEditorState()` attaches the active
  PTY's screen (`terminalLines`) + cursor (`terminalCursor`) when the mode is
  terminal. The embedded frontend (captureFrame path), the daemon's
  frame-based state (`frameToEditorState` spreads the injected fields), and
  the client wire (`SerializedEditorState` + deserialize) all inherit it —
  no per-frontend fetch logic.
- **Id lookup via T-Lisp export**, not defvar spelunking:
  `shell-active-terminal-id` (shell.tlisp); the handler and the injection
  call it.
- **Streaming**: embedded gets an always-on 100ms repaint tick guarded by
  `mode === "terminal"` (the check must be INSIDE the tick — the mode at
  startup wiring time is still `normal`); the TUI client's existing 200ms
  poll re-renders unconditionally and picks the fields up per cycle.
- **Cursor ownership**: in terminal mode both frontends place the caret at
  the PTY's own row/col (Ink/Rust TUIs position their own input boxes).
- **TERM**: PTY children get `xterm-256color`, never inheriting `TERM=dumb`
  (Ink degrades on it).
- **Entry**: `SPC !` → shell-start (M-x shell stays; BUG-81 makes the chord
  flaky live).
- **Resize**: `updateTerminalSize` forwards to the active PTY in terminal
  mode (rows-1 for the status line).

## Consequences

- Verified live, both frontends: zsh prompt renders; typing/output/re-prompt;
  **claude's full lifecycle** (TUI renders, prompt typed and submitted, a
  real agent turn STREAMED — spinner/token counter updating through our
  capture path — response rendered, `/exit`, prompt back) and **codex's TUI**
  (welcome box, model line, exit) — transcripts in the spec.
- Colors are dropped (ScreenBuffer is text-only): claude/codex CONTENT
  renders monochrome. Documented v1 scope; per-cell SGR is the follow-up.
- Test-harness note: PTY-spawning suites HANG when run in ONE bun process
  (the BUG-16 class) — run them per-file / via the hardened runner; the
  suites hang cost this fix a debug cycle and is now recorded in the spec.
- tmux quirk recorded: `send-keys C-backslash` does not emit 0x1c; send the
  literal byte.
- Suites: shell-integration 6/6 (3 new: mode-entry, injection incl.
  deterministic PTY round-trip + exit-clears, getter), terminal 4/4,
  terminal-manager 8/8, input-tokenizer 4/4, pty 5/5; typecheck clean.
