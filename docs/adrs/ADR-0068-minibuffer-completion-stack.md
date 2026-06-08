# ADR 0003: Minibuffer Completion Stack — Layout Flip and Style Fallback

**Date**: 2026-06-07
**Status**: Accepted

## Context

The tmax minibuffer completion stack (Vertico + Orderless + Marginalia) was functional but diverged from the Emacs Vertico reference in two ways:

1. **Layout direction**: The renderer placed the prompt at the bottom of the minibuffer with candidates stacked above it. Emacs Vertico places the prompt at the top with candidates flowing downward — this is the standard users expect.

2. **No completion fallback**: When orderless (space-separated multi-token matching) returned zero results, the minibuffer showed "No match". Emacs completion-styles fall through a chain (e.g. orderless → basic → partial-completion) so candidates are always found when a reasonable prefix exists.

3. **No file-specific style**: File completion used orderless, which is designed for natural-language-style queries. File paths benefit more from prefix matching and partial completion (e.g. `~/D/p/t` matching `~/Documents/projects/tmax`).

4. **No annotation cycling**: Marginalia annotations were fixed at one detail level. Emacs marginalia supports cycling through annotation depths via a keybinding.

These changes were specified in `specs/SPEC-011-minibuffer-completion.html`, Phase 1 (layout flip) and Phase 2 (small gaps).

## Decision

### 1. Layout flip — prompt at top, candidates downward

Changed `src/frontend/render/minibuffer.ts` to build the prompt line first (index 0), then append candidate rows after it. Previously candidates came first and the prompt was appended last. The cursor row changed from `rows.length - 1` to `0`.

No T-Lisp changes — the `MinibufferRenderView` shape is unchanged; only the TypeScript renderer reorders output lines.

### 2. Completion style fallback chain

Changed the default `completion-styles` in `src/tlisp/core/completion/completion.tlisp` from `(list "orderless")` to `(list "orderless" "basic")`. Modified `completion-apply-styles` to try the first style, and if it produces zero results while more styles remain, fall through to the next.

Added `src/tlisp/core/completion/basic.tlisp`: a `basic-filter` function that performs case-insensitive prefix matching against candidate display text. Registered as the "basic" style.

### 3. File category style override

Added `src/tlisp/core/completion/partial-completion.tlisp`: a `partial-completion-filter` function that splits input on `/` and matches each segment as a prefix against corresponding path segments. Registered as the "partial-completion" style.

Added `(completion-set-category-styles "file" (list "basic" "partial-completion"))` to `src/tlisp/core/completion/file-table.tlisp` so file completion bypasses orderless entirely.

### 4. Marginalia annotation cycling

Modified `src/tlisp/core/completion/marginalia.tlisp`: added `marginalia-current-level` defvar (0–2) and `marginalia-cycle` function that increments the level mod 3 and calls `minibuffer-refresh`. Made buffer and command annotators level-aware.

Added `((string= key "M-A") (marginalia-cycle))` to `minibuffer-dispatch-key` in `src/tlisp/core/completion/minibuffer.tlisp`.

Added `(require-module editor/completion/basic)` and `(require-module editor/completion/partial-completion)` to `src/tlisp/core/bindings/normal.tlisp` for module loading.

## Consequences

### Positive

- Minibuffer layout matches Emacs Vertico convention — prompt at top is what users expect
- Fallback chain eliminates "No match" dead-ends for valid prefixes
- File completion gets path-appropriate matching (partial-completion for abbreviated paths)
- Marginalia cycling lets users control annotation verbosity without configuration
- All completion logic stays in T-Lisp; TypeScript changes are limited to the renderer

### Negative

- Fallback chain tries two styles sequentially on zero-result first-style — minor latency increase when orderless misses (negligible for current candidate counts)
- `partial-completion-matches-p` does recursive segment matching — could be slow on very large file directories, though no worse than Emacs behavior

### Neutral

- Renderer test (`test/unit/minibuffer-renderer.test.ts`) was rewritten to assert prompt at `lines[0]` and cursor at row 0 — existing tests that assumed bottom-prompt layout no longer apply
- The style override system (`completion-set-category-styles`) is open for future categories to add their own style chains
