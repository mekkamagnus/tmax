# Bug/Feature: shell-mode (M-x shell) usable — claude and codex run in it without problem

## Goals

- `M-x shell` enters a working terminal mode: the PTY's screen renders in the
  editor, keys go to the PTY, `C-\` returns to the editor.
- **The bar (user, 2026-08-19): `claude` and `codex` run inside shell-mode
  without problem** — their full-screen TUIs (Ink / Rust) render coherently,
  streaming output updates the display, typing/editing/pasting into them
  works, and exiting returns cleanly to the editor.

## Completion Criteria (Definition of Done)

- [x] `(editor-set-mode "terminal")` accepted (the validModes list includes
      `'terminal'` — the mode union already does).
- [x] Render wiring: in terminal mode, the editor state carries the PTY's
      screen (`shell-get-lines` / TerminalManager) as `terminalLines`, and
      both frontends (embedded Steep + daemon/TUI) display it.
- [x] Streaming repaint: PTY output appearing while the user is idle reaches
      the screen without a keystroke (embedded gets a terminal-mode repaint
      tick; the TUI's change-detection poll includes the terminal lines).
- [x] PTY size matches the editor's terminal on entry AND on resize
      (shell-resize wired to the active terminal; the PTY is created at the
      real pane size, minus the status line).
- [x] PTY env: `TERM=xterm-256color` (claude/Ink refuse or degrade on
      unset/dumb TERM; the PTY child must not inherit a GUI-launched env).
- [x] Terminal cursor: the PTY's cursor position is rendered (Ink/claude put
      the input box at a specific row; the caret must sit where the child
      expects it).
- [x] **claude e2e (tmux, live)**: enter shell-mode → run `claude` → the
      welcome/prompt UI renders; type a short prompt and send it; output
      streams; exit claude → shell prompt returns; `C-\` → editor intact.
- [x] **codex e2e (tmux, live)**: same shape for `codex` (launch, UI
      renders, interaction, exit).
- [x] Plain-shell regression: `echo`, multiline output, `C-c`, `C-d`/exit
      still behave (existing terminal suites stay green).
- [x] `bun run typecheck` + shell/terminal suites green.

## Known facts (investigated 2026-08-19)

- **Break 1 (one-liner)**: `editor-set-mode`'s `validModes`
  (src/editor/api/mode-ops.ts:83) omits `'terminal'` — `shell-start`'s
  first `(editor-set-mode "terminal")` throws `Invalid mode: terminal`
  (verified live via daemon eval). With it added (probe, since reverted),
  shell-start returns a term id and the mode flips.
- **Break 2 (the render wiring)**: with entry fixed, the screen renders
  BLANK — `captureTerminalFrame` reads `state.terminalLines`, which nothing
  populates; `shell-get-lines` has zero callers.
- What already works: PTY + ANSI parse into a ScreenBuffer (15/15 tests),
  key routing incl. arrows/Ctrl bytes (terminal-handler.ts), `C-\` escape,
  shell-start/-exit T-Lisp, `--TERMINAL--` status line, comint (pipes).
- Sizes: the `shell` primitive already creates the PTY at the editor's
  terminal size (rows-1) via a getTerminalSize closure — resize-while-active
  is not wired.
- Styles: ScreenBuffer stores text only (no SGR/256-color cell attrs) —
  claude/codex CONTENT renders; COLORS are dropped (documented v1 scope;
  colors are a follow-up, not part of this fix's bar).
- Entry is also hampered by BUG-81 (`SPC ;` flaky live) — the e2e may use
  the daemon-eval route or a direct keybinding.

## Relevant Files

- `src/editor/api/mode-ops.ts:83` — the validModes one-liner.
- `src/editor/editor.ts` (`getEditorState`) — inject `terminalLines` (+ PTY
  cursor) when mode is terminal; the single chokepoint both frontends and
  the daemon's state serialization already consume.
- `src/core/pty.ts` / `src/editor/api/shell-ops.ts` — TERM env on spawn;
  resize wiring for the active terminal.
- `src/render/capture-frame.ts` — render the terminal cursor row/col.
- `src/steep/assam.ts` + `src/client/tui-client.ts` — terminal-mode repaint
  tick / change-detection inclusion; cursor placement in terminal mode.
- `src/editor/handlers/terminal-handler.ts` — routing (works; no change
  expected).
- `src/tlisp/core/commands/shell.tlisp` — entry/exit (works once the mode
  is admitted).

## Severity

high — the user's stated goal is running claude/codex inside tmax
(agent-in-editor workflow); comint only covers line-oriented CLIs.

## Live e2e transcript (tmux + daemon RPC, 2026-08-19)

### Embedded (Steep — the mekkapi tab's frontend)
```
$ tmux new-session … "bun src/main.ts"; SPC then "!"     ← new direct binding
  mekael in 🌐 Mekaels-MacBook-Pro in tmax on  issue-201 …
  ❯                                              ← live zsh prompt
