# Bug: fenced code blocks never produce code-block spans — tokenizer runs stateless (leaks SPEC-119's display transform into fences)

## Goals

- Content inside ``` fences renders as code (never transformed by display
  features like SPEC-119's wiki-link rendering) and carries the code-block face.

## Completion Criteria (Definition of Done)

- [x] Root cause fixed: `computeHighlightSpans` (src/syntax/highlight-buffer.ts)
      passes `state ?? undefined` to `tokenize`, so the stateful ParseState
      path never engages — `inCodeFence` is never set and fence interiors get
      no code-block spans. Every caller (captureFrame, tui-client,
      getCursorScreenOffset) currently re-tokenizes per line WITH a shared
      state var, but the `?? undefined` on the FIRST line's undefined state
      discards it... investigate the exact mechanics and fix.
- [x] Live e2e: a ``` fence containing `[[wiki-link]]` renders with brackets
      intact and the code-block face (both with SPEC-119 on and off).
- [x] Unit regression: multi-line buffer with a fence — interior lines get
      code-block spans; SPEC-119's transform skips them.
- [x] `bun run typecheck` + syntax suites green.

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


## Resolution (2026-08-21, #196)

**Root cause — confirmed and simpler than suspected.** `tokenize` takes the
STATELESS branch whenever no `ParseState` is passed and returns plain tokens
(src/syntax/tokenizer.ts:47). `computeHighlightSpans` only assigned `state`
from the stateful return form — which only occurs when a state was already
passed in. Line 1 had none, so no line ever took the stateful path: a
bootstrap chicken-and-egg. (`state ?? undefined` was a no-op on an already-
optional value.)

**Fix** (src/syntax/highlight-buffer.ts): construct `new ParseState()` up
front and pass it on every line; prime [0, startLine) before the window —
callers pass viewport windows, so a fence opened above the window still
applies. Warm-up is O(startLine), output-discarding; per-revision state
caching is the RFC-019 follow-up.

**Blast radius:** the fix activates ALL ParseState transitions, not just
fences (c-style/lisp block comments, python triple-strings) — all were
silenced by the same bootstrap bug. Observed out-of-scope gap: an UNCLOSED
`/*` opener still yields no tokens (the TS rule set emits no token for a bare
opener, so `cStyleTransitions.checkBlockComment` never fires) — a language-
rule gap separate from this bootstrap fix, recorded here for the record.

**Unit regressions:** test/unit/syntax/bug82-fenced-code-state.test.ts —
fence interiors get code-block spans (theme #abb2bf + dim); viewport window
below a fence sees fence state via warm-up; `~~~` fences; SPEC-119 transform
skips fenced `[[wiki-links]]` (brackets intact) and still applies outside
fences.

**Live e2e (tmux, embedded Steep, ANSI capture):** SPEC-119 ON — fence
interior renders `[[goals]] tail` with dim + `38;2;171;178;191` (code-block
face), brackets intact, while prose `[[goals]]` transforms (brackets
stripped, link-colored). SPEC-119 OFF (init.tlisp
`(global-wiki-link-display-mode 0)`) — brackets intact everywhere, fence
face unchanged.

**Verification:** typecheck all projects exit 0. Exactly what ran, green:
test/unit/syntax/ (296 tests) + markdown-tokenizer + wiki-link-faces (42) +
the span-consumer suites (steep/, capture-frame, frontend-input,
minibuffer-renderer, editor*, daemon-capture-parity - 363) + 5/5 new
regressions in bug82-fenced-code-state.test.ts. The full `bun run
test:unit` sweep is blocked by a PRE-EXISTING failure unrelated to this fix
(markdown-module-boundaries AC11.2 - attribution verified by stashing this
fix and re-running; fails identically; filed as #227).
