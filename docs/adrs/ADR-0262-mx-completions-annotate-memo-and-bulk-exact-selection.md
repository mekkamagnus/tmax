# Memoize M-x marginalia annotation and bulk-scan exact selection

## Status

Accepted (2026-11-10) — resolves #236 / SPEC-236. Child of the bun-v1.4.4-upgrade cluster (#233, landed).

## Context

The issue carried a stale figure: "completions pipeline ~8.5ms/keystroke". A fresh same-process profile on post-#234 main measured the per-keystroke cost at **~1.15ms** mid-typing — the parse cache (#234/ADR-0261) had already absorbed the bulk of the 8.5ms. Two line items dominated what remained:

- **Marginalia annotation, ~232µs/keystroke.** `marginalia-annotate-builtin-candidates` (the BUG-79 bulk port) rebuilt the annotated candidate snapshot on every keystroke — but the M-x candidate list is session-cached and **identity-stable** (BUG-78/#182), so every rebuild was byte-identical to the last.
- **Exact selection, ~6µs per candidate.** `minibuffer-exact-selection-index` was a recursive T-Lisp walk — one interpreter round-trip per candidate. Mid-typing ("cu" → 18 filtered matches) that cost ~106µs; at M-x open (empty input, 234 matches all visible) ~1.07ms, paid on the very first paint.

## Decision

**Two surgical cuts; the completions semantics, the orderless filter, and the serializable-session protocol are untouched.**

1. **Single-entry memo in `marginalia-annotate-builtin-candidates`** keyed on **(category, level, candidate-list identity)** — the list *object*, not its content.
   - M-x hot path: the BUG-78 cache hands back the same list object every keystroke → memo hit → the identical annotated snapshot returns in ~14µs.
   - Buffer/file tables build a **fresh list per call** (`buffer-completion-table` maps + sorts per dispatch) → identity always misses → they always re-annotate. An identity-blind memo would replay stale annotations onto fresh lists; keying on the object reference makes staleness structurally impossible.
   - `marginalia-cycle` changes `marginalia-current-level` → level is in the key → level change re-annotates.
   - Single entry = bounded memory (no candidate list pinned longer than one call's successor), no LRU needed: the completion pipeline annotates at most one table per refresh.
   - Safe to share the snapshot: T-Lisp has no in-place value mutation (#234 verification), and downstream consumers (`orderless-filter-candidates`) copy rather than mutate.
2. **`minibuffer-exact-index-bulk` builtin** — one TS loop comparing each candidate's `"value"` string to the input; returns the index or −1. `minibuffer-exact-selection-index` (now `(input matches)`) dispatches to it; the recursive walk stays as the exported `minibuffer-exact-selection-index-recursive` — the reference implementation and semantic spec, per the BUG-79 bulk-builtin recipe.
3. **Deliberately not done**: incremental caching of the orderless pass. Orderless components are unordered (`"b s" ≡ "s b"`), so "input extended ⇒ previous matches narrow" is unsound across component edits/deletes, and a correct scheme (per-prefix component-set keys) buys ~260µs — poor complexity-to-return. The state-set double-serialize (~124µs ×2/keystroke) is a serializable-session protocol change (BUG-80 territory), out of scope.

Pinned by `test/unit/minibuffer-exact-selection-and-annotate-memo.test.ts` (10 tests): bulk ≡ recursive reference (match at first/middle/last, no-match, empty input, empty matches), memo hit proven by **object identity** (`toBe` on the returned T-Lisp value — same snapshot, not a rebuild), level change re-annotates with the shorter form and returning to level 0 is still correct, fresh lists never hit the memo (annotations follow the new list's content), and an end-to-end completing-read → set-input session keeps filtering, annotation, and exact-selection correct for both a prefix input (−1) and a typed-to-exact input (0). The memo-hit assertion is mutation-proven: replacing the memo return with a rebuild makes exactly that test fail.

## Benchmark evidence

Same-process interleaved A/B (the recursive reference and fresh-list annotate calls run *in the same editor instance* as the new paths, alternating rounds, min-of-4; host load ~12):

| piece | old path | new path |
|---|---|---|
| exact-selection, 234 candidates (M-x open) | 1066.9µs | **29.7µs** (~36×) |
| exact-selection, "cu" | 1073.6µs | **26.2µs** |
| marginalia annotate, 234 candidates | 237.3µs (fresh list) | **14.1µs** (memo hit) |

End-to-end on the new code: `minibuffer-set-input "cu"` full per-key refresh **1150µs → 600µs** (−48%); M-x-open refresh (`set-input ""`) 3355µs, of which exact-selection is now 30µs and annotate 14µs (old-path derived: ≈4.6ms — the A/B deltas added back). Typing "cursor" end-to-end: 7.8ms/session ≈ 1307µs/keystroke (dominated by the unchanged orderless filter + double state-set serialize — the documented not-done items).

## Consequences

- Per-keystroke M-x cost halves; M-x-open's exact-selection scan drops from ~1.07ms to ~30µs.
- The annotation memo is safe by construction (identity key), but any future change that makes a completion table mutate a shared candidate list in place would violate its premise — the memo tests plus the completions suite are the tripwire.
- `minibuffer-exact-selection-index` lost its third (`index`) parameter — callers were module-internal plus the one refresh call site, both updated; the recursive reference keeps the 3-arg shape.
- Remaining per-key cost (~600µs) is: orderless filter (~260µs), state-set ×2 (~250µs), vertico-publish (~80µs) — each already has a documented owner (BUG-80 protocol, not-done rationale).
- Gates: `bun run typecheck` (4 projects) ✅; new `minibuffer-exact-selection-and-annotate-memo.test.ts` 10/10 ✅ (22 expects; memo-hit test mutation-proven as above); full `bun run test:unit` solo ✅ — **55/55 batches passed, 0 fail, exit 0**; `bun run test:integration` solo ✅ — **82/82 pass, 0 fail** (11.82s); CI green on `issue-236` (run cited in the issue close comment). The cluster's codex review lives on parent issue #233.