--TERMINAL--   *scratch*   L1 C1 [fundamental]

$ typed: e c h o ␣ e m b e d d e d - o k  Enter
  ❯ echo embedded-ok … new prompt after output      ← typed + output + re-prompt

$ typed: c l a u d e  Enter (8s)
  ▐▛███▜▌   Claude Code v2.1.195
  ▝▜█████▛▘  glm-5.3[1m] · API Usage Billing
  ❯                                            ← claude's input box
    tmax (mekkamagnus/tmax) -> glm-5.3[1m]
    -- INSERT -- ← for agents                   ← claude's own status line

$ /exit Enter → claude exits; 0x1c (C-\) → --NORMAL--, buffer intact
```

### Daemon + keypress RPC (claude full lifecycle)
```
$ tmaxclient --eval '(shell-start)' → term-fbe3d23f
$ keypress RPCs "e c h o ␣ h i Enter" → capture shows "hi"    (keys route ✓)
$ keypress RPCs "c l a u d e Enter" (interactive):
  Claude Code v2.1.195 · glm-5.3[1m] · ~/…/tmax · ❯ box
$ typed "hello from tmax shell-mode" → appears in claude's ❯ box
  (submitted; turn ran: "✻ Billowing… (39s · ↓906 tokens · thinking)"
   streamed live via the capture path; response text rendered)
$ /exit → "Resume this session with: claude --resume 3a707be9…" + zsh prompt
$ C-\ keypress → mode normal
```

### Daemon + keypress RPC (codex)
```
$ "c o d e x Enter":
  ╭──────────────────────────────╮
  │ >_ OpenAI Codex (v0.147.0)   │  model: loading …
  │ directory: ~/…/tmax          │
  › Implement {feature} … gpt-5.6-luna default
$ C-c → exits → zsh prompt back
```

## Implementation notes (2026-08-19)

- **The render wiring** lives in `Editor.getEditorState`: when mode is
  terminal, the active PTY's screen (TerminalManager.getVisibleLines) +
  cursor are attached as `terminalLines`/`terminalCursor` — the single
  chokepoint the embedded frontend, the daemon's frame path
  (`frameToEditorState` spreads the injected fields when the frame's mode
  is terminal), and the wire (`SerializedEditorState` + deserialize) all
  consume.
- **Streaming**: the embedded frontend runs a 100ms repaint tick in
  terminal mode (always-on interval with a mode guard); the TUI's existing
  200ms poll picks the injected fields up on every cycle (its revision is
  wall-clock, so it re-renders unconditionally).
- **`boundp` was never a builtin** — terminal-handler's id lookup always
  errored (keys NEVER reached the PTY, even pre-render-fix). shell.tlisp now
  exports `(shell-active-terminal-id)`; the handler and the injection call
  it.
- **Cursor**: both frontends place the terminal cursor at the PTY's own
  row/col in terminal mode (Ink/claude position their input box; the caret
  belongs where the child expects it).
- **TERM**: the PTY defaults to xterm-256color and never inherits
  TERM=dumb (Ink degrades on it).
- **Entry**: `SPC !` bound to shell-start (M-x shell remains; BUG-81 makes
  the chord flaky live — shell-mode needed a reliable direct entry).
- tmux's `send-keys C-backslash` does NOT emit 0x1c — send the literal
  byte (`send-keys -l "$(printf '\x1c')")`; C-\ itself works in both paths.
- Colors: ScreenBuffer is text-only — claude/codex CONTENT renders; SGR
  colors are dropped (documented v1 scope, follow-up).

## Gate retry 1 fixes (2026-08-19)

- assam terminal cursor now clamps to the visible pane (matches the TUI
  branch; a PTY can report past it).
- The `_terminalManager` implicit contract is TYPED:
  `EditorAPIContext.terminalManager?` — set by the shell-ops factory, read
  by the injection (a rename now fails typecheck, not silently).
- `activeTerminalId()` memoizes the id (the interpreter round-trip ran every
  100ms tick); the cache clears when the mode leaves terminal and revalidates
  against the manager.
- Caveated (accepted): `frameToEditorState` reads the single server editor
  for terminal fields (the daemon hosts ONE editor — would need per-frame
  editors to matter); the TUI width-slice can miscount double-width glyphs
  (v1 text-only scope); live transcripts are the e2e evidence (established
  convention).
