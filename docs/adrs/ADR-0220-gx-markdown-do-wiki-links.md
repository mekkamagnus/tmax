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

Precedence: **inline link > wiki-link > heading fold** by clause order. As
the Consequences section details, inline-vs-wiki order is in fact
UNOBSERVABLE (cursor-scoped predicates; the wiki regex cannot match lines
containing an inner `[t](u)`), so the observable orderings — wiki > heading,
heading-fold, checkbox — are what the tests pin.

## Consequences

- `gx` is the single context key: inline URL, inline file link, wiki-link
  (existing → open; dangling → the SPEC-116 follow-or-create prompt), heading
  fold, checkbox toggle.
- **Verify-gate retry 1 findings folded in:** inline-vs-wiki clause order is
  unobservable by construction (cursor-scoped at-point predicates; the wiki
  regex cannot match lines containing inner `[t](u)`); the observable
  orderings are pinned — wiki > heading (heading line with `[[link]]`
  follows, doesn't fold), heading fold asserted via `fold-get-ranges`.
- **Latent bug fixed en route:** `markdown-toggle-checkbox` had NEVER worked.
  Root cause (gate-corrected): a `\\s-` typo where `\\s+` was meant (the sole
  matching defect — 2-backslash capture groups work fine, as knowledge.tlisp's
  own wiki regex demonstrates) plus a delete-line+insert flow that dropped the
  task text after the marker. Rewritten groupless with substring surgery.
  Empirical string-layer note: a multi-char class DIRECTLY inside escaped
  brackets (`\\[ xX\\]`) silently never matches, while `\\[ \\]` and
  `\\[x\\]` do — split single-char-class patterns are the safe form.
- Live-verified in the mekkapi tab: `[[2026-08-08]]` opens the note;
  `[[brand new thought]]` (dangling) opens the "Follow or create" prompt with
  the `+ Create:` candidate.
- Suite 26/26 (8 SPEC-117 tests), markdown suites green, typecheck clean.
