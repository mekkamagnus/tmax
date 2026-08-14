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

*(to be filled during investigation — instrumentation breakdown of handleKey)*

Measured attribution so far (2026-08-14, idle machine, in-process editor):

| Piece | Cost |
|-------|------|
| `handleKey('j')` total | ~19ms |
| T-Lisp `(cursor-move ...)` eval (what the handler runs) | 0.04ms |
| `captureFrame` (render, incl. highlight) | 0.19–0.43ms |
| `command-completion-refresh` (cached) | ~0.4ms |

⇒ ~18.5ms is unattributed dispatch/state machinery between the key arriving and
the command evaluating.

## Solution Statement

Instrument `handleKey`'s internals (normalizeKey, ensureCoreBindingsLoaded,
mode-handler dispatch, executeCommand path, applyUpdate cascade, any per-key
sync) to attribute the ~18.5ms, then eliminate or cache the top contributors.
Target: **<5ms per plain-motion key in-process** (keynorm floor tightened to
match), which combined with the completed M-x fix puts M-x typing under one
frame and general typing well under it.

## Steps to Reproduce

1. `bun run bench keynorm` → ~5–6s for N=300 keys ≈ 17–19ms/key.
2. Or: profile `await editor.handleKey('j')` × 300 in-process.

## Relevant Files

- `src/editor/editor.ts` — `handleKey` (line ~2320): normalizeKey, ensureCoreBindingsLoaded, mode dispatch.
- `src/editor/handlers/normal-handler.ts` (and siblings) — per-key handler work.
- `bench/micro-keynorm.ts` — the regression benchmark (floor to be tightened after the fix).

## Acceptance Criteria (Completion)
- [ ] The ~19ms is attributed with a measured breakdown (per-stage timings).
- [ ] Top contributors eliminated/cached; plain-motion `handleKey` < 5ms.
- [ ] `keynorm` floor tightened from 10000/12000/12000ms to match the new baseline (with headroom).
- [ ] No behavior change: motion/editing/visual/M-x regression suites green.
- [ ] Breakdown documented here + ADR.

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
