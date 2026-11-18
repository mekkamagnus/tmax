# SPEC-261: markdown-daily-note must create its target before opening

## Issue

#270 (live reproduction 2026-11-18 in `~/Documents/md-journal`).

## Problem

`markdown-daily-note` computed `daily/<date>.md` and called only `find-file-open`:

- `find-file-open` is a no-op for missing files → the buffer is never file-backed;
- the `daily/` directory is never created.

Typing an entry then `:w` went `save.tlisp → write-file-content → fs.writeFile('daily/<date>.md')` → **ENOENT** (missing parent), stranding the entry in an unbacked buffer.

## Decision

Mirror `markdown-write-note-template` (the #185 gap-2 pattern) in `markdown-daily-note`:

1. existing target → open only (never clobber);
2. missing target → `file-mkdir` the dirname (recursive), write the note content
   (user template `~/.config/tmax/templates/daily.md` wins — same expansion as
   `markdown-new-from-template` — else the built-in `# <date>` daily fallback),
   THEN open.

Write-then-open also sidesteps the BUG-58 class: the buffer is associated with
its filename from creation, so `:w`/`save-buffer` cannot silently break.

## Completion criteria

- [x] `, N d` with no `daily/` creates `daily/<date>.md` on disk and opens a file-backed buffer; typed entry + `:w` persists (no ENOENT)
- [x] Existing daily note is opened, content untouched, no extra note files minted
- [x] Unit tests: `test/unit/markdown-daily-note.test.ts` (both paths, per-test chdir vaults)
- [x] typecheck:src / typecheck:test / typecheck green; markdown-commands, comma-leader, wiki-link-complete, follow-link suites green (74 pass)
