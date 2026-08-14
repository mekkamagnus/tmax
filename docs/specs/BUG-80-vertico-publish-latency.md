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

One bulk builtin — `vertico-rows-bulk (candidates selected-value)` — that
builds all visible rows' segment lists in TS (display spans → candidate /
completion-match segments; annotation spans → annotation segments), a faithful
port of `vertico-segments-from-spans` / `vertico-annotation-segments-from-spans`
/ `vertico-candidate-segments` / `vertico-row`. The T-Lisp functions stay as
the reference implementation; `vertico-publish` (or `vertico-row`'s mapcar)
delegates to the builtin. Span sorting happens in TS (no name-dispatched
predicate).

Also measure after: `minibuffer-refresh-after-input` (~24ms measured once —
re-measure cleanly; it embeds completions + publish, both being fixed) and the
remaining `handleKey` mx-path overhead. Target: **M-x keystroke < 8ms** (under
one frame even accounting for daemon round-trip).

## Steps to Reproduce

1. Open M-x (`SPC ;`), type a character.
2. Profile `(vertico-publish)` × N in a live session → ~9ms/call.

## Relevant Files

- `src/tlisp/core/completion/vertico.tlisp` — `vertico-publish`, `vertico-row`, `vertico-candidate-segments`, `vertico-segments-from-spans`, `vertico-annotation-segments-from-spans`, `vertico-span-less-p`.
- `src/tlisp/stdlib.ts` — the bulk builtin (beside `orderless-filter-candidates` / `marginalia-annotate-builtin-candidates`).

## Acceptance Criteria (Completion)
- [ ] `vertico-rows-bulk` builtin ports the segment logic; T-Lisp per-row functions remain as reference.
- [ ] `vertico-publish` uses the bulk path; output shape identical (segments/faces/selected flag).
- [ ] `vertico-publish` < 1.5ms per call in a live M-x session.
- [ ] M-x keystroke < 8ms end-to-end (in-process).
- [ ] Regression: vertico/marginalia/minibuffer-renderer/completion suites green.

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
