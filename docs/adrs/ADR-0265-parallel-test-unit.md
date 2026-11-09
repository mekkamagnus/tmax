# Parallelize `test:unit` — per-worker socket namespacing + `--parallel`

## Status

Accepted (2026-11-10) — resolves #239 / SPEC-239. Builds on #237 (isolate default, ADR-0264) and #233 (Bun 1.4.4).

## Context

The unit suite (3584 tests / 272 files) ran serially: 4:16–4:43 wall-clock after #237. Bun 1.4 ships `bun test --parallel` — files run concurrently in worker **processes** (distinct pids), implying `--isolate`, with `BUN_TEST_WORKER_ID` exposed per worker. The issue named one blocker: cross-worker collision on the daemon socket. Probing showed the real hazard was narrower and different:

- All socket-binding tests already derived pid(+time+rand)-unique paths (fixture `startEditor()` servers never bind sockets at all), so *name* collisions were impossible.
- The ONE cross-file killer was the shared `sweepTestSockets()` helper: prefix-based, it unlinked EVERY `/tmp/tmax-*.sock` — including sibling workers' LIVE listening sockets. Reproduced pre-fix: parallel probe ran 3578 pass / 1–2 fail with `connect ENOENT /tmp/tmax-test-<pid>-<ts>.sock` in test-ai-agent-control (a sibling file's `beforeEach` sweep).

## Decision

**Worker-token socket namespacing, then `--parallel` as the `test:unit` default.**

1. `test/fixtures/server-test-helpers.ts` gains `testWorkerToken()` (`p<pid>w<BUN_TEST_WORKER_ID ?? 0>`) and `testSocketPath(label)` (`/tmp/tmax-<label>-<token>-<ts>-<rand>.sock`); all 10 hand-rolled socket derivations across 9 test files migrated to it — one canonical derivation instead of 9 ad-hoc variants.
2. `sweepTestSockets()` unlinks only entries carrying the CURRENT worker token (plus `tmax-`/`.sock` guards): a worker can never unlink a sibling's live socket. Mutation-proven pin (neuter the token filter → the foreign-survival test fails).
3. `scripts/run-unit-tests.ts`: full suite = ONE `bun test --dots --timeout 60000 --parallel` invocation with all files (serial 5-file batches would serialize the pool); the BUG-16 summary-watch harness is unchanged (still one summary line). `TMAX_UNIT_NO_PARALLEL=1` opts out to the #237 serial mode; explicit single-target runs unchanged.
4. tmax-use stays solo (separate script; documented flake population under concurrent load).

**Trade-off:** the sweep no longer cross-run-cleans crashed runs' stale sockets. Cosmetic only — unique name derivation means a stale file can never collide with a new bind, each test unlinks its own socket in teardown, and the OS reaps /tmp.

## Evidence (same host, back-to-back)

| run | mode | result | wall-clock |
|---|---|---|---|
| pre-fix probe | `--parallel` (all files, 1 invocation) | 3578 pass / **1 fail** (sweep ENOENT) | 2:08 |
| pre-fix rerun | `--parallel` | **2 fails** (same ENOENT pattern) | — |
| post-fix leg 1 | parallel default via wrapper | **3584 pass / 0 fail / exit 0** | **2:01** |
| post-fix leg 2 | parallel default via wrapper | **3584 pass / 0 fail / exit 0** | 2:04 |
| serial-isolate leg | `TMAX_UNIT_NO_PARALLEL=1` (same commit) | 3584 pass / 0 fail / exit 0 (264.67s user / 118% cpu) | 4:18 |

~2.15× wall-clock cut (2:01 vs 4:18; 330% CPU vs 118%), zero flakes across two consecutive full parallel runs. (Test count 3580→3584: the four new #239 pins.)

## Consequences

- `test:unit` (and wrapper-routed `test:adw` full runs) default to parallel; CI's `test-bun` job inherits it with no workflow edit — its wall-clock drops ~2×.
- Any future server-binding test MUST derive its socket via `testSocketPath()` (the sweep only recognizes token-bearing names).
- #241 (CI `--timings` + `--shard`) builds on this: `--timings` feeds slowest-file-first ordering to `--parallel`.
- Gates: typecheck (4 projects) ✅; parallel-default `bun run test:unit` ×2 ✅ (2:01, 2:04 — 0 fail, exit 0); serial leg ✅ (4:18); integration 82/82 ✅; mutation-proof of the sweep pin ✅; CI green on `issue-239`.
