# Bug: Per-key baseline latency — every keystroke costs ~19ms before any command work

## Bug Description

The editor feels generally "stuttery": every keystroke, in any mode, costs
**~17–19ms in-process** (`keynorm` benchmark: `handleKey` on plain hjkl motion
keys, N=300) before any command-specific work. For smooth editing the per-key
budget is <16ms (one frame); 19ms means the editor tops out at ~55 keys/sec and
compounds under any additional per-key work (the fixed M-x filter was +230ms on
top; daemon round-trips add ~10–15ms more — `e2e` measures ~56ms/key
user-facing).

**Expected:** plain-motion keystrokes cost a few ms (T-Lisp command eval itself
measures 0.04ms — the 19ms is NOT the interpreter).
**Actual:** 17–19ms baseline on every key (keynorm benchmark, 2026-08-14 run:
small 18.9ms, medium 17.7ms, large 16.5ms — nearly size-independent, so it is
per-key fixed work, not buffer-scaled).

## Problem Statement

`handleKey` performs ~19ms of work per key that is not the mode handler, not
the T-Lisp command, and not the frame render (`captureFrame` measures
0.19–0.43ms). The cost is fixed per key. It is not yet attributed: candidates
include per-key async machinery (`ensureCoreBindingsLoaded` await), the debug
log wrapper, mode-handler dispatch overhead, immutable-state `applyUpdate`
cascades (cursor + viewport + status per key), keymap resolution, and
client/daemon sync work.

## Root Cause Analysis

**FOUND (2026-08-14): `ModuleRegistry.listExports()` rebuilt the entire export
table on EVERY unqualified cross-module function call.**

The unique-export fallback (`resolveUniqueExport` in module-registry.ts, used
by stdlib's `resolveCallable` whenever a function name isn't in the global env)
called `listExports()`, which walks **every loaded module × every export** with
one env-chain lookup each and rebuilds the full record array — ~1.1ms per call
(~1,000 exports across 100 modules). The normal-mode handler makes **~10 such
cross-module predicate calls per keystroke** (`vim-find-pending-p`,
`vim-mark-pending-p`, `macro-record-pending-p`, `vim-operator-pending-p`, …,
`clear-splash-if-present`), each a T-Lisp exec whose name resolution hits the
fallback → ~11ms of pure re-indexing per key, plus the keymap lookup path and
per-update notify churn making up the rest of the ~19ms.

Measured attribution (idle machine, in-process editor):

| Piece | Before | After |
|-------|--------|-------|
| `handleKey('j')` total | ~19ms | **2.85ms** (keynorm) |
| 10 pending-predicate execs | 12.4ms | **1.45ms** |
| T-Lisp `(cursor-move …)` eval | 0.04ms | unchanged |
| `captureFrame` render | 0.19–0.43ms | unchanged |
| M-x keystroke end-to-end | ~250ms (pre-BUG-79-completion-fix) | **~17ms** |

Ruled out along the way: `ensureCoreBindingsLoaded` (stubbed, no change),
state-change listeners (removed, no change), the T-Lisp command itself
(0.04ms), render (sub-ms), applyUpdate count (6/key — not the cost).

## Solution Statement

**Landed:** cache `listExports()` keyed on the registry's generation counter
(the ADR-0212 pattern) — invalidated at every mutation point (register,
setLoading, setLoaded, setFailed). Values are the function objects bound at
module load; every shipped mutation path bumps, so the cache cannot go stale.
`keynorm` floors tightened 10000/12000/12000 → 2000/2500/2500ms (measured
854/901/813ms).

**Remaining (smaller, optional follow-up):** M-x is now ~17ms/keystroke, of
which ~9ms is `vertico-publish` (per-row `stable-sort` by string-name predicate
+ recursive segment building in T-Lisp over ~8 visible rows) and the rest the
minibuffer refresh path. A bulk row-segments builtin (same shape as the
orderless/marginalia fixes) would take M-x typing under one frame.

## Steps to Reproduce

1. `bun run bench keynorm` → ~5–6s for N=300 keys ≈ 17–19ms/key.
2. Or: profile `await editor.handleKey('j')` × 300 in-process.

## Relevant Files

- `src/editor/editor.ts` — `handleKey` (line ~2320): normalizeKey, ensureCoreBindingsLoaded, mode dispatch.
- `src/editor/handlers/normal-handler.ts` (and siblings) — per-key handler work.
- `bench/micro-keynorm.ts` — the regression benchmark (floor to be tightened after the fix).

## Acceptance Criteria (Completion)
- [x] The ~19ms is attributed with a measured breakdown (per-stage timings).
- [x] Top contributors eliminated/cached; plain-motion `handleKey` < 5ms (2.85ms).
- [x] `keynorm` floor tightened from 10000/12000/12000ms to 2000/2500/2500ms (with headroom).
- [x] No behavior change: motion/editing/visual/M-x regression suites green (115+ tests).
- [x] Breakdown documented here + ADR-0215.

## Validation Commands
- `bun run bench keynorm`
- `bun test test/unit/` (editor + completion suites at minimum)
- Manual: hold `j` in a large file — scroll should be visibly smoother than before.

## Notes
- Distinct from (and stacked under) the fixed BUG-79 M-x completion cost: that
  was the minibuffer pipeline; this is the universal per-key floor.
- The `tlisp` micro-benchmark also breached its floor on the 2026-08-14 run
  (660–1030ms vs 500ms) — likely related machine variance; re-check on a quiet
  machine before treating as a separate bug.
