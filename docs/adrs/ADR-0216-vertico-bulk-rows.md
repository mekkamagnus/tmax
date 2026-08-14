# ADR-0216 — Bulk vertico rows + memoized minibuffer state (`#187` / BUG-80)

## Status
Accepted

## Context
After the export-cache fix (ADR-0215), an M-x keystroke was ~17ms; ~9ms of it
was `vertico-publish` — the per-row `mapcar` of `vertico-row` →
`vertico-candidate-segments` → name-dispatched `stable-sort` + recursive
span-to-segment walking, ~50+ interpreter round-trips per keystroke. The same
disease as the orderless/marginalia bulk fixes (`42dd0ea`). Profiling deeper,
a second dominant cost appeared: `minibuffer-state-get` deep-deserialized the
entire serialized session (all ~146 matched candidates) from JSON on EVERY
call, and the keystroke path calls it ~4× (refresh, replace-session, publish,
selected-candidate) — ~1.7ms each.

## Decision
1. **`vertico-rows-bulk (candidates selected-value)` builtin** (stdlib.ts) —
   builds all visible rows in one call: a faithful TS port of the
   segments-from-spans walk (plain leading run → `completion-match` → recurse
   past end), the two-space annotation separator, annotation-span segments,
   the `selected` flag; spans sorted by start in TS (no name-dispatched
   predicate). vertico.tlisp's per-row functions stay as the reference
   implementation; `vertico-publish` delegates its rows mapcar.
2. **`minibuffer-state-get` identity-memoized** — cache the deserialized
   TLispValue keyed on the serialized object's identity. Sound because
   `SetMinibufferState` goes through `serializeTlispValue` which builds a
   fresh object on every state change, so a changed state can never share
   identity with the memoized source. (A future in-place mutator of
   `model.minibufferState` would break this; the update path is wholesale by
   construction.)

## Consequences
- `vertico-publish`: 9.4ms → **0.70ms** (13×); `minibuffer-state-get`:
  1.74ms → 0.01ms; M-x keystroke: ~17ms → **~13ms** cumulative with the
  earlier fixes (250ms → 13ms overall).
- The spec's <8ms end-to-end target is **not met here** and decomposes into
  pieces outside this diff: the per-key baseline (~3ms, BUG-79/#186's floor)
  and `completion-all-completions` (~8.5ms orchestration — table dispatch
  alone measures ~4ms, which is suspicious and is the first thing to profile
  in the follow-up). Filed as the next smoothness issue.
- Fourth application of the bulk pattern (orderless → marginalia → vertico →
  next: completions orchestration). The pattern's invariant holds: T-Lisp
  keeps the reference implementation + policy; TS does the per-candidate hot
  loop in one round-trip.

## Verification
`bun run typecheck` clean. New `test/unit/vertico-bulk-rows.test.ts` 4/4 —
hand-computed fixtures (faces/ordering/separator/selected) + byte-parity with
the T-Lisp per-row reference. Completion regression (vertico/marginalia/
minibuffer/orderless/mx-cache/buffer/file/framework/runtime) 44/44. Verify-gate:
GAPS on exactly the end-to-end <8ms criterion (the out-of-scope remainder,
per above); the targeted criteria independently corroborated (publish 0.47ms
re-measured by the verifier).
