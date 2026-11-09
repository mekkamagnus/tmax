# Adopt Bun's grapheme/ANSI-aware width primitives in the render layer

## Status

Accepted (2026-11-10) — resolves #242 / SPEC-242. Child of the bun-v1.4.4-upgrade cluster (#233, landed).

## Context

The render layer measured display width with a hand-rolled model — `char.charCodeAt(0) > 127 ? 2 : 1` — duplicated as private copies in `buffer-lines.ts` and `tab-bar.ts`, with a third variant in `oolong/wrap.ts` (`stripAnsi(text).length`, which **undercounts CJK by 2×**: `中文` measured 2 for 4 display columns, so CJK markdown paragraphs overflowed their width). The model miscounts everything the crude test didn't pin: ZWJ emoji families (6 cols claimed, 2 rendered), combining marks (+2 per mark), narrow non-ASCII (`·`, `→`).

Worse, the parity gate gated nothing: `wide-char-rendering.test.ts` **re-implemented the helpers locally** instead of importing production code, so the swap risk the issue asked for was completely uncovered. And `@types/bun` was still at 1.3.7 — #233 pinned the runtime to 1.4.4 but the types package (`"latest"` in devDeps, locked at 1.3.7) lagged, hiding `Bun.sliceAnsi` from typecheck.

Ground truth was probed on the runtime, not assumed: `Bun.stringWidth` is grapheme-aware (CJK 2, emoji 2, ZWJ sequence 2, combining 0, ANSI escapes 0 by default); `Bun.sliceAnsi(s, startCol, endCol)` slices by **cell columns** but **rounds INTO a wide grapheme at odd boundaries** (`sliceAnsi("中a", 0, 1)` → `"中"`, width 2); `Bun.wrapAnsi` word-wraps ANSI-aware but has **no indent parameter**; `Bun.stringWidth("\t")` is 0 (the crude model said 1).

## Decision

**One shared width model, `src/frontend/render/width.ts`, backed by the Bun built-ins — extracted first, swapped second, gated throughout.**

1. **Sequencing (the issue's caveat, honored literally):** `width.ts` was extracted with the crude logic verbatim and all three consumers pointed at it; the parity test was rewritten to import production and extended. Checkpoint run against crude: **26 pass / 7 fail** — the 7 failures are exactly the grapheme-model pins (ZWJ, combining, narrow, ANSI-blind width, straddle alignment, CJK wrap budget), proving the test now gates production. Then the internals were swapped to Bun: **33/33 pass**.
2. **Primitives:** `stringWidth` = `Bun.stringWidth` (ANSI escapes count 0 — every call site measures display text or pre-styled lines). `sliceToVisualWidth` = `Bun.sliceAnsi` **with a never-overshoot guard** (step `end` back while the slice is wider than requested — Bun rounds into wide graphemes; production's fit-within-width invariant must hold; wide graphemes are ≤2 cells so it's at most one step). `sliceFromVisualOffset` = `Bun.sliceAnsi(text, offset, Infinity)` — grapheme-aligned, a straddling wide char is dropped rather than "half-shown" (an unsplittable cell can't straddle a real viewport edge). `fitToWidth` / `padAnsiToWidth` keep their policies (pad/truncate/`...`), now on the new primitives; `padAnsiToWidth` drops its regex strip. `charWidth` = `Bun.stringWidth(ch)` for the two block-cursor walkers.
3. **`Bun.wrapAnsi` NOT adopted:** oolong needs indent-carrying wrap (Bun has no indent param), and `buffer-lines.ts`'s `wrapLine` is a hard cell-split that must not eat the boundary space the way word-wrap does. Both keep their policies on top of the adopted primitives — the issue's three files stop hand-rolling the width/slice model, which was its point.
4. **Types aligned with the pinned runtime:** `bun update @types/bun` 1.3.7 → 1.4.4 (lockfile updated). This surfaced one stale `@ts-expect-error` in `server-observability.test.ts` (the `test.todo(name)` single-arg form is typed correctly in 1.4.4) — removed.

## Behavior deltas (all pinned by the extended test)

- ZWJ families, combining marks, and narrow non-ASCII now measure correctly (was: overcount 2–3×; padding/ellipsis/truncation positions shift accordingly — toward the terminal's truth).
- Horizontal scroll at an odd offset straddling a wide char drops the char instead of keeping it (rendered columns stay aligned to the viewport math).
- Tab width 1 → 0: **both models miscount real tab stops** (a `\t` advances to the next stop, not 1 or 0 cols); literal tabs reach buffers via indent-tabs-mode (#153). Unchanged-broken, now documented; real tab-stop expansion is a separate concern (SPEC-242 "Out of scope").
- oolong CJK wrap no longer overflows (the undercount fix).
- `sliceAnsi` re-synthesizes ANSI state on its output; every current `sliceToVisualWidth` call site slices raw (unstyled) text, so no styled-output change.

## Consequences

- The render layer has ONE width model instead of three divergent private ones; the parity test imports it (`33 tests`, extended from 24), so future drift is gated.
- `@types/bun` matches the pinned runtime — future Bun built-ins won't be typecheck-invisible.
- The block-cursor walkers remain index-based cursor-split logic (unchanged structure) on the shared `charWidth`.
- Gates: `bun run typecheck` (4 projects) ✅ after the types alignment; crude checkpoint **26 pass / 7 fail** (documented above — the failing 7 are the grapheme pins the crude model gets wrong, which is why the swap happens); post-swap `wide-char-rendering.test.ts` **33/33** ✅ (51 expects); render-adjacent suites (capture-frame, minibuffer-renderer, oolong, markdown-table-align) **67/67** ✅; full `bun run test:unit` solo and `bun run test:integration` solo results cited in the issue close comment; CI green on `issue-242`. The cluster's codex review lives on parent issue #233.
