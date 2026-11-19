# ADR-0288: The journal directory is a variable with an exported setter

## Status

Accepted

## Context

Issue #271: after SPEC-261 made `markdown-daily-note` write-then-open, the `daily/` subdirectory remained hardcoded. The user's journals (Emacs org-journal and md-journal) both use flat dated files, and org-journal itself configures location via `org-journal-dir`.

## Decision

Add `markdown-journal-dir` (defvar, default `"daily"` — preserving SPEC-261 behavior), the exported setter `markdown-journal-dir-set`, and the helper `markdown-journal-path`. `"."`/`""` select flat cwd-relative layout; absolute paths are allowed. `markdown-daily-note` derives its path from the helper; nothing else in its flow changes.

The setter (not bare `set!`) follows the ADR-0168 rule that module defvars are not settable from outside the module. Configuration belongs in `~/.config/tmax/init.tlisp`, which must `(require-module editor/commands/markdown)` before calling the setter — markdown command modules load on `.md` file open (auto-mode), not at core-bindings time, so init-time configuration needs the explicit require.

## Consequences

- Journal layout is user config, not code; the default remains `daily/` so no existing behavior changes.
- The require-then-set pattern in init.tlisp is the template for configuring any module defvar at startup; without the require the init file reports an undefined symbol (surfaced on the status line, not swallowed).
- `markdown-journal-path` is the single place that knows the layout; future journal commands (navigation, carryover — both still missing vs org-journal) must build on it.
