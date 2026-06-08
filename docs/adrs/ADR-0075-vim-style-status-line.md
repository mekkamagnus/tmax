# Vim-Style Status Line Layout

## Status

Accepted

## Context

The status line crammed all information to the left: `NORMAL[tlisp-mode] (flymake) Line: 1, Col: 1` with a status message on the right. This didn't match vim conventions and wasted the full width of the terminal. The filename — the most important contextual information — wasn't displayed at all.

## Decision

Restyle the status line to a three-segment layout:

- **Left**: `--NORMAL--` — dashed vim-style mode indicator, bold, mode-specific color (green/yellow/magenta/cyan/blue)
- **Center**: Filename (basename only) or `*scratch*`, centered in remaining space, white foreground
- **Right**: `L{line} C{col} [{major-mode}]` — position and major mode pinned to right edge, mode suffix stripped (`tlisp-mode` → `tlisp`)

Background: blue (unchanged). Minor mode lighters and status message removed from the status line.

Single file change: `src/frontend/render/status-line.ts`. All three frontends (Steep, TUI client, capture-frame) consume `renderStatusLine()` so the change propagates automatically.

## Consequences

- Consistent with vim's `--INSERT--` / `--VISUAL--` mode display convention.
- Filename is always visible — the most commonly needed context.
- Major mode displayed in abbreviated form at the right edge where it doesn't compete for attention.
- Removing status message from the bar simplifies the layout; messages can be shown via `*Messages*` buffer or echo area in the future.
