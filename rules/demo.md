Scope: demo sessions driven through `tmaxclient` CLI and tmux

## Key Sending

- Special keys in `--keys` **must** use angle-bracket notation: `<Escape>`, `<Enter>`, `<Tab>`, `<Backspace>`, `<Space>`
- Bare words are sent character by character: `--keys 'Escape'` sends E, s, c, a, p, e — which types "Escape" as literal text
- `--key` sends a single key; prefer it for one keypress

## Setting Minibuffer Input

- Use `--eval '(minibuffer-set-input "cursor")'` instead of `--keys` for typing text into the minibuffer
- Avoids character-by-character timing issues and whitespace splitting

## Capturing Visual State

The daemon can render the current frame on-demand without tmux or screenshots:

```bash
# ANSI capture (colors preserved, viewable in terminal)
bun bin/tmaxclient --capture

# HTML capture (standalone file, viewable in browser)
bun bin/tmaxclient --capture-html > /tmp/tmax-capture.html
```

- `--capture` returns ANSI lines with full syntax highlighting colors (24-bit)
- `--capture-html` returns a standalone HTML document with One Dark theme
- Both reflect the current frame's buffer, cursor, mode, and status line
- Zero persistent memory — renders fresh on each call
- Use for demos: pipe ANSI to terminal, or open HTML in browser for screenshots/docs
- When no TUI is connected, captures render the daemon's internal editor state

### Demo: Status Line

The status line uses vim-style layout:
```
--NORMAL--          minibuffer.tlisp          L1 C1 [tlisp]
```

Segments: mode (bold, color-coded, dashed) | filename (centered) | line/col + major-mode (right)

```bash
# Show status line with a real file
bun bin/tmaxclient --eval '(find-file "src/tlisp/core/completion/minibuffer.tlisp")'
bun bin/tmaxclient --capture              # ANSI — see --NORMAL--, filename, L1 C1 [tlisp]
bun bin/tmaxclient --capture-html         # HTML — same, viewable in browser

# Switch modes to see different colors
bun bin/tmaxclient --key i                # INSERT (yellow)
bun bin/tmaxclient --capture
bun bin/tmaxclient --key '<Escape>'       # back to NORMAL (green)
```

## Tmux Window Collisions

- When creating tmux windows with `tmux new-window -t tmax -n NAME`, pick explicit free indices (e.g. `-t tmax:5`) to avoid "index in use" errors
- Check `tmux list-windows -t tmax` before creating windows

## State Cleanup

- Always verify editor mode with `--eval '(editor-mode)'` before starting a demo step
- Cancel stale minibuffer sessions with `--keys '<Escape>'` (may need twice)
- Previous demo sessions may leave garbage in minibuffer state — always cancel and re-open

## Function Names

- Use `(find-file)` not `(find-file-prompt)` for opening the file finder
- Use `(execute-extended-command)` for M-x
- Check `defun` names in the actual `.tlisp` files before invoking via eval
