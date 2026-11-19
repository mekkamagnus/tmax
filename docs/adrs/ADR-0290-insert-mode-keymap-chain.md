# ADR-0290: Insert mode consults the T-Lisp keymap chain; capture-daily is its first consumer

## Status

Accepted

## Context

Issue #278 (capture, the `SPC r d` org-roam-dailies parity) needs `C-c C-c` / `C-c C-k` / `C-g` to work while the user TYPES in a compose buffer — but `handleInsertMode` only handled printable/Enter/Backspace/Tab/Escape specially and fell back to the TS keyMappings registry; the T-Lisp keymap chain (`current-keymap`: buffer-local → minor → mode, the #206 chain) was consulted only by the normal-mode handler, and insert mode had no prefix machinery at all. This is the same gap the compose-then-commit contract (#277) and the fikra draft line (#268) face.

## Decision

1. Insert mode routes through the chain in two places: (a) a pending keymap prefix resolves EVERY next key through the chain before any insert behavior; (b) non-printable keys with no prefix check the chain first — a prefix hit arms the chord (`SetWhichKeyPrefix`), a miss falls through to the TS registry unchanged.
2. `editor/commands/capture`: `capture-daily` opens a fresh `*Capture*` buffer (kill+create) with a buffer-local keymap; `capture-commit` appends `- [ts] text` to today's note via `markdown-journal-path` (+ `markdown-daily-note-init`, extracted from daily-note's create branch for no-open creation); `capture-abort`/restore return the exact prior buffer/mode/point.
3. `SPC r d` bound in normal mode.

## Consequences

- Buffer-local keymaps are now live in insert mode — the fikra draft line (#268) can bind its `C-c C-c`/`C-c C-k`/`M-p`/`M-n` contract without further handler work (#277's front-ends both exist now).
- Chords use Emacs's exact keys because no default map binds any `C-c` prefix — first taker wins; future modules adding `C-c` chords in insert mode share the prefix cleanly.
- No chord pending → insert behavior is byte-identical (chain misses fall to the registry; default insert maps contain no prefixes).
- Escape during a pending chord resolves as an unbound full-key and clears the prefix (chord cancel), rather than switching modes with a stale prefix.
