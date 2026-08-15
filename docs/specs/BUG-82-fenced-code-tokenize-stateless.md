# Bug: fenced code blocks never produce code-block spans — tokenizer runs stateless (leaks SPEC-119's display transform into fences)

## Goals

- Content inside ``` fences renders as code (never transformed by display
  features like SPEC-119's wiki-link rendering) and carries the code-block face.

## Completion Criteria (Definition of Done)

- [ ] Root cause fixed: `computeHighlightSpans` (src/syntax/highlight-buffer.ts)
      passes `state ?? undefined` to `tokenize`, so the stateful ParseState
      path never engages — `inCodeFence` is never set and fence interiors get
      no code-block spans. Every caller (captureFrame, tui-client,
      getCursorScreenOffset) currently re-tokenizes per line WITH a shared
      state var, but the `?? undefined` on the FIRST line's undefined state
      discards it... investigate the exact mechanics and fix.
- [ ] Live e2e: a ``` fence containing `[[wiki-link]]` renders with brackets
      intact and the code-block face (both with SPEC-119 on and off).
- [ ] Unit regression: multi-line buffer with a fence — interior lines get
      code-block spans; SPEC-119's transform skips them.
- [ ] `bun run typecheck` + syntax suites green.

## Known facts (gate-verified 2026-08-15, discovered during #194 verify-gate)

- Live probe (worktree): `[[goals]] tail` inside a ``` fence rendered as
  `goals tail` with the dangling-dim face — the SPEC-119 display transform
  leaked into the fence. Root cause is PRE-EXISTING in src/syntax/ (untouched
  by SPEC-119): neither the span-identity code check (no code-block span is
  ever emitted for interiors) nor the backtick text scan (interior fence lines
  have no backticks) can protect.
- Inline code spans ARE protected (backtick scan, SPEC-119 retry-1).

## Relevant Files

- `src/syntax/highlight-buffer.ts` — `computeHighlightSpans` state plumbing.
- `src/syntax/tokenizer.ts` — `inCodeFence` / stateful return form.
- `src/frontend/render/wiki-display.ts` — the consumer whose protection fails.

## Severity

medium — fences are common in markdown journals; silently transforming their
content corrupts the code-as-written display (buffer text itself is safe).
