# Bug: no `markdown-*` commands appear in M-x completion — the markdown toolkit is undiscoverable

## Goals

- M-x completion lists the `markdown-*` commands (100+ shipped functions: follow-wiki-link, backlinks, TOC, sparse-tree, tables, export…) so users can find them without knowing names in advance.

## Completion Criteria (Definition of Done)

- [ ] In a live editor, M-x typing `mark` shows `markdown-*` candidates alongside `vim-mark-*`.
- [ ] `(command-completion-table …)` contains `markdown-follow-wiki-link`, `markdown-do`, `markdown-backlinks` (spot-check 3).
- [ ] SPEC-116's `markdown-follow-wiki-link` is reachable via M-x (typed or completion-selected).
- [ ] M-x latency stays within its budget (the table is cached — perf fixes #182–#184 must not regress; spot-measure first-paint).
- [ ] `bun run typecheck` + markdown + completion regression suites green.

## Bug Description

Discovered live (2026-08-15, mekkapi-tab demo): M-x typing `mark` shows **only
`vim-mark-*`** (5 candidates); typing the full `markdown-follow-wiki-link` →
"**No match**". The command is exported, callable via eval, and docstringed —
it just never reaches the completion table. Same for the whole `markdown-*`
family. This is very likely why the user "didn't see `[[` working": the only
entry points are unbound commands invisible to M-x.

## Root Cause (to confirm during fix)

`command-completion-refresh` (src/tlisp/core/commands/execute-extended-command.tlisp)
filters `callable-command-details` by `command-detail-interactive-p`: a command
qualifies if it has non-empty `documentation` OR a keybinding. The TS side
(`callable-command-details`, editor.ts ~1113–1155) collects from global
bindings + `moduleRegistry.allExports()` and extracts `"documentation"` as the
first line of the defun's docstring. Suspects (check in this order):

1. The **export-index cache** (perf fix, CHORE-85 era / #186–#188 arc) is
   built before the markdown module loads (or excludes module exports) — so
   `markdown-*` never enters `callable-command-details` at all.
2. Docstring extraction returns empty for module-exported defuns → fails
   `command-detail-interactive-p` (no doc AND no binding).
3. Module exports aren't represented in `bindingsByCommand` and the
   documentation field is only populated for global-env functions.

## Solution Statement

Fix whichever link in the chain drops the markdown module's exports (most
likely the cached index); ensure exported defuns carry their docstring into
the details hashmap. If the cache is the culprit, invalidate/rebuild it after
core bindings finish loading. Add a regression test asserting the completion
table contains the markdown family.

## Relevant Files

- `src/tlisp/core/commands/execute-extended-command.tlisp` — `command-completion-refresh`, `command-detail-interactive-p`.
- `src/editor/editor.ts` — `callable-command-details` (~1113–1155).
- `src/tlisp/module-registry.ts` — `allExports` / the export-index cache.
- `test/unit/` — completion/table regression (new or existing file).

## Severity

high — makes the entire markdown toolkit (and the just-shipped SPEC-116
follow-or-create) effectively undiscoverable; users cannot find the feature.
