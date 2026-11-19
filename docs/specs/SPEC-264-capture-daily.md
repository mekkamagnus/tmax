# SPEC-264: SPC r d — direct capture to today's daily note

## Issue

#278 (user's most-used Emacs chord: `SPC r d` → `org-roam-dailies-capture-today`).

## Decision

New module `editor/commands/capture` (required from `bindings/normal.tlisp`):

- `capture-daily` — records return state (buffer, mode, line, col), builds a fresh `*Capture*` buffer (kill+create — no stale text), insert mode, attaches the buffer-local keymap (`C-c C-c` / `C-c C-k` / `C-g`; fikra-chat #206 pattern; no `C-c` chords existed anywhere).
- `capture-commit` — trims text; empty = no-write abort. Target = `markdown-journal-path`; missing file created via the extracted `markdown-daily-note-init` (mkdir + template, NO open — refactored out of `markdown-daily-note`'s create branch). Appends `\n- [YYYY-MM-DD HH:MM] text\n` (org-log entry style, matches fikra send-log mockups).
- `capture-abort` / `capture-restore` — kill `*Capture*`, restore buffer/mode/point exactly.

**Handler change (the enabler):** insert mode now consults the T-Lisp keymap chain (`current-keymap`: buffer-local → minor → mode) —
1. when a prefix is pending (the `C-c` of a chord), every next key resolves through the chain BEFORE any insert behavior (printable continuation can never leak into the buffer);
2. non-printable keys with no pending prefix check the chain first — a prefix hit arms the chord; a miss falls to the TS registry, byte-identical to before.

No chord pending + default maps → zero behavior change (insert maps contain no prefixes; chain misses fall through).

## Completion criteria

- [x] `SPC r d` → `*Capture*` in insert mode; `C-c C-c` appends and restores exactly; `C-c C-k`/`C-g` abort
- [x] Fresh-file creation (template header), existing-file append (no clobber/duplicate header), empty commit no-op
- [x] `markdown-journal-dir` honored (flat `.` and default `daily/` tested)
- [x] Repeat capture starts empty (kill+create)
- [x] 6/6 unit tests incl. full key dispatch (handleKey " " → SPC, chords via handleKey C-c/C-c); typecheck clean; insert/prefix regression batch 104 pass
