# ADR-0289: Every path-taking file op expands a leading tilde

## Status

Accepted

## Context

Issue #275: only `read-file-content` expanded `~` (inline regex). The other ten path-taking builtins passed the raw string to `fs`, so a `~/journal` journal home — the natural org-journal-style configuration — read from `$HOME` but wrote into a literal `./~/` directory. Discovered while wiring the user's init.tlisp to an absolute journal home (org-journal's `org-journal-dir` = `org-directory` = one specific absolute directory).

## Decision

A single `expandHomePath` helper in `file-ops.ts` (`^~` → `process.env.HOME`) is applied at every path extraction across the module. Non-tilde paths are unchanged (the regex is a no-op). Trailing tildes — the `path + '~'` backup suffix convention — are untouched: only a **leading** tilde denotes home.

## Consequences

- Path semantics are now uniform: any builtin accepts `~/…` or absolute or cwd-relative.
- The org-journal configuration model works in init.tlisp: `(markdown-journal-dir-set "~/Documents/md-journal")` — one absolute home, flat dated files, launch directory irrelevant.
- Any future path-taking builtin must use `expandHomePath`; the helper's doc comment states the rule.
