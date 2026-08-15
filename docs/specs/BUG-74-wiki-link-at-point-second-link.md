# Bug: `markdown-wiki-link-at-point` fails on any line with a preceding link

## Goals

- `[[link]]` detection works for EVERY link on a line, not just the first — following, navigation, and the follow-or-create prompt (SPEC-116) all depend on it.

## Completion Criteria (Definition of Done)

- [ ] On a line with two links (`see [[one]] and [[two]] here`), cursor inside the SECOND link → `(markdown-wiki-link-at-point)` returns `"two"`.
- [ ] Same for the third-and-later links on a line.
- [ ] `markdown-wiki-link-range-at-point` returns the correct ABSOLUTE `(line start-col end-col)` for second-and-later links (it already tracks offset — verify).
- [ ] Unit test with 2+ links on one line covering cursor positions on each.
- [ ] `bun run typecheck` + the markdown regression suites stay green.

## Bug Description

Discovered live (2026-08-15, driving the mekkapi-tab demo of SPEC-116): with
cursor at an absolute column inside the second `[[fresh idea]]` link on the
line `demo of [[2026-08-08]] (typo) and [[fresh idea]] (dangling)`,
`(markdown-wiki-link-at-point)` returned **nil** — while `]l`
(`markdown-next-wiki-link`, scan-based, offset-correct) landed the cursor
correctly at C37.

## Root Cause (verified during the demo)

`src/tlisp/core/commands/markdown/knowledge.tlisp` — `markdown-wiki-link-at-point`:

```elisp
(while (and (string-match "\\\\[\\\\[\([^\\\\]]+\)\\\\]\\\\]" search-text) (not result))
  (let ((start (match-beginning 0)) ...
    (if (and (>= col start) (<= col end)) ...
```

When the cursor is on a LATER link, the loop has already advanced
`search-text` past earlier matches (`(substring search-text (match-end 0))`),
but `match-beginning 0` / `match-end 0` are **relative to the truncated
search-text**, while `col` is the **absolute** cursor column. For the 2nd link
the check compares e.g. absolute col 37 against relative 0–13 → always nil.
(The mirror function `markdown-wiki-link-range-at-point` added in SPEC-116
already tracks a cumulative `offset` — `at-point` predates it and does not.)

## Solution Statement

Track a cumulative `offset` (add `(match-end 0)` each advance, exactly like
`markdown-wiki-link-range-at-point`) and compare `col` against
`(+ offset (match-beginning 0))` / `(+ offset (match-end 0))`.

## Relevant Files

- `src/tlisp/core/commands/markdown/knowledge.tlisp` — `markdown-wiki-link-at-point` (~line 150).
- `test/unit/wiki-link-follow-create.test.ts` — add the multi-link-per-line regression.

## Severity

medium — silently breaks following (and SPEC-116's prompt) for every
non-first link on a line; common in real notes.
