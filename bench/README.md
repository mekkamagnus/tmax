# bench/ — performance benchmark harness

Phase 0 of [RFC-019](../docs/rfcs/RFC-019-performance-audit.md). Provides
reproducible microbenchmarks for tmax's per-keystroke hot path so every
subsequent RFC-019 fix can show a real before/after number.

This harness **measures** the current code; it does **not** optimize anything.
Optimization is [CHORE-34](../docs/specs/CHORE-34-perf-phase1-buffer-fixes.md)
and the subsequent Tier 1b/2/3 CHOREs.

## Microbenchmarks

| Name | What it measures | Hot-path target |
|------|------------------|-----------------|
| `buffer` | `FunctionalTextBufferImpl.insert` / `delete` throughput on a fixture | RFC-019 Tier 1.1–1.3 (incremental lines, offset cache, array clone) |
| `tlisp`  | `TLispInterpreterImpl.execute` evals/sec on a representative small command | RFC-019 Tier 2.3 (parse cache), Tier 2.6 (tokenizer regexes) |
| `e2e`    | End-to-end keystroke throughput through a live daemon over the JSON-RPC socket | Full keystroke path: RPC serialize → buffer edit → viewport re-tokenize → repaint |

The `e2e` microbenchmark is the most RFC-019-sensitive: it exercises the entire
per-key path and will move the most when Tier 1 buffer fixes land. The
isolated `buffer` and `tlisp` microbenchmarks exist to **attribute** that
movement to specific subsystems.

## Running

```bash
bun run bench                  # all 3 microbenchmarks × 3 sizes (9 rows)
bun run bench:all              # same as above
bun run bench all medium       # all 3 microbenchmarks, medium size only
bun run bench buffer medium    # single row
bun run bench tlisp            # T-Lisp eval across all sizes
bun run bench --help           # usage
```

The harness reuses `tmax-use/src/instance.ts` for daemon lifecycle (microbenchmark 3).
No `bin/tmax --stop` calls — the harness uses an isolated socket path and tears
down the daemon in a `finally` block.

## Output format

```
name       | size     | ops/sec      | bytes/op   | wall_ms    | floor_ms   | result
-----------|----------|--------------|------------|------------|------------|---------
buffer     | small    | 2.90k        | 22B        | 344.29     | 600.00     | PASS
```

One row per (microbenchmark, size). Columns:

- `name` — microbenchmark name.
- `size` — fixture size: `small`, `medium`, `large`.
- `ops/sec` — measured throughput.
- `bytes/op` — **estimated** per-op cost (input/response size). **Not** a heap
  allocation measurement. Real heap measurement would require a Bun-compatible
  allocator hook; out of scope for this chore.
- `wall_ms` — total wall time of the measured iterations (excluding warmup).
- `floor_ms` — regression ceiling for this (microbenchmark, size).
- `result` — `PASS` if `wall_ms <= floor_ms`, else `FAIL`.

The runner exits non-zero if any row fails its floor.

## Floor concept (regression detection)

Each (microbenchmark, size) has a **floor** — the maximum acceptable wall time.
The floor is set to the dev-machine baseline measured when the floor was
committed, rounded up ~20–40% to absorb CI / first-load-JIT variance.

A regression (Tier 1 fix reverted, a slow regex introduced, etc.) shows up as
`wall_ms > floor_ms` → `FAIL` → non-zero exit. CI gates on the exit code.

### Updating floors after an intentional optimization

When an RFC-019 fix raises throughput, the old floor becomes loose. To
re-baseline:

1. Run `bun run bench` on a quiet dev machine (no other CPU activity).
2. Note the new `wall_ms` for each row.
3. Edit the `FLOORS_MS` constant in the corresponding `bench/micro-*.ts`:
   set each entry to the new `wall_ms` × ~1.2–1.4 (keep ~20–40% margin).
4. Commit `bench/micro-*.ts` with a message like
   `chore(bench): raise floor after RFC-019 Tier 1.2 (offset cache)`.
5. **Do not** loosen a floor without a corresponding optimization PR — that
   hides real regressions.

## Determinism

The harness is deterministic across runs on the same machine (±~5%):

