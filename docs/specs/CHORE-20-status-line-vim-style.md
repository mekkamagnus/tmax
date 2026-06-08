# Chore: Vim-Style Status Line Layout

## Chore Description
Restyle the status line (bottom bar) to match the screenshot layout: vim-style mode indicator with dashes on the left, filename centered, and abbreviated line/column + major-mode bracket on the far right. Currently the status line crams everything left (`NORMAL[tlisp-mode] (flymake) Line: 1, Col: 1`) with the status message on the right.

Target layout (80-col example):
```
--NORMAL--  minibuffer.tlisp                          L1 C1 [tlisp]
```

Segments left-to-right:
1. `--NORMAL--` — mode name in dashes, bold + mode-specific color (green/yellow/magenta/cyan/blue)
2. Filename — `state.currentFilename` or `"*scratch*"`, white fg
3. Right-aligned block: `L{line} C{col}` (white) + `[{major-mode}]` (cyan) — pinned to right edge
4. Background: blue (unchanged)

Minor mode lighters (`(flymake)`) are dropped — they clutter the bar and are not in the screenshot. The status message field is removed from the right since the right side is now occupied by position+mode.

## Relevant Files

- `src/frontend/render/status-line.ts` — The only file that needs source changes. Contains `modeDisplay` map and `renderStatusLine()`. All three frontends (Steep, TUI client, capture-frame) call this function, so the change propagates automatically.
- `src/core/types.ts` — Reference for `EditorState` fields (`mode`, `currentFilename`, `cursorPosition`, `currentMajorMode`). Read-only, no changes.
- `src/frontend/frontends/steep/style.ts` — Reference for `style()`, `stripAnsi()`, `AnsiColor`. Read-only, no changes.

## Step by Step Tasks

### Update `modeDisplay` to use dashed vim format
- Change each entry's `text` from `"NORMAL"` to `"--NORMAL--"`, `"INSERT"` to `"--INSERT--"`, `"VISUAL"` to `"--VISUAL--"`, `"COMMAND"` to `"--COMMAND--"`, `"M-X"` to `"--M-X--"`.

### Rewrite `renderStatusLine` layout
- Build three segments: **left** (mode), **center** (filename), **right** (`L{line} C{col} [{major-mode}]`).
- Left: `style(mode.text, { fg: mode.color, bold: true })`.
- Center: `style(filename, { fg: "white" })` where filename = `state.currentFilename ?? "*scratch*"`, basename only (strip directory path).
- Right: `style(L/C, { fg: "white" })` + `style([major-mode], { fg: "cyan" })` where major-mode = `state.currentMajorMode ?? "fundamental"`. Strip `-mode` suffix if present (e.g. `tlisp-mode` → `tlisp`).
- Compute visible lengths of left+right. Center segment fills remaining space, padded with spaces on both sides to visually center.
- If center text is wider than available space, truncate with `...`.
- Wrap entire line in `style(line, { bg: "blue" })`.
- Remove `minorModes` and `statusMessage` from the status line.

### Validate
- Run typecheck
- Run full test suite
- Visual check via `--capture` or live TUI

## Validation Commands
- `bun run typecheck` — Zero type errors
- `bun test` — All tests pass, zero failures
- `bun bin/tmaxclient --capture` — Visual inspection shows new layout with `--NORMAL--`, filename centered, `L1 C1 [tlisp]` on right

## Notes
- This is a pure visual change to a single function. No type changes, no new files, no API changes.
- All three renderers (Steep, TUI client, capture-frame) consume `renderStatusLine` so they all get the new layout automatically.
- The `modeDisplay` export is only used inside `renderStatusLine`, so changing the text strings is safe.
- If tests reference specific status-line output, they may need updating — check `bun test` output.
