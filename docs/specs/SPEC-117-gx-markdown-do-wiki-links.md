# Feature: `gx` (markdown-do) handles `[[wiki-links]]` — one context key for everything

## Goals

- `gx` on ANY link-ish thing at point does the natural follow: inline `[text](url)` links, `[text](file.md)` links, AND `[[wiki-links]]` (including dangling ones → the SPEC-116 follow-or-create prompt).

## Completion Criteria (Definition of Done)

- [ ] `markdown-do`'s dispatch (formatting.tlisp ~line 236) checks `markdown-wiki-link-at-point` BEFORE falling through to heading/checkbox — `[[link]]` at point → `markdown-follow-wiki-link` (existing links open; dangling → the follow-or-create prompt).
- [ ] Precedence rule pinned: inline link > wiki-link > heading fold > checkbox. (A `[t](u)` inside a `[[…]]` is pathological; any deterministic order is fine, just tested.)
- [ ] Unit tests: gx-path dispatch on each category at point.
- [ ] **Live e2e in the mekkapi tab**: on a note in `~/Documents/md-journal`, `gx` over an existing `[[2026-08-08]]` opens it; over a dangling `[[fresh idea]]` opens the follow-or-create prompt — verified by reading the pane.
- [ ] No regression: `gx` on a heading still folds, on a checkbox still toggles (markdown-do's existing behavior, covered by its tests).
- [ ] `bun run typecheck` + markdown suites green.

## Motivation

`gx` already IS markdown-do ("Context-aware action at point") — the natural, discoverable binding. Wiki-links being M-x-only while inline links get gx is the split that made the user feel "[[ isn't working". Folding wiki follow into gx unifies it (and largely resolves BUG-76's UX component).

## Relevant Files

- `src/tlisp/core/commands/markdown/formatting.tlisp` — `markdown-do` cond dispatch.
- `src/tlisp/core/commands/markdown/knowledge.tlisp` — `markdown-wiki-link-at-point`, `markdown-follow-wiki-link` (SPEC-116).
