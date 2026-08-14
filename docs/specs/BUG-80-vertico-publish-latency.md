# Bug: vertico-publish costs ~9ms per M-x keystroke (per-row T-Lisp churn)

## Bug Description

After the module-export-cache fix (BUG-79/#186, `7d782d8`), an M-x keystroke
costs ~17ms end-to-end. **~9ms of that is `vertico-publish`** — building the
visible-rows render view — which runs on every keystroke in any minibuffer
(M-x, find-file, buffer switch, describe-*).

Measured (idle machine, real 146-candidate M-x session):

| Piece | Cost |
|-------|------|
| `vertico-publish` total | ~9.0–9.5ms |
| `vertico-row` × 1 (via T-Lisp) | 3.10ms |
| all 8 visible rows (mapcar) | 5.86ms |
| `stable-sort "vertico-span-less-p"` × 1 | 2.85ms |
| `list-slice` of matches | 4.16ms (incl. exec overhead) |

**Expected:** publishing ≤8 rows of text segments should be sub-millisecond.
**Actual:** ~9ms — per-row `stable-sort` dispatched by STRING-NAME predicate
(each comparison re-resolves the function name) plus recursive
`segments-from-spans` list-building, all as interpreter round-trips.

## Root Cause Analysis

Same disease as the orderless/marginalia fixes (`42dd0ea`): `vertico-publish`
drives per-row T-Lisp functions (`vertico-row` → `vertico-candidate-segments`
→ `stable-sort` by name + recursive span-to-segment walking) through `mapcar`,
each an interpreter round-trip with name resolution and hashmap churn. For
8 visible rows × (sort + segments) this is ~50+ evals per keystroke.

## Solution Statement

**Landed (three parts):**

1. **`vertico-rows-bulk` builtin** — builds all visible rows' segment lists in
   TS (display spans → candidate/completion-match segments; annotation spans →
   annotation segments; the two-space annotation separator; TS span sorting —
   no name-dispatched predicate). A faithful port of
   `vertico-segments-from-spans` / `-annotation-segments-from-spans` /
   `vertico-candidate-segments` / `vertico-row`, which stay as the reference
   implementation; `vertico-publish` delegates its rows mapcar to the builtin.
2. **`minibuffer-state-get` identity-memoized** (folded in: profiling showed it
   was the next dominant cost, ~1.7ms × ~4 calls/keystroke) — the deep
   deserialize of the whole session (all matched candidates) ran on every
   call. Sound because `SetMinibufferState` replaces the serialized object
   wholesale, so object identity is a valid cache key.
3. Fixture test pinning segment faces/ordering/separator + byte-parity with
   the T-Lisp reference.

## Measured outcome (idle machine, live M-x session)

| Metric | Before | After |
|---|---|---|
| `vertico-publish` | ~9.4ms | **0.70ms** (target <1.5 — met, 13×) |
| `minibuffer-state-get` | ~1.74ms | 0.01ms |
| M-x keystroke end-to-end | ~17ms | **~13–14ms** |

**The <8ms M-x target is NOT met and is not achievable within this issue's
scope**: the remaining keystroke cost decomposes as the per-key baseline
(~3ms, the fixed BUG-79/#186 floor) + `completion-all-completions` (~8.5ms —
table dispatch 3ms + marginalia 4.3ms + orderless 6.4ms measured separately;
the pipeline's orchestration overlaps them). Driving those three sub-pieces
into the same bulk shape is a further iteration on the minibuffer pipeline,
not the vertico row-builder. (The user-facing picture is already: ~250ms →
~13ms over three fixes.)

## Steps to Reproduce

1. Open M-x (`SPC ;`), type a character.
2. Profile `(vertico-publish)` × N in a live session → ~9ms/call.

## Relevant Files

- `src/tlisp/core/completion/vertico.tlisp` — `vertico-publish`, `vertico-row`, `vertico-candidate-segments`, `vertico-segments-from-spans`, `vertico-annotation-segments-from-spans`, `vertico-span-less-p`.
- `src/tlisp/stdlib.ts` — the bulk builtin (beside `orderless-filter-candidates` / `marginalia-annotate-builtin-candidates`).

## Acceptance Criteria (Completion)
- [x] `vertico-rows-bulk` builtin ports the segment logic; T-Lisp per-row functions remain as reference.
- [x] `vertico-publish` uses the bulk path; output shape identical (segments/faces/selected flag) — byte-parity test.
- [x] `vertico-publish` < 1.5ms per call in a live M-x session (0.70ms).
- [ ] M-x keystroke < 8ms end-to-end (in-process) — **NOT met: ~13ms; the remainder is the per-key baseline (~3ms) + the completions pipeline (~8.5ms), outside this issue scope (see Solution Statement). Needs a retarget or a follow-up issue.**
- [x] Regression: vertico/marginalia/minibuffer-renderer/completion suites green (44/44 + 4/4).

## Validation Commands
- `bun run typecheck`
- `bun test test/unit/vertico-marginalia-tlisp.test.ts test/unit/minibuffer-renderer.test.ts test/unit/orderless-bulk-filter.test.ts`
- Profile `(vertico-publish)` before/after.

## Notes
- Third application of the bulk-pattern (orderless → marginalia → vertico).
  After this, the per-keystroke M-x path is: handleKey ~3ms + completions
  ~8.5ms → likely improvable further via the same pattern inside
  completion-all-completions orchestration, but that's below one frame and out
  of scope here.
