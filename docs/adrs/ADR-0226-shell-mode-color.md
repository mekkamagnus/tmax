# ADR-0226: #202 — shell-mode renders color

- **Status**: accepted
- **Date**: 2026-08-19
- **Issues**: #202
- **Spec**: [BUG-84](../specs/BUG-84-shell-mode-unusable.md) (color section)

## Context

#201 made shell-mode work but rendered text-only. The reason was never a
missing color model: `Cell` has fg/bg (palette + truecolor RGB) +
bold/italic/underline/reverse, the parser emits `setSGR`, and the buffer
applies it — all since #164. `getLine` simply joined bare characters, and
the render path consumed that. Color was cut from #201 for blast radius;
the user then asked for it ("just like a normal shell").

## Decision

One styled read path, three pre-existing bugs fixed underneath it:

1. `ScreenBuffer.getStyledLine(row)` — cells → ANSI string with
   run-deduped prefixes; **explicit `\x1b[0m` on styled→default
   transitions** (emitting nothing would bleed the prior style over plain
   text) and a trailing reset (ANSI state persists across row writes);
   trailing fully-default blank cells trimmed (row padding — colored
   padding, e.g. a full-row background, stops the trim).
2. `TerminalManager.getVisibleStyledLines` — the render variant;
   `getVisibleLines` stays plain for T-Lisp/text consumers.
3. `Editor.getEditorState` injects the STYLED lines (all three render paths
   inherit); the TUI terminal branch no longer `.slice()`s lines (cutting
   an escape mid-code) — PTY width matches the pane via resize forwarding.

Bugs found while wiring (all pre-existing from #164, exposed by color):
- **Palette off-by-one**: the parser stores colors +1-biased (0 = default);
  re-emitting forgot the −1 decode — SGR 31 red rendered as palette-2
  green. Verified live before/after.
- **Truecolor lost at the cell**: `writeChar`/`blankCell` never copied the
  fgR/G/B + bgR/G/B fields — `\x1b[38;2;r;g;bm` text and truecolor
  backgrounds rendered default.

## Consequences

- Live-verified: `echo -e` red/bold-green/256-orange render as exactly
  `38;5;1` / `1;38;5;2` / `38;5;208`; the zsh prompt's full palette renders
  in the embedded pane with per-run resets (no bleed).
- Gate retry 1: wide-glyph continuation cells (CJK/emoji alignment — the
  emoji-bearing zsh prompt and claude/codex UIs were drifting, pre-existing
  #164), an injection-path test (tput color asserted in terminalLines,
  /bin/sh-scoped because zle wedges on programmatically-typed $(...) input),
  and the recorded gotcha that the EVAL-path string parser ignores `\r`
  escapes (tests embed a raw CR).
- Suites: screen-buffer 14/14, shell-integration 8/8, terminal 4/4,
  terminal-manager 8/8, input-tokenizer 4/4, pty 5/5 — 43/43 per-file;
  typecheck clean.
- Gate retry 2: isWideChar covers the full emoji span (the transport block
  was the gate's catch) + arrows; the parser iterates CODE POINTS
  (surrogate pairs were torn across cells — all emoji were at risk, pinned
  via the last-column case); the wrong narrow-is-harmless comment fixed;
  wide-glyph tests measure cells not string indices.
