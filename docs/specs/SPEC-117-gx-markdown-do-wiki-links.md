# Feature: `gx` (markdown-do) handles `[[wiki-links]]` — one context key for everything

## Goals

- `gx` on ANY link-ish thing at point does the natural follow: inline `[text](url)` links, `[text](file.md)` links, AND `[[wiki-links]]` (including dangling ones → the SPEC-116 follow-or-create prompt).

## Completion Criteria (Definition of Done)

- [x] `markdown-do`'s dispatch (formatting.tlisp) checks `markdown-wiki-link-at-point` BEFORE falling through to heading/checkbox — `[[link]]` at point → `markdown-follow-wiki-link` (existing links open; dangling → the follow-or-create prompt).
- [x] Precedence rule pinned where observable: inline link > wiki-link > heading fold > checkbox. **Verify-gate correction:** inline-vs-wiki order is unobservable by construction — both at-point predicates are cursor-scoped and the wiki regex `\[\[[^\]]+\]\]` cannot match a line containing an inner `[t](u)`, so the two are mutually exclusive; the clause order documents intent. The OBSERVABLE orderings are tested: wiki > heading (a heading line containing `[[link]]` follows the link, not the fold) and heading-fold/checkbox behavior pinned below.
- [x] Unit tests: gx-path dispatch on each category at point.
- [x] **Live e2e in the mekkapi tab**: on a note in `~/Documents/md-journal`, `gx` over an existing `[[2026-08-08]]` opens it; over a dangling `[[brand new thought]]` opens the follow-or-create prompt — verified by reading the pane (transcript in issue #192).
- [x] No regression — **verify-gate correction:** the original wording said "on a checkbox still toggles (markdown-do's existing behavior)" but markdown-do had NO checkbox branch, and `markdown-toggle-checkbox` itself had never worked: its regex used `\s-` where `\s+` was meant (the sole matching defect — capture groups work fine with the file's 2-backslash convention, as knowledge.tlisp's own wiki regex shows), and its delete-line+insert flow dropped the task text after the marker. This change ADDS the checkbox branch the docstring always promised and FIXES the toggle (groupless detection + substring surgery; empirical note: a multi-char class directly inside escaped brackets — `\\[ xX\\]` — silently never matches, so the checked-state detection uses split single-char-class patterns). `gx` on a heading now folds with a strong assertion (fold-get-ranges non-empty); `gx` on a checkbox toggles both directions with text preserved (`- [ ] buy milk` → `- [x] buy milk`, `- [x]`/`- [X]` → `- [ ]`, `*` markers work, bare `[ ]` lines untouched).
- [x] `bun run typecheck` + markdown suites green.

## Motivation

`gx` already IS markdown-do ("Context-aware action at point") — the natural, discoverable binding. Wiki-links being M-x-only while inline links get gx is the split that made the user feel "[[ isn't working". Folding wiki follow into gx unifies it (and largely resolves BUG-76's UX component).

## Relevant Files

- `src/tlisp/core/commands/markdown/formatting.tlisp` — `markdown-do` cond dispatch.
- `src/tlisp/core/commands/markdown/knowledge.tlisp` — `markdown-wiki-link-at-point`, `markdown-follow-wiki-link` (SPEC-116).

## Live e2e transcript (mekkapi tab, herdr pane w2:p3, 2026-08-15)

Captured from the real TUI (embedded Steep via the ~/.bun/bin/tmax shim) on
`~/Documents/md-journal/link-test.md`:

```
# buffer content at the time:
 1 │links: [Anthropic](https://anthropic.com) and [note](2026-08-08.md)
 3 │plus [[2026-08-08]] wiki
 4 │see [[brand new thought]] dangling

# gx on existing [[2026-08-08]] (cursor L3 C8, keys sent one at a time):
$ herdr pane send-text w2:p3 "g"; sleep 0.9; herdr pane send-text w2:p3 "x"
pane after:
  ▼ │# 2026-08-08
   2 │[[2026-08-15]]
  ▼ │## Things to Work on today
--NORMAL--   2026-08-08.md   L1 C1 [markdown]        ← note opened via gx

# gx on dangling [[brand new thought]] (cursor L4 C7):
pane after:
Follow or create [brand new thought]:        1/5
+ Create: brand new thought
2026-08-08
fresh idea
link-test
wiki-demo
--M-X--      link-test.md     L4 C7            ← SPEC-116 prompt via gx

# Escape → clean cancel back to --NORMAL-- on link-test.md
```
