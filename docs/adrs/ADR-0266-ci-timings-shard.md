# CI: adopt `--timings` (+ measured `--shard`) for the unit suite

## Status

Accepted (2026-11-10) — resolves #241 / SPEC-241. Builds on #239 (parallel suite, ADR-0265) and #233 (Bun 1.4.4).

## Context

The issue was filed against a ~13-min serial CI suite: distribute `test:unit` across runners with Bun 1.4's `--shard=i/n`, balanced by `--timings` (per-file durations). #239 since collapsed the same job to **89 s** on one runner (`--parallel` worker processes), which changes the matrix calculus — but the flags still have real work to do: `--timings` feeds `--parallel` a slowest-files-first worker order, and a timings file is the prerequisite for any future balanced `--shard` matrix.

Probed semantics (Bun 1.4.4): `--timings=<file>` reads (several files merge on read — the per-shard CI pattern); `--update-timings` writes fresh durations after the run (under `--shard`, only that shard's files); a missing input file is tolerated. The `test:unit` wrapper passes bun-test flags through verbatim, so `--shard`/`--timings` needed no wrapper code.

## Decision

1. **`--timings` adopted actively in CI.** `test-bun` restores `.unit-test-timings.json` from the previous run (actions/cache, rolling `unit-test-timings-<run_id>` key + prefix restore), runs `bun run test:unit --timings=.unit-test-timings.json --update-timings`, and saves the fresh file (`if: always()`). Every run's workers start the slowest files first; cold cache tolerated.
2. **`--shard` matrix NOT adopted — supported, measured, threshold-documented.** A timed 2-shard split (local, timings-balanced) ran 144+128 files / 1922+1662 tests, both green, **user-CPU balanced to 0.5 s** (174.1 s vs 173.7 s) — the mechanism works. But sharding an 89 s single job buys ~30–40 s wall at best while paying per-runner startup + cache plumbing per leg. Revisit when `test-bun` exceeds **5 min**; the future matrix is one line per leg via the existing passthrough (`--shard=i/n --timings=… --update-timings`).
3. `.gitignore` gains `.unit-test-timings.json`; the stale test-bun job comment ("batches of 5 / ~13 min") is corrected to the #239 model.

## Consequences

- CI `--parallel` worker ordering improves with every run (rolling timings); the artifact also makes future sharding a config change, not an investigation.
- `test-tmax-use` (268 s — now the long pole) stays solo per the flake population documented under concurrent load (#239/#241).
- Gates: typecheck (4 projects) ✅; full parallel suite with `--timings/--update-timings` ×2 green (123.2 s / 121.8 s, 3584/0, 272-file timings file written) ✅; timed 2-shard split green + balanced ✅; integration 82/82 ✅; CI green on the branch and on the next run after merge (cache round-trip proven).
