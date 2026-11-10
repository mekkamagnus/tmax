# M-x first-open warm-up NOT adopted (premise stale ~35×)

## Status

Accepted (2026-11-10) — resolves #238 / SPEC-238. Builds on #233 (Bun 1.4.4,
ADR-0259), #234 (parse cache, ADR-0261), and BUG-78/#182 (the candidate cache
itself, ADR-0212). Follows the ADR-0266 measured-and-not-adopted precedent.

## Context

#238 asked to pre-build the M-x candidate cache at session start (or while
the daemon is idle) because "first M-x open per session pays ~280ms in T-Lisp
filter/mapcar dispatch." The ~280ms figure dates from BUG-78 (1,164
candidates, Bun 1.3.x, no parse cache). Three things landed since: #233
(runtime), #234 (parse cache — parse was the dominant dispatch cost), and the
candidate set shrank to 234 via the interactive-only M-x source (SPEC-115).

Re-profiled 2026-11-10 on main @ `13c0df5`:

- **Cold build** (`command-completion-refresh` right after `startEditor()`,
  5 fresh editors): min 6.3 ms / median **8.3 ms** / max 22.1 ms.
- **Warm** (second refresh): 0.1 ms. Candidates: **234**.
- **Official harness**: `bun run bench minibuffer` (cached path) → 0.78 ms
  wall for N=50 (~16 µs/call; second run 1.05 ms / ~21 µs/call), PASS.

The premise is stale by ~35×. An 8 ms cold build is imperceptible behind the
keybinding; TS-side filtering was already off the table per the issue
(editor logic lives in T-Lisp, `src/editor/CLAUDE.md`).

## Decision

1. **Warm-up NOT adopted.** Pre-building at session start would add a
   startup side-effect to optimize ~8 ms the user cannot perceive
   (CLAUDE.md §2/§3). The BUG-78/#182 per-session cache stays as-is — a
   cheap win, no longer a latency fix.
2. **Reopen threshold: cold build > ~50 ms** (~6× current median,
   perceptibility onset). If `command-completion-refresh` regresses past it,
   reopen #238 and reassess.
3. **Stale present-tense claims corrected** (comments/docstrings only): the
   module comment + `command-completion-refresh` docstring in
   `execute-extended-command.tlisp`, the `micro-minibuffer.ts` header +
   `FLOOR_MS` rationale, the bench README minibuffer row, the cache-payoff
   comment in `mx-completion-cache.test.ts`, and the heavy-bench comment in
   `bench-harness.test.ts`. Historical records (ADR-0211/0212, BUG-78,
   RFC-026) are accurate history and untouched.
4. **`minibuffer` floor recalibrated 400 → 100 ms.** `assertFloor` passes on
   `wallMs <= floorMs`; post-#234 a full cache-bust (~400 ms for N=50 =
   50 × ~8 ms) sat exactly ON the old 400 ms floor — the bench's advertised
   loud regression detection had become a boundary coin-flip. With the cached
   path at ~1 ms for N=50, cached-vs-bust separation is ~400:1, so 100 ms
   restores loud detection (bust fails 4× over) while keeping ~100× headroom
   for CI/cold-JIT variance. Safe on same-day measurements because both
   margins are two orders of magnitude.

## Consequences

- The diff is comment/doc text plus the single `FLOOR_MS = 100` constant —
  no .tlisp logic, no test assertions changed. Cache behavior is pinned by
  the untouched `mx-completion-cache.test.ts` contract.
- The bench README's `keynorm` row (~22 ms/key) is similarly era-stale
  post-#236 (~0.6 ms/key) but is #236's quantity — noted here, not touched
  (surgical scope).
- Gates: typecheck:src + typecheck:test clean ✅; mx-completion-cache test
  4/4 ✅; `bun run bench minibuffer` PASS against the tightened 100 ms floor
  ✅.
