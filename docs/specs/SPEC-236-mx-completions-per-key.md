# SPEC-236 — M-x completions per-keystroke orchestration

Issue: #236 — completions pipeline ~8.5ms/keystroke (stale figure); profile and cut
Status: landed (ADR-0262)
Date: 2026-11-10

## Goal

Cut the per-keystroke cost of the M-x (minibuffer) completions pipeline. The issue's 8.5ms figure predates #234's parse cache; a fresh same-process profile on current main measures **~1.15ms per keystroke** mid-typing ("cu", 18 visible matches) and materially more at M-x open (empty input → every candidate visible). Cut the waste that remains without changing completion semantics or the serializable-session protocol.

## Fresh profile (bench/editor-harness, started editor, input "cu", 18 matches)

| piece | cost | note |
|---|---|---|
| `minibuffer-set-input` (whole per-key refresh) | 1150µs | the user-visible per-key cost |
| ├ `completion-all-completions` | 508µs | 232µs marginalia bulk-annotate + ~260µs orderless bulk filter + 13µs table dispatch |
| ├ `minibuffer-exact-selection-index` | ~106µs @18 matches | **~6µs per candidate** — recursive T-Lisp walk; ~300 matches at M-x open ⇒ ~1.8ms |
| ├ `minibuffer-state-set` (serialize session+matches) | 124µs | ×2 per keystroke (scroll-reset + replace-session) |
| ├ `minibuffer-state-get` | 30µs | already memoized (BUG-80) |
| ├ `vertico-publish` | 80µs | already bulk (BUG-80) |
| └ session hashmap-sets, clamp/scroll | ~30µs | |

Already landed by earlier issues (do not redo): candidate-build cache keyed on module generation (BUG-78/#182), bulk annotate/filter/rows builtins (BUG-79), state-get memo + bulk rows (BUG-80/#187), parse cache (#234 — which is why 8.5ms is now 1.15ms).

## Design

1. **Annotate memo** (the issue's "stop rebuilding per key", applied to annotations): inside `marginalia-annotate-builtin-candidates`, memoize the annotated list on **(category, level, candidate-list identity)** — last-call single-entry memo. Safe because:
   - The M-x candidate list is session-cached and identity-stable (BUG-78); its metadata is as static as BUG-78 already assumes.
   - Buffer/file tables build **fresh lists every call** (`buffer-completion-table` maps + sorts per dispatch) → identity miss → always re-annotated, never stale.
   - `marginalia-cycle` changes `marginalia-current-level` → level is part of the key → fresh annotate.
   - The annotated candidates are consumed read-only: `orderless-filter-candidates` builds new hashmaps (never mutates inputs), and T-Lisp has no in-place value mutation (#234 verification).
   - Single-entry memo = bounded memory, no leak surface.
2. **Bulk exact-selection**: new builtin `minibuffer-exact-index-bulk (input matches)` — one TS loop comparing each candidate's `"value"` string. `minibuffer-exact-selection-index` dispatches to it; the recursive T-Lisp walk stays as `minibuffer-exact-selection-index-recursive` (exported) — the reference implementation, per the BUG-79 recipe. A parity test locks bulk ≡ reference. Cuts ~6µs/candidate to ~0.1µs (≈1.8ms → ≈30µs at M-x open).
3. **Not done, deliberately**: incremental/incremental-filter caching of the orderless pass. Orderless components are **unordered** (`"b s" ≡ "s b"`), so "input extended ⇒ previous matches narrow" is unsound across component edits and deletes; a correct cache needs per-prefix component-set keys for ~260µs of remaining bulk cost — poor complexity/return. The state-set double-serialize (~124µs ×2) is a serializable-session protocol change (BUG-80 territory) — out of scope.

## Completion criteria

1. `bun run typecheck` green; full `bun run test:unit` green solo; `bun run test:integration` green; CI green on the branch.
2. New tests: bulk-vs-reference parity for exact-selection (match at first/middle/last, no-match, empty input, empty matches); memo behavior — repeated refreshes return correct annotations, `marginalia-cycle` level change re-annotates (no stale), fresh buffer-table lists never hit the memo.
3. Same-process before/after profile: per-key `minibuffer-set-input` mid-typing and the M-x-open (empty-input) refresh both measurably reduced; numbers in the ADR.
4. ADR-0262 + index line, recording the corrected profile (8.5ms → 1.15ms pre-change, attributable to #234) and the not-done rationale.

## Out of scope

Incremental orderless filtering (unsound for unordered components at current cost), state-set serialization protocol (#187/BUG-80 follow-up), vertico render, file/buffer table internals.
