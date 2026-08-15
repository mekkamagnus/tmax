# ADR-0218 — Markdown commands discoverable in M-x: resolution-aware duplicate counting + the SPEC-115 interactive migration (#190 / BUG-75)

## Status

Accepted

## Context

Found live while demoing SPEC-116 in the user's md-journal tab: M-x typing
`mark` showed only `vim-mark-*`; the full name `markdown-follow-wiki-link`
returned "No match". The entire 113-function markdown family was invisible to
M-x — almost certainly why the user "didn't see `[[` working".

Two independent causes, both fixed here:

1. **Registry qualification bug.** The markdown aggregator
   (`commands/markdown.tlisp`) re-LISTS every public markdown-* name in its
   `(export ...)` form but defines none of them (AC11.2: pure loader). Its
   env lookups return undefined, so its entries are (by design) skipped in
   `buildExports` — but the OLD duplicate counting counted the mere LISTING,
   marking every markdown name "duplicated" and qualifying the feature
   module's publicName to `editor/commands/markdown/<feature>/<name>`. M-x
   matches on the plain name → nothing matched. (SPEC-116's new commands
   escaped only because they were never added to the aggregator's list.)
2. **SPEC-115 migration gap.** M-x filters to commands declared
   `(interactive)` or keybound; the markdown defuns (predating SPEC-115)
   declared neither.

## Decision

- **`buildExports` counts duplicates only among exports that actually
  RESOLVE** (`env.lookup !== undefined`), and qualifies a name only when the
  resolving modules hold **distinct values** — an intentional re-export of
  one defun (same object) is not a conflict. The genuinely-conflicting case
  (two modules, different values) still qualifies, preserving the design.
- **The markdown family migrated to `(interactive)`** — 72 zero-required-arg
  defuns across the seven feature files declare it (inserted after the
  docstring, the SPEC-115 first-body-form position). Arg-taking helpers
  (`markdown-note-rank`, `markdown-frontmatter-get`, …) correctly stay out:
  M-x has no way to supply their arguments.

## Consequences

- **Easier:** the whole markdown toolkit (follow-wiki-link, backlinks, TOC,
  sparse-tree, tables, export…) is discoverable in M-x; SPEC-116's entry
  points are reachable by typing.
- **Harder:** new markdown commands must declare `(interactive)` to appear in
  M-x (one line, after the docstring) — the SPEC-115 contract now uniformly
  honored; arg-taking helpers stay private-by-default.
- Same-object re-exports resolving under one plain name keep
  `resolveUniqueExport` unambiguous for the cross-module call fallback.
- Regression-pinned: `test/unit/markdown-mx-discoverability.test.ts`
  (family present, helpers excluded, plain names survive, real conflicts
  still qualify).

Companion fix in the same demo arc: **BUG-74 (#189)** —
`markdown-wiki-link-at-point` compared the ABSOLUTE cursor column against
match offsets RELATIVE to the truncated search-text, so any link preceded by
another link on the same line was undetectable; now tracks a cumulative
offset (same shape as SPEC-116's range-at-point helper).
