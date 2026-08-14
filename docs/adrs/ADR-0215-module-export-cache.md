# ADR-0215 — Cached module-export index (`#186` / BUG-79)

## Status
Accepted

## Context
The per-key baseline was ~19ms (`keynorm` benchmark) — the editor felt
stuttery everywhere, and the M-x fix (bulk orderless/marginalia) still left
~28ms/keystroke. Attribution found the true root cause: **`ModuleRegistry.
listExports()` rebuilt the entire export table on every unqualified
cross-module function call.** The unique-export fallback in stdlib's
`resolveCallable` (`resolveUniqueExport`) walks every loaded module × every
export with an env-chain lookup per export (~1,000 exports across 100 modules,
~1.1ms/call). The normal-mode handler makes ~10 such cross-module predicate
calls per keystroke (`vim-*-pending-p`, `macro-*-pending-p`,
`clear-splash-if-present`, …) → ~11ms/key of pure re-indexing, plus keymap
lookup and notify churn making up the rest.

## Decision
Cache `listExports()` in `ModuleRegistry`, invalidated at every mutation point
(`register`, `setLoading`, `setLoaded`, `setFailed` — the same methods that
bump the existing generation counter, ADR-0212's pattern). The cache stores the
built `ModuleExportRecord[]`; lookups over it (`resolveUniqueExport`,
`resolvePublicName`, `allExports`) are now O(n) scans of a prebuilt array.

Staleness reasoning: values are the function objects bound at module load. The
only shipped mutations are module load lifecycle events, all of which
invalidate. Mid-session redefinition of an exported symbol inside a module env
*without* a load event would read stale — no shipped path does that (defun
inside a loaded module rebinds locally, and module reloads go through
register/setLoaded).

## Consequences
- Per-key baseline: **~19ms → 2.85ms** (keynorm: 5659→854ms for N=300, 6.6×).
  Every cross-module T-Lisp call gets cheaper, not just per-key ones — the
  orderless/marginalia bulk builtins, describe-*, and module-heavy paths all
  benefit.
- M-x keystroke: ~250ms (two days ago) → **~17ms** end-to-end.
- `keynorm` floors tightened 10000/12000/12000 → 2000/2500/2500ms so a
  regression of this cache fails loudly.
- The export table is also what `callable-command-details` enumerates
  (M-x/describe); its per-call cost drops proportionally.

## Verification
`bun run typecheck` clean. keynorm bench PASS at the tightened floors.
Regression: vim-dispatch/motions/operators/macros/vim-counts/minibuffer/
buffer-completion/module-system/interactive/orderless/mx-cache — 115+ tests
green across two batches. Spec: `docs/specs/BUG-79-editor-per-key-baseline-latency.md`.

## Remaining follow-up (not this ADR)
M-x is ~17ms/keystroke; ~9ms is `vertico-publish` (per-row string-name
`stable-sort` predicate + recursive segment building over ~8 rows). A bulk
row-segments builtin (same shape as ADR-0213's bulk fixes) would take M-x
under one frame.
