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
  fold, checkbox toggle.
- **Verify-gate retry 1 findings folded in:** inline-vs-wiki clause order is
  unobservable by construction (cursor-scoped at-point predicates; the wiki
  regex cannot match lines containing inner `[t](u)`); the observable
  orderings are pinned — wiki > heading (heading line with `[[link]]`
  follows, doesn't fold), heading fold asserted via `fold-get-ranges`.
- **Latent bug fixed en route:** `markdown-toggle-checkbox` had NEVER worked
  (regex `\\s-` typo for `\\s+`; `\\(...\\)` groups mis-escape in the string
  layer; the flow also dropped the task text). Rewritten groupless with
  substring surgery; note for the codebase: only single-char character
  classes survive this string layer (`[ xX]` silently never matches — use
  split classes), and 4-backslash source escaping is the working convention
  for regex metachars in .tlisp files.
- Live-verified in the mekkapi tab: `[[2026-08-08]]` opens the note;
  `[[brand new thought]]` (dangling) opens the "Follow or create" prompt with
  the `+ Create:` candidate.
- Suite 26/26 (8 SPEC-117 tests), markdown suites green, typecheck clean.
