# ADR-0211 — Expand the benchmark suite (`#184` / CHORE-84)

## Status
Accepted

## Context
The `bench/` harness measured only 3 hot paths (buffer / T-Lisp / e2e). Several
critical user-visible performance surfaces were unmeasured, so regressions on
them shipped undetected. Most consequentially, the exact M-x lag the user
reported (BUG-78) — per-keystroke `callable-command-details` enumeration — had
no benchmark, and the in-process per-key dispatch cost (the "dragging on every
keystroke" feeling) was only measurable end-to-end through the daemon socket,
so editor overhead could not be attributed separately from RPC overhead.

## Decision
Add 4 microbenchmarks, a shared in-process editor harness, and per-bench
regression floors:

1. **`minibuffer`** (`micro-minibuffer.ts`) — measures `(command-completion-refresh)`,
   the M-x candidate-build (`callable-command-details` enumerate + `filter` +
   `mapcar`). Originally (CHORE-84) it measured the uncached build (~280ms/call);
   after BUG-78/#182 landed per-session caching, the warmup populates the cache
   and the timed loop measures the **cached** path (~0.4ms/call). A cache
   regression spikes this ~150× back toward ~14s, failing the floor loudly.
   Size-independent; measured once (cached across size rows).
2. **`render`** (`micro-render.ts`) — measures `captureFrame(state, 80, 24)`,
   the shared ANSI render path (syntax spans + viewport + status line + tab
   bar + minibuffer + which-key), per size. ~Half the per-key cost.
3. **`startup`** (`micro-startup.ts`) — measures `startEditor()` wall time
   (loads every core `.tlisp` + registers primitives). Size-independent;
   measured once (cached) and relabeled per-size row.
4. **`keynorm`** (`micro-keynorm.ts`) — measures `editor.handleKey` in-process
   keys/sec (normalize + dispatch + edit, no socket). Isolates the editor
   per-key cost from the daemon round-trip `e2e` adds.

Supporting changes:
- **`bench/editor-harness.ts`** — shared `makeStartedEditor()` + `isolateHome()`
  (lighter than `micro-e2e`'s daemon spawn; used by minibuffer/render/keynorm).
- **`bench/bench.ts`** — the 4 names added to `KNOWN_BENCHES`, the dispatch
  `switch`, and the `"all"` path (now 7 benchmarks × 3 sizes).
- **`bench/README.md`** — new-benchmark table + a baselines table.
- **`test/unit/bench-harness.test.ts`** — `render` run live at all 3 sizes for
  well-formedness; the heavy benches (`minibuffer` ~280ms/call, `keynorm`
  ~22ms/key, `startup` 5× startEditor) checked for importability, like `e2e`
  their live paths covered by `bun run bench`.

## Floors (dev machine baseline, ~50–70% headroom)
- `minibuffer`: 400ms (N=50, cached path post-#182 ~19ms; was 22000ms for the
  uncached build — #182 lowered it when caching landed).
- `render`: small 250 / medium 200 / large 350 (N=500 frames).
- `startup`: 2500ms (avg of 5 cycles).
- `keynorm`: small 10000 / medium 12000 / large 12000 (N=300 keys).

## Consequences
- The user-reported lag is now quantified: **~280ms per M-x candidate-build**
  and **~22ms per in-process keystroke**. `keynorm`'s floor is set at current
  reality (well above the long-term sub-1ms target) and will FAIL-pass-forward
  as per-key work is eliminated — a future optimization that doesn't move these
  numbers isn't doing its job.
- `minibuffer` reveals the M-x drag is dominated not by candidate enumeration
  (~15ms) but by the T-Lisp string-name `filter`/`mapcar` over the table
  (~265ms). This gives #182 (per-session caching) a concrete before/after
  number AND surfaces a separate optimization target (the filter/mapcar
  dispatch overhead).
- Floors are sized for an idle machine; under heavy concurrent load (e.g. a
  parallel `test:unit`) they may false-fail — the same behavior the pre-existing
  `tlisp`/`e2e` floors already exhibit. Run `bench` on an idle machine.
- `startup` returns one cached measurement across all three size rows
  (size-independent); the table shows 3 identical rows, by design.
- N is kept modest for the expensive paths (minibuffer N=50, keynorm N=300) so
  a full `bun run bench` stays tractable rather than measuring tens of thousands
  of slow operations.

## Verification
`bun run typecheck` (all 4 projects) clean. `test/unit/bench-harness.test.ts`
8/8 (CHORE-84 added 2: `render` run live at all 3 sizes for well-formedness,
plus an importability check for the 3 heavy benches — minibuffer/keynorm/startup
are run live by `bun run bench`, like `e2e`). All 4 new benchmarks measured and
pass their floors when run standalone; `bun run bench all small` runs all 7
benchmarks.
