# Chore: Parallelize the unit-test runner (concurrency knob, default off)

## Chore Description
`scripts/run-unit-tests.ts` runs its batches STRICTLY SERIALLY: a for-loop (:130) awaits runBatch(...) one batch at a time, with FILES_PER_BATCH = 5 (:44). With ~195 files run by test:unit (243 total minus the adw-* exclusion at :55), that is ~39 sequential batches, and the ~13-min suite wall-clock is largely serial. runBatch (:75) already spawns an isolated bun child with its own stall-detect + SIGKILL guard, so each batch is independently pool-friendly.

This chore adds an env-gated concurrency knob (default 1 = today's exact serial behavior) so that, when opted in, N batches run concurrently via a Promise pool - recovering an estimated ~4-6 min.

This IS a behavior change (codex-confirmed during review of issue #36): concurrent execution changes test ordering, fail-fast semantics, stdout interleaving, and CPU/resource pressure - and daemon-spawning tests under concurrent load is precisely the BUG-16 / ADR-0113 / ADR-0116 flake trigger. Hence a chore spec (not a silent refactor), with the knob OFF by default until verified.

## Relevant Files
Use these files to resolve the chore:
- scripts/run-unit-tests.ts:44 - FILES_PER_BATCH (unchanged).
- scripts/run-unit-tests.ts:75-127 - runBatch (already an isolated, pool-friendly Promise<number>; reuse as-is).
- scripts/run-unit-tests.ts:130-131 - the serial for loop to replace with a concurrency-limited pool.
- scripts/run-unit-tests.ts:65 - batch construction (where a pure-vs-spawn classification could be attached, if adopted).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Task 1 - Add the concurrency knob (default 1 = serial, zero behavior change)
- Read process.env.TMAX_UNIT_CONCURRENCY (positive integer; default 1).
- At concurrency 1, behavior is byte-identical to today (serial for loop). This is the shipped default.

### Task 2 - Run batches through a concurrency-limited Promise pool when the knob > 1
- Replace the serial for loop (:130) with a pool that runs at most `concurrency` runBatch calls at once.
- Collect each batch's exit code; aggregate pass/fail exactly as today (same final exit code logic).
- Decide and document fail-fast semantics: prefer continue-all (run every batch, report aggregate), made explicit in a code comment.

### Task 3 - Buffer per-batch stdout/stderr to avoid interleaving
- Currently runBatch pipes child stdout/stderr straight through; under concurrency that interleaves. Buffer each batch's output and flush it (with a batch header) when that batch completes, so output stays readable and per-batch attributable.

### Task 4 - (Recommended) keep daemon-spawning batches serial even under concurrency
- To stay clear of the BUG-16 flake trigger, classify batches that spawn a real TmaxServer/spawn/socket as heavy and run only the pure batches concurrently (heavy batches stay serial, or get their own lower limit). Heuristic: grep the batch's files for TmaxServer/new Server/spawn(. If classification is too coarse, ship concurrency-1 default + the knob only, and leave classification for a follow-up.

### Task 5 - Validate (knob OFF by default; opt-in verified)
- Confirm default (knob unset) is identical to prior behavior.
- With the knob on, run the full suite 3x under load and confirm green + no new flakes + a wall-clock reduction.
- Do NOT flip the default until the 3x verification passes.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.
- bun run typecheck - tsc clean.
- bun run test:unit - default (knob unset) green, identical to pre-change.
- TMAX_UNIT_CONCURRENCY=2 bun run test:unit - opt-in green; output not interleaved (per-batch headers).
- Run the above opt-in command 3x under load (e.g. while another build/test runs); confirm all green with no daemon-spawn flakes; record the wall-clock reduction.
- rg -n "for \(let i = 0; i < batches" scripts/run-unit-tests.ts - the old serial loop is gone (replaced by the pool); a serial path still exists at concurrency 1.

## Notes
- Reframes GitHub issue #36 (originally an experimental test item). Codex review confirmed parallelization is a behavior change (ordering, fail-fast, output interleaving, resource pressure) and corrected the file count to ~195/~39 batches.
- runBatch is already an isolated Promise<number> with its own SIGKILL stall-guard - the pool change is structural, not per-batch.
- The knob must default to OFF (concurrency 1) so this lands with zero behavior change; opt-in only after the 3x-under-load verification.
- BUG-16 lineage: daemon-spawning tests under concurrent load historically flake. Task 4 (keep heavy batches serial) is the mitigation; if skipped, keep the default at 1 and treat opt-in as experimental.
