# ADR-0183 — BUG-72 stall fixed: vim-bindings-smoke shares ONE editor (#122)

## Status

Accepted

## Context

BUG-72 / #122: `vim-bindings-smoke.test.ts` + `vim-dispatch.test.ts` intermittently
hung under the batched runner's 5-file concurrent load, stalling `bun run test:unit`
with "batch N produced no output for 120s". A 3-agent fan-out (catalog-all /
#122-stall / runner-analysis) confirmed the root cause: every `editor.start()` runs
`ensureCoreBindingsLoaded` — a synchronous 570-line T-Lisp eval (~200ms solo).
`vim-bindings-smoke` called `createStartedEditor(BUFFER)` **99 times** (one per smoke
entry), so under batch concurrency the cumulative cost (99 × 3–5s) exceeded the runner's
120s inactivity gap. Candidates B/C/D (insert-handler loop, unawaited async, test race)
were ruled out (key dispatch is 3–17ms). The forbidden fix (global memoization of
`ensureCoreBindingsLoaded`) would break per-editor interpreter isolation.

## Decision

Share **ONE editor** across all 99 smoke entries (test-only change — no production code).
`beforeAll` creates a single started editor; each entry resets state between tests:
`handleKey("Escape")` (clears any pending prefix/count/operator/which-key + returns to
normal mode) + `editor.createBuffer("smoke-<label>", BUFFER)` (fresh buffer — cheap,
no binding reload). The 99→1 editor-start reduction eliminates the dominant stall cause.

## Verification

- **3 consecutive batch-36 runs** (the exact 5-file cluster that stalled): 152/152 pass,
  ~100–110s each, **NO STALL** — the #122 DoD ("3 consecutive runs no stall") is met.
- All 99 smoke tests pass (no state leak from the shared editor).
- Runtime: **1.9s** solo (down from ~28s — a ~15× speedup from 1 editor.start vs 99).

## Consequences

- The BUG-72 batch-36 stall is gone — `test:unit` no longer hangs at that cluster.
- The shared-editor pattern is a template for other editor-start-heavy test files
  (vim-dispatch 44, operator-text-object 40, etc. — identified by Agent B). These are
  FUTURE optimizations, not stall-blockers (the batch-36 cluster now completes reliably
  with vim-dispatch's 44 editors at ~100s).
- The per-instance-safe fix (no global memo, no AST cache) respects the codex forbiddance
  and the per-editor isolation contract.
