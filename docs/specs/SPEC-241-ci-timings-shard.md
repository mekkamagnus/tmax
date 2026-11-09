# SPEC-241 — CI: adopt `--timings` + `--shard` for balanced test sharding

Issue: #241 — use Bun 1.4's `--timings` (per-file durations) and `--shard=i/n` (time-balanced splits) to distribute `test:unit` evenly across CI runners.
Status: landed (ADR-0266)
Date: 2026-11-10

## Goal

Adopt the Bun 1.4 timing/sharding flags for `test:unit` in CI — with the scope re-based on post-#239 reality: the single-runner `--parallel` job is now **89 s** (was the ~13-min serial suite the issue was written against), so the matrix question is answered by measurement, not assumption.

## Ground truth (probed on Bun 1.4.4 + the wrapper)

- `--timings=<file>` READS per-file durations (several files merge — the CI-shard pattern); `--update-timings` WRITES measured durations to the first file after the run (under `--shard`, only that shard's files). Missing input file is tolerated (cold cache).
- The wrapper (`scripts/run-unit-tests.ts`) passes bun-test flags through verbatim — `--shard`/`--timings`/`--update-timings` already reach `bun test` (verified: `--shard=1/4` ran 68/272 files).
- Time-balanced 2-shard split WITH timings (local, same host): shard 1/2 = 144 files / 1922 tests green in 55 s (174.1 s user); shard 2/2 = 128 files / 1662 tests green in 65 s (173.7 s user) — disjoint union = 272 files / 3584 tests, **user-CPU balanced to within 0.5 s**.

## Design

1. **CI (`test-bun` job):** carry `.unit-test-timings.json` across runs via `actions/cache` (rolling `unit-test-timings-<run_id>` key + prefix restore), run `bun run test:unit --timings=.unit-test-timings.json --update-timings` — every run's `--parallel` workers start the slowest files first, and fresh durations are persisted for the next run. Cold-cache tolerant. The stale "batches of 5 / ~13min" job comment is corrected to the #239 model.
2. **`--shard` matrix: NOT adopted now, supported and measured.** An 89 s single job gains ~30–40 s wall at best from a 2-way matrix while paying per-runner startup + cache/artifact plumbing; the documented threshold for revisiting is `test-bun` > 5 min. Any future matrix uses the (already-working) passthrough: `bun run test:unit --shard=i/n --timings=.unit-test-timings.json --update-timings`.
3. `.gitignore` gains `.unit-test-timings.json` (local run artifact).

## Completion criteria

1. CI `test-bun` persists and reuses timings across runs (restore → run with `--timings --update-timings` → save, `if: always()`), tolerant of a cold cache — CI green on the branch AND on the next run after merge (proving the cache round-trip).
2. Wrapper passthrough of `--shard`/`--timings` verified with real runs: both halves of a timed 2-shard split green, disjoint, time-balanced (numbers recorded).
3. The no-matrix decision + revisit threshold documented in the ADR (with the 89 s / 89→~55 s numbers).
4. ADR-0266 + index line.

## Out of scope

`test-tmax-use` (stays solo per #239/#241), adw `--changed` (#240), `--parallel-delay` tuning.
