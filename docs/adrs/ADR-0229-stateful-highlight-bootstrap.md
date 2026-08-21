# Stateful syntax highlighting must be bootstrapped, not optional

## Status

Accepted (2026-08-21, #196 / [BUG-82](../specs/BUG-82-fenced-code-tokenize-stateless.md))

## Context

`tokenize` has two return shapes: plain tokens when called without a
`ParseState`, and `{ tokens, nextState }` when called with one. The
multi-line constructs (markdown code fences, c-style/lisp block comments,
python triple-quoted strings) only work through the stateful form.
`computeHighlightSpans` threaded state by assigning it from the stateful
return — but line 1 has no state, so it called the stateless form, which
returns an array and discards the internal state. The stateful path could
never engage: fenced code blocks produced no code-block spans, and SPEC-119's
wiki-link display transform (which protects code by span identity) leaked
into fences.

## Decision

`computeHighlightSpans` always constructs a `ParseState` and always passes it
to `tokenize` — the stateless convenience form is for callers that genuinely
want one-shot, context-free tokenization, not for a streaming loop. Because
callers render viewport windows (not whole buffers), the state is PRIMED by
tokenizing [0, startLine) and discarding output before emitting spans for the
window: a fence opened above the viewport still applies to the lines rendered.

## Consequences

- Fenced code blocks (backtick and tilde delimiters) get code-block spans;
  display transforms that protect on code-span identity work as designed.
- All ParseState transitions activate — block comments and triple-quoted
  strings also recover wherever the language rules emit the engaging tokens.
- Priming costs O(startLine) per call. Acceptable at current buffer sizes;
  per-revision state caching is the RFC-019 follow-up, not this decision.
- Known residual gap (recorded in the spec): an unclosed `/*` opener emits no
  token in the TS rule set, so c-style block-comment transitions still cannot
  engage on the opener line itself — a language-rule issue, independent of
  this bootstrap fix.