- **Fixed edit pattern.** Microbenchmark 1 cycles through line indices via
  `i % lineCount`; there is no randomness.
- **Fixed command.** Microbenchmark 2 evaluates the same T-Lisp form on every
  iteration.
- **Fixed keystroke sequence.** Microbenchmark 3 builds its key sequence from a
  deterministic algorithm (cursor moves + occasional insert/escape cycle).
- **Warmup skipped.** Each microbenchmark runs `WARMUP=50` unmeasured iterations
  before starting the timer, so JIT cost is amortized before measurement.
- **No GC tricks.** No `gc()` calls; minor GC pauses are part of the
  measurement (this is realistic for the production keystroke path).

Cross-machine numbers will differ — that's expected. The floors are sized for
the dev machine where the baseline was taken; faster CI boxes will pass with
margin to spare, slower ones may need re-baselining.

## Fixtures

Three deterministic ASCII fixtures live in `bench/fixtures/`:

| File | Lines | Bytes/line | Total |
|------|------:|-----------:|------:|
| `small.txt`  |    500 | ~43 |  ~21 KB |
| `medium.txt` |  5,000 | ~43 | ~215 KB |
| `large.txt`  | 10,000 | ~103 |  ~1 MB |

Each line is `Line <zero-padded-index> <filler>\n` — plain ASCII, no escapes,
no non-ASCII, fixed-width. Generated by `bench/fixtures/generate.ts`
(idempotent: re-running the generator is a no-op once files exist at the target
line count).

To regenerate (e.g. to change sizes): edit `SPECS` in
`bench/fixtures/generate.ts`, delete the fixtures, and re-run
`bun run bench/fixtures/generate.ts`.

## Initial baselines (dev machine, this chore)

Measured on the development machine during CHORE-33, with the placeholder
floors removed. Subsequent CHOREs should re-measure and compare.

| Microbenchmark | Size   | ops/sec | wall_ms | Notes |
|----------------|--------|--------:|--------:|-------|
| buffer         | small  |  ~2.9k  |   ~344  | Each insert/delete triggers full `toString()` + `splitLines()` over the buffer. |
| buffer         | medium |   ~195  | ~5,130  | Quadratic growth — 10× lines → 15× wall time. |
| buffer         | large  |    ~40  |~25,070  | Confirms RFC-019 Tier 1 motivation. |
| tlisp          | small  |  ~28k   |   ~358  | First-load JIT cost; subsequent sizes are faster. |
| tlisp          | medium |  ~77k   |   ~130  | |
| tlisp          | large  | ~112k   |    ~89  | Same workload; size is ignored. |
| e2e            | small  |   ~83   | ~2,400  | Each keypress opens a fresh socket (~12ms round-trip). |
| e2e            | medium |   ~39   | ~5,140  | Slower per-key as fixture grows — viewport re-tokenize cost. |
| e2e            | large  |    ~6.5 |~30,800  | Strong candidate for Tier 1 attention. |

These baselines are the floors (rounded up ~20–40%) baked into
`bench/micro-*.ts`.

## Layout

```
bench/
├── README.md                  # this file
├── bench.ts                   # runner entry point
├── output.ts                  # BenchResult type + format/summarize/assertFloor helpers
├── micro-buffer.ts            # Microbenchmark 1: buffer edit throughput
├── micro-tlisp.ts             # Microbenchmark 2: T-Lisp eval throughput
├── micro-e2e.ts               # Microbenchmark 3: end-to-end daemon keystroke throughput
└── fixtures/
    ├── generate.ts            # idempotent fixture generator
    ├── small.txt              # ~21 KB, 500 lines (generated)
    ├── medium.txt             # ~215 KB, 5,000 lines (generated)
    └── large.txt              # ~1 MB, 10,000 lines (generated)
```

## Why no external benchmarking library

tmax is zero-dependencies by project principle (see `AGENTS.md` /
`CLAUDE.md` — Project Overview). Adding `mitata` / `tinybench` would violate
that for no measurable benefit at this layer. `Bun.nanoseconds()` plus
hand-rolled formatting is sufficient — and keeps the harness consistent with
the rest of the codebase.
