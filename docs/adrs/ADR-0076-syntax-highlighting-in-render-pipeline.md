# Syntax Highlighting in Render Pipeline

## Status

Accepted

## Context

The syntax highlighting pipeline (tokenizer → highlighter) existed but wasn't wired into the render loop. The tokenizer produced `SyntaxToken` arrays and the highlighter converted them to `HighlightSpan[][]`, but `renderBufferLines()` never received highlight spans. Buffer text rendered without colors while the mode indicator and status line had color — a visible gap.

## Decision

Create a bridge module `src/syntax/highlight-buffer.ts` with `computeHighlightSpans(getLine, startLine, endLine, filename)` that:

1. Auto-detects language from filename extension (`.tlisp` → tlisp, `.ts` → typescript, `.py` → python)
2. Tokenizes visible lines with stateful parsing (passes `nextState` between lines for multi-line constructs)
3. Produces `HighlightSpan[][]` for the visible viewport

Wire this into both frontends (Steep, TUI client) and `captureFrame()`:

```typescript
const spans = computeHighlightSpans(getLine, vt, vt + bufferHeight, state.currentFilename);
const lines = renderBufferLines(state, width, bufferHeight, spans);
```

The `tokenize()` function has a dual return type: returns `SyntaxToken[]` when no state is passed, `TokenizeResult` (with `.tokens` and `.nextState`) when state is passed. Consumers must check `Array.isArray(result)` before accessing `.tokens`.

## Consequences

- Syntax colors now reach the terminal for all supported languages (T-Lisp, TypeScript, Python).
- The highlight pipeline is tested end-to-end: `test/unit/render-visual.test.ts` asserts exact ANSI color codes for each token type.
- Adding a new language requires only a tokenizer rule set — no render changes needed.
- The `computeHighlightSpans` function is called on every render, so highlighting stays in sync with buffer edits.
