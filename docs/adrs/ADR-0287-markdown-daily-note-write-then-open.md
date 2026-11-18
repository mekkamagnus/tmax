# ADR-0287: markdown-daily-note writes then opens

## Status

Accepted

## Context

Issue #270: `markdown-daily-note` called only `find-file-open` on `daily/<date>.md`. `find-file-open` is a no-op for missing files and nothing created `daily/`, so the user got an unbacked buffer whose `:w` hit `write-file-content` ENOENT (missing parent dir) — reproduced live in a journal with flat dailies and no `daily/`.

## Decision

`markdown-daily-note` now mirrors `markdown-write-note-template` (ADR for #185 gap 2): if the target exists, open only (never clobber); otherwise `file-mkdir` the dirname (recursive), write the note content, then open. Content: user template `~/.config/tmax/templates/daily.md` (variables expanded) wins, else the same built-in daily fallback `markdown-new-from-template` uses.

## Consequences

- The buffer is file-backed from creation — `:w` works and the BUG-58 class (buffer without associated filename) is dodged by construction.
- The write-then-open pattern is now used by every markdown creation command; any future creation command must follow it, not bare `find-file-open` (a missing file is a silent no-op there).
- Tests chdir into per-test temp vaults because the command path is relative (`daily/<date>.md` resolves against process cwd — the daemon runs cwd = repo-root in source, so a daemon-client user's daily note lands under the daemon's cwd; unchanged behavior, noted here for the record).
