# SPEC-263: Uniform `~` expansion across file ops

## Issue

#275 (found via #271 org-journal parity work).

## Problem

`read-file-content` expanded a leading `~` to `$HOME` inline; `write-file-content`, `append-file`, `file-mkdir`, `file-exists-p`, `file-stat`, `file-modtime`, `file-copy`, `file-remove`, `read-dir`, `make-backup-file` did not. The same path string resolved differently per op: a `~/journal` home read templates from `$HOME` but wrote notes into a **literal `./~/` directory**.

## Decision

One `expandHomePath` helper (`^~` → `process.env.HOME`), applied to every path-taking builtin's path extraction (9 `path`, plus `file-copy`'s `src`/`dest`). `read-file-content`'s inline regex refactors onto the helper. Non-`~` paths are byte-identical — behavior-preserving everywhere else. Trailing `~` (backup suffixes) is untouched; only the **leading** tilde is a home reference.

This unblocks the org-journal configuration model in init.tlisp: one **absolute** journal home (`~/Documents/md-journal`), flat dated files inside it, launch directory irrelevant.

## Completion criteria

- [x] `~/…` works uniformly across read/write/append/mkdir/exists/stat/copy/remove/read-dir
- [x] Unit test: HOME overridden to a temp vault, `markdown-journal-dir-set "~/journal"` → daily note in `<vault>/journal/`, no literal `~` dir, `:w` persists
- [x] typecheck clean; markdown + fikra-thread suites green (85 pass total)
