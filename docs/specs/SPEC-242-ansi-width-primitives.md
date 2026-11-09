# SPEC-242 — Adopt Bun's ANSI-aware width/slice primitives

Issue: #242 — replace hand-rolled ANSI width/slice/wrap with `Bun.stringWidth` / `Bun.sliceAnsi`
Status: landed (ADR-0263)
Date: 2026-11-10

## Goal

Replace the hand-rolled width model (`charCode > 127 ? 2 : 1`) in the render layer with Bun 1.4's grapheme/ANSI-aware built-ins, per the issue's file list: `src/frontend/render/buffer-lines.ts`, `src/frontend/render/tab-bar.ts`, `src/steep/oolong/wrap.ts`. The dependency is the runtime (zero-dependency philosophy holds — #233 pinned Bun 1.4.4).

**Fix the gate first (issue caveat):** `test/unit/wide-char-rendering.test.ts` currently re-implements the helpers locally and gates nothing about production. Extract the production helpers into one shared module, point the test at it, extend coverage, THEN swap the internals.

## Ground truth (probed on Bun 1.4.4, this repo)

- `Bun.stringWidth(s)`: grapheme-aware — CJK 2, emoji 2, **ZWJ sequence 2** (crude said 6), **combining mark adds 0** (crude said +2 per mark), narrow `·`/`→` 1 (crude said 2). Default **does not count ANSI escapes** (`{countAnsiEscapeCodes:false}`).
- `Bun.sliceAnsi(s, startCol, endCol)`: slices by **cell columns** (matches `sliceToVisualWidth`), clamps out-of-range, re-synthesizes active ANSI state on the output. **Rounds INTO a wide grapheme at odd boundaries** — `sliceAnsi("中a", 0, 1)` → `"中"` (width 2 > 1): production's never-overshoot invariant needs a guard.
- `Bun.wrapAnsi(text, width[, {hard}])`: word wrap, ANSI-aware; **no indent parameter** — oolong's indent-carrying policy cannot delegate to it.
- `Bun.stringWidth("\t")` = 0 (crude said 1). Literal tabs reach buffers (indent-tabs-mode, #153) — see Out of scope.

## Design

1. **New shared module `src/frontend/render/width.ts`** — the ONE width model for the render layer (today `buffer-lines.ts` and `tab-bar.ts` carry duplicate private copies):
   - `stringWidth(s)` = `Bun.stringWidth(s)`.
   - `sliceToVisualWidth(text, maxCols)` = `Bun.sliceAnsi` with a never-overshoot guard (step `end` back while the slice is wider than `maxCols` — at most one step, wide graphemes are ≤2 cells).
   - `sliceFromVisualOffset(text, offset)` = `Bun.sliceAnsi(text, offset, Infinity)` — grapheme-aligned: a wide char straddling the offset is dropped, never split (the crude model kept it, which "half-showed" an unsplittable cell).
   - `fitToWidth` — unchanged pad/truncate/`...` policy, composed on the new primitives.
   - `padAnsiToWidth` — unchanged policy; drops its regex strip (width is already ANSI-blind).
   - `charWidth(ch)` = `Bun.stringWidth(ch)` — kept for the two block-cursor walkers.
2. **`buffer-lines.ts`**: delete the six local helpers; import from `width.ts`. The block-cursor walkers keep their structure (cursor-split logic, not width policy) but call the shared `charWidth`.
3. **`tab-bar.ts`**: delete its three local helpers; import `stringWidth` + `sliceToVisualWidth` (the `…` truncation policy is unchanged).
4. **`oolong/wrap.ts`**: `visualWidth` (was `stripAnsi(text).length` — **undercounts CJK by 2×**: `中文` measured 2, displays 4, so CJK paragraphs overflowed their width) → shared `stringWidth`. Keep the word-wrap + indent policy loop (Bun's `wrapAnsi` has no indent parameter). Drop the now-unused `stripAnsi` import.
5. **Bun's `wrapAnsi` is NOT adopted**: oolong needs indent-carrying wrap; `buffer-lines.ts`'s `wrapLine` is a hard cell-split (must not eat the space at a boundary the way word-wrap does). Both keep their policies on top of the adopted primitives — the issue's file list is satisfied: those files stop hand-rolling the width/slice model.

## Sequencing (per the issue: extend the gate FIRST, then swap)

1. Extract `width.ts` with the CURRENT crude logic verbatim; rewrite `wide-char-rendering.test.ts` to import production; extend with cases stable under both models (CJK=2, emoji=2, mixed, padding, ellipsis, ANSI passthrough, tab-bar truncation). Run → GREEN against crude (proves the test now gates production).
2. Swap `width.ts` internals to the Bun primitives; add the grapheme-model cases (ZWJ=2, combining adds 0, narrow=1, ANSI-blind width, never-overshoot slice, grapheme-aligned `sliceFromVisualOffset`, oolong CJK budget). Run → GREEN (proves the swap is gated).

## Completion criteria

1. `bun run typecheck` green; full `bun run test:unit` green solo; `bun run test:integration` green; CI green on the branch.
2. `wide-char-rendering.test.ts` exercises the PRODUCTION `width.ts` (no local re-implementations) and pins: CJK 2, emoji 2, ZWJ-family 2, combining +0, narrow non-ASCII 1, ANSI escapes width-0, `padAnsiToWidth` pads by visible width, `sliceToVisualWidth` never overshoots at odd wide boundaries, `sliceFromVisualOffset` is grapheme-aligned, `fitToWidth` CJK ellipsis, tab-bar CJK `…` truncation, oolong wrap keeps CJK within width.
3. Both sequencing runs (pre-swap crude green, post-swap Bun green) recorded in the ADR.
4. ADR-0263 + index line, documenting the behavior deltas (grapheme-correct widths; straddle-drop in horizontal scroll; tab width 1→0 — both models miscount real tab stops) and the deliberate non-adoption of `Bun.wrapAnsi`.

## Out of scope

Real tab-stop expansion (both models miscount `\t`; rendering alignment with tabs in buffers is unchanged-broken, now documented), `matcha.ts`'s `stripAnsi` (Bun.stripANSI exists; separate cleanup), T-Lisp-side width models (markdown-align-table has its own, already CJK-correct), `Bun.wrapAnsi` adoption (no indent param; wrong semantics for hard wrap).
