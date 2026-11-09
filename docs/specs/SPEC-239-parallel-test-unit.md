# SPEC-239 — Parallelize test:unit (per-worker socket namespacing + --parallel)

Issue: #239 — `bun test --parallel` (implies `--isolate`) for the unit suite; daemon socket paths namespaced per worker via `BUN_TEST_WORKER_ID`; tmax-use stays solo.
Status: landed (ADR-0265)
Date: 2026-11-10

## Goal

Cut unit-suite wall-clock by running test files concurrently in worker processes, with the cross-file daemon-socket hazard eliminated first. Builds on #237 (isolate default, landed `0f325f5`) and #233 (Bun 1.4.4, which ships `--parallel` / `--parallel-delay` / `BUN_TEST_WORKER_ID`).

## Ground truth (probed on Bun 1.4.4)

- `--parallel=N` runs files in worker **processes** (distinct pids per worker) and implies `--isolate`.
- `BUN_TEST_WORKER_ID` is set per worker ("1", "2", …); undefined serially.
- First full-suite parallel probe (pre-fix, all 272 files one invocation): **2:08 wall-clock** (serial-isolate baseline 4:16), 3578 pass / 1–2 fail — the failures were `connect ENOENT /tmp/tmax-test-<pid>-<ts>.sock` in test-ai-agent-control: a sibling file's `sweepTestSockets()` (prefix-based, unlinks every matching `/tmp/*.sock`) ripping a live worker's socket mid-test. That sweep was the ONLY cross-file collision (all socket derivations were already pid+time(+rand)-unique; `startEditor()`-style fixture servers never bind sockets).

## Design

1. `test/fixtures/server-test-helpers.ts` gains `testWorkerToken()` (`p<pid>w<BUN_TEST_WORKER_ID ?? 0>`) and `testSocketPath(label)` (`/tmp/tmax-<label>-<token>-<ts>-<rand>.sock`); all 10 hand-rolled socket derivations across 9 test files migrate to it.
2. `sweepTestSockets()` is scoped to entries containing the CURRENT worker token (plus `tmax-`/`.sock` guards) — a worker can never unlink a sibling's live socket. Trade-off recorded in ADR: crashed runs' stale sockets are no longer cross-run cleaned (cosmetic; unique naming makes stale files unable to collide with a new bind; OS reaps /tmp).
3. `scripts/run-unit-tests.ts`: full-suite default becomes ONE `bun test --dots --timeout 60000 --parallel` invocation with ALL files (batches would serialize the pool); BUG-16 summary-watch harness unchanged (one summary line). `TMAX_UNIT_NO_PARALLEL=1` opts out to the #237 serial 5-file-batch isolate mode. Explicit single-target invocations are unchanged.
4. tmax-use playbooks: untouched (separate script, stays solo per the documented flake population under concurrent load).

## Completion criteria

1. Parallel-default `bun run test:unit` green solo, all files, 0 fail, exit 0 — with wall-clock recorded against the serial-isolate baseline (same host; A/B back-to-back; ≥2 consecutive parallel greens for flake signal).
2. The sweep-scoping pin exists and is mutation-proven (reverting the worker-token filter makes it fail): own-token sockets unlinked, foreign-worker + non-tmax sockets spared.
3. All socket derivations route through `testSocketPath` (no hand-rolled `/tmp/tmax-*.sock` templates left in test/unit).
4. `TMAX_UNIT_NO_PARALLEL=1` documented in the wrapper comment; A/B + probe numbers in the ADR.
5. ADR-0265 + index line.

## Out of scope

CI sharding `--timings`/`--shard` (#241), adw `--changed` routing (#240), tmax-use parallelization (explicitly never — flake population), `--parallel-delay` tuning.
