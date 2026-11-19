# SPEC-262: markdown-journal-dir — journal layout as a variable

## Issue

#271 (follow-up to #270 / SPEC-261).

## Problem

`markdown-daily-note` hardcoded the `daily/` subdirectory. The user's convention (Emacs org-journal `%Y-%m-%d.org`, md-journal) is flat dated files; the layout must be configurable, org-journal style.

## Decision

- `defvar markdown-journal-dir` — default `"daily"` (behavior-preserving vs SPEC-261). `"."`/`""` = flat, cwd-relative. Absolute paths allowed.
- `markdown-journal-dir-set` — exported setter (module defvars are not `set!`-able from outside; the ADR-0168 pattern, same as `markdown-slugify-set`).
- `markdown-journal-path` — exported helper: dir + `/<date>.md`; `"."`/`""` yields the bare `<date>.md`.
- `markdown-daily-note` builds its path via the helper; mkdir + write-then-open pattern unchanged.
- Users configure from `~/.config/tmax/init.tlisp` — which must `(require-module editor/commands/markdown)` first because markdown modules load on `.md` open, not at core-bindings time.

## Completion criteria

- [x] Default layout unchanged (`daily/<date>.md`) — original tests still green
- [x] `markdown-journal-dir-set "."` → flat note in cwd, no `daily/` dir, `:w` persists
- [x] Setter exported; init.tlisp require-then-set pattern verified live
- [x] typecheck green; markdown suites 62/62
