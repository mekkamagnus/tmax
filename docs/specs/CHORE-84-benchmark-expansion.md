# Chore: Expand the benchmark suite

## Chore Description

The current `bench/` harness measures 3 hot paths (buffer / T-Lisp / e2e).
Several critical user-visible performance surfaces are NOT benchmarked, allowing
regressions to ship undetected. This chore adds missing microbenchmarks to close
those gaps.

## Current state

| Benchmark | What | Floor |
|-----------|------|-------|
| `micro-buffer` | TextBufferImpl insert/delete | small ~600ms, large ~37.6s |
| `micro-tlisp` | T-Lisp execute evals/sec | 500ms (size-independent) |
| `micro-e2e` | Full daemon keystroke path | small ~3.2s, large ~40s |

## Missing benchmarks

| New benchmark | What it measures | Why it matters |
|---------------|-----------------|----------------|
| **minibuffer-completion** | M-x candidate enumeration (`callable-command-details`) + Orderless filtering + Vertico render per keystroke | The specific lag reported in BUG-78. No benchmark catches it. |
| **frame-render** | `captureFrame` / `renderSteepFrame` for a given buffer + viewport size | Render path (syntax highlighting + viewport + status line) runs every key. Never measured in isolation. |
| **module-load** | `startEditor()` wall time (loads all .tlisp core files) | Startup latency — user-visible first impression. Currently unmeasured. |
| **key-normalization** | `normalizeKey` + handler dispatch latency per key | Per-key overhead BEFORE buffer edit. Should be sub-1ms; unverified. |
| **help-linkify** | `help-linkify(text)` throughput — O(names × text) | The new #177 primitive iterates all callable names per call. Needs a floor. |
| **which-key-popup** | `computeWhichKeyPopup` when a prefix is pressed | Popup computation runs on prefix keystrokes. Unmeasured. |

## Priority order

1. **minibuffer-completion** (critical — the user-reported lag)
2. **frame-render** (high — the render path is half the per-key cost)
3. **module-load** (medium — startup UX)
4. **key-normalization** (medium — per-key overhead verification)
5. **help-linkify** (low — new code, small risk)
6. **which-key-popup** (low — infrequent)

## Relevant Files

- `bench/` — the existing harness.
- `bench/bench.ts` — runner (add dispatch rows).
- `bench/output.ts` — BenchResult type + format.
- New: `bench/micro-minibuffer.ts`, `bench/micro-render.ts`, `bench/micro-startup.ts`, `bench/micro-keynorm.ts`.

## Step by Step Tasks

### Task 1: minibuffer-completion microbenchmark
**Acceptance Criteria**:
- [ ] `bench/micro-minibuffer.ts` measures `callable-command-details` enumeration + filtering.
- [ ] Reports ops/sec + wall_ms + floor.
- [ ] `bun run bench minibuffer` runs it.

### Task 2: frame-render microbenchmark
**Acceptance Criteria**:
- [ ] `bench/micro-render.ts` measures `captureFrame` for small/medium/large buffers.
- [ ] Reports ops/sec + wall_ms + floor.

### Task 3: module-load microbenchmark
**Acceptance Criteria**:
- [ ] `bench/micro-startup.ts` measures `TmaxServer.startEditor()` wall time.
- [ ] Reports wall_ms + floor (one row, not per-size).

### Task 4: key-normalization microbenchmark
**Acceptance Criteria**:
- [ ] `bench/micro-keynorm.ts` measures `normalizeKey` + handler dispatch per key.
- [ ] Reports ops/sec + floor (sub-1ms expected).

### Task 5: Wire into bench.ts runner + README
**Acceptance Criteria**:
- [ ] `bun run bench` includes all new rows.
- [ ] `bench/README.md` updated with new benchmark descriptions + baselines.

## Acceptance Criteria (Completion)
- [ ] 4+ new microbenchmarks added (minibuffer, render, startup, keynorm).
- [ ] All have floors set to dev-machine baselines.
- [ ] `bun run bench` runs all benchmarks (old + new) and exits non-zero on regression.
- [ ] `bun run typecheck:bench` passes.

## Validation Commands
- `bun run typecheck:bench`
- `bun run bench`
- `bun run bench minibuffer small` (single row smoke test)
