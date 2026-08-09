# ADR-0212 — Per-session M-x candidate-build cache (`#182` / BUG-78)

## Status
Accepted

## Context
BUG-78 reported M-x "dragging." The `minibuffer` benchmark (CHORE-84/#184)
quantified it: `command-completion-refresh` — the M-x candidate-build
(`callable-command-details` enumerate + `filter command-detail-interactive-p` +
`mapcar command-detail-candidate`) — cost **~280ms per M-x open**, with no
caching. The build is size-stable for a session (the command set only changes
when a module loads), yet it re-ran in full on every M-x open. SPEC-115 (#183)
had already cut the candidate set ~1,164 → ~146, but the per-open build was still
~280ms (dominated by the T-Lisp string-name `filter`/`mapcar`, ~265ms — not the
~15ms enumeration).

## Decision
Cache `command-completion-refresh`'s result for the session, invalidated only
when the command set could have changed:

1. **Generation counter on the module registry.**
   `ModuleRegistry` gains a monotonic `generation` counter, bumped in `register()`
   — the terminal step of every completed module load (called from
   `evaluator/module-forms.ts`) — and defensively in `setLoaded()` (currently
   zero callers; kept for any future direct loader). Exposed via `getGeneration()`.
2. **`module-registry-generation` TS primitive** (editor.ts) — surfaces the
   counter to T-Lisp as a cheap cache-invalidation token.
3. **Cache in `command-completion-refresh`** (execute-extended-command.tlisp).
   Two module-scoped vars hold the cached candidates + the generation they were
   built at. Refresh recomputes only when the current generation differs from
   the cached one; otherwise it reuses the cached candidate list.

## Consequences
- The `minibuffer` benchmark dropped **~143×** (uncached ~280ms/call → cached
  ~0.4ms/call; the bench's warmup populates the cache, so the timed loop measures
  the realistic cached path). Repeated M-x opens in a session are now instant.
- A cache regression (accidental invalidation, or the cache being bypassed)
  spikes the `minibuffer` bench back toward ~14s, failing its floor loudly — the
  cache is now regression-protected.
- The **first** M-x open in a session still pays the ~280ms uncached build
  (dominated by the `filter`/`mapcar` string-name dispatch). That is a separate
  optimization target, out of scope here; the cache addresses the repeated-open
  cost, which is the dominant user-facing pain.
- Invalidation is precise for module loads. A new command defined via
  `eval-expression` mid-session (no module load) won't appear in M-x until the
  next module load — acceptable, since dynamic command definition outside module
  loads is rare.

## Verification
`bun run typecheck` (all 4 projects) clean. New
`test/unit/mx-completion-cache.test.ts` 4/4 (generation is a positive number;
`register()` bumps it and the primitive reflects the bump; refresh runs without
error and stays cached; and a latency test proving the 2nd refresh is >10×
faster than the 1st — the automated artifact for the "repeated M-x opens are
instant" criterion). `minibuffer` benchmark PASS at the lowered 400ms floor
(~19–28ms cached, was ~12000ms pre-cache). Verify-gate: PASS.
