# ADR-0220: SPEC-117 — `gx` (markdown-do) handles `[[wiki-links]]`

- **Status**: accepted
- **Date**: 2026-08-15
- **Issues**: #192
- **Spec**: [SPEC-117](../specs/SPEC-117-gx-markdown-do-wiki-links.md)

## Context

Wiki-link following existed (SPEC-116) but was M-x-only; inline links already
had `gx`. The split key surface is exactly why the user felt "[[ isn't
working" (the original BUG-76 report). `markdown-do` already IS the
context-aware action at point — it just didn't know about wiki-links.

## Decision

One clause in `markdown-do`'s dispatch
(`src/tlisp/core/commands/markdown/formatting.tlisp`), between the inline-link
check and the heading-fold check:

```elisp
((markdown-wiki-link-at-point)
 (markdown-follow-wiki-link))
```

Precedence pinned by test: **inline link > wiki-link > heading fold**. Both
at-point predicates are cursor-scoped (post-BUG-74/76 they return non-nil only
when the cursor is inside that link), so the order only matters for the
pathological `[[…[t](u)…]]` nesting — deterministic and tested.

## Consequences

- `gx` is the single context key: inline URL, inline file link, wiki-link
  (existing → open; dangling → the SPEC-116 follow-or-create prompt), heading
  fold.
- Live-verified in the mekkapi tab: `[[2026-08-08]]` opens the note;
  `[[brand new thought]]` (dangling) opens the "Follow or create" prompt with
  the `+ Create:` candidate.
- 4 new tests in `test/unit/wiki-link-follow-create.test.ts` (existing-link
  open, dangling prompt, inline-precedence on pathological nesting, heading
  fold regression) — suite 22/22, markdown suites 22/22, typecheck clean.
