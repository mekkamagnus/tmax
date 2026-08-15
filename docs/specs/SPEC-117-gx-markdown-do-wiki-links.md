# Feature: `gx` (markdown-do) handles `[[wiki-links]]` — one context key for everything

## Goals

- `gx` on ANY link-ish thing at point does the natural follow: inline `[text](url)` links, `[text](file.md)` links, AND `[[wiki-links]]` (including dangling ones → the SPEC-116 follow-or-create prompt).

## Completion Criteria (Definition of Done)

- [x] `markdown-do`'s dispatch (formatting.tlisp) checks `markdown-wiki-link-at-point` BEFORE falling through to heading/checkbox — `[[link]]` at point → `markdown-follow-wiki-link` (existing links open; dangling → the follow-or-create prompt).
- [x] Precedence rule pinned where observable: inline link > wiki-link > heading fold > checkbox. **Verify-gate correction:** inline-vs-wiki order is unobservable by construction — both at-point predicates are cursor-scoped and the wiki regex `\[\[[^\]]+\]\]` cannot match a line containing an inner `[t](u)`, so the two are mutually exclusive; the clause order documents intent. The OBSERVABLE orderings are tested: wiki > heading (a heading line containing `[[link]]` follows the link, not the fold) and heading-fold/checkbox behavior pinned below.
- [x] Unit tests: gx-path dispatch on each category at point.
- [x] **Live e2e in the mekkapi tab**: on a note in `~/Documents/md-journal`, `gx` over an existing `[[2026-08-08]]` opens it; over a dangling `[[brand new thought]]` opens the follow-or-create prompt — verified by reading the pane (transcript in issue #192).
- [x] No regression — **verify-gate correction:** the original wording said "on a checkbox still toggles (markdown-do's existing behavior)" but markdown-do had NO checkbox branch, and `markdown-toggle-checkbox` itself had never worked (its regex used `\s-` where `\s+` was meant, `\(…\)` capture groups mis-escape in this interpreter's string layer, and its delete-line+insert flow dropped the task text). This change ADDS the checkbox branch the docstring always promised and FIXES the toggle (groupless detection + substring surgery, single-char character classes only). `gx` on a heading now folds with a strong assertion (fold-get-ranges non-empty); `gx` on a checkbox toggles both directions with text preserved (`- [ ] buy milk` → `- [x] buy milk`, `- [x]`/`- [X]` → `- [ ]`, `*` markers work, bare `[ ]` lines untouched).
- [x] `bun run typecheck` + markdown suites green.

## Motivation

`gx` already IS markdown-do ("Context-aware action at point") — the natural, discoverable binding. Wiki-links being M-x-only while inline links get gx is the split that made the user feel "[[ isn't working". Folding wiki follow into gx unifies it (and largely resolves BUG-76's UX component).

## Relevant Files

- `src/tlisp/core/commands/markdown/formatting.tlisp` — `markdown-do` cond dispatch.
- `src/tlisp/core/commands/markdown/knowledge.tlisp` — `markdown-wiki-link-at-point`, `markdown-follow-wiki-link` (SPEC-116).
