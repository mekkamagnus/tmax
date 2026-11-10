# SPEC-240 — adw pipeline: affected-only unit runs in the build↔test↔patch loop (`--changed`)

Issue: #240 — adw-test re-pays full-suite cost on every patch cycle; Bun 1.4 `bun test --changed=<ref>` runs only test files affected by changed files. Keep a full-suite run at the end of the pipeline as the final gate.
Status: landed (ADR-0267)
Date: 2026-11-10

## Goal

Cut the per-cycle unit cost of the build↔test↔patch loop (up to 3 test-stage invocations per pipeline run) by running only **affected** test files during the loop, while preserving suite-wide correctness with **one** full-suite run at the end of the pipeline as the final gate — before the implementation merge and before the run is declared complete.

## Ground truth (probed on Bun 1.4.4)

**`--changed` semantics** (probed in a worktree at 04106c0):

- diffs `<ref>…working tree` (committed + uncommitted) and traces the **import graph** to affected test files:
  - leaf edit (`src/frontend/render/width.ts`): 36/323 files over the raw recursive dir, **34/272** over the wrapper-equivalent file list — 400 tests green in 79.7 s serial / 15.7 s with `--parallel` (the flags compose: same selection).
  - core-util edit (`src/utils/task-either.ts`): fans out to **275/323** files (~85 %) — granularity follows the import graph; a core-util diff degrades gracefully toward full-suite cost, never beyond it.
  - clean worktree: `--changed: no changed files, nothing to run` / `no test files are affected`, exit 0, `Ran 0 tests` — the loop's `ok` condition (`passed > 0 || exitCode === 0`) treats it as green and the final gate covers the suite. Holds with an explicit file list too (probed).
- `--changed` composes with an **explicit file list** (bun intersects the affected set with the given paths — probed: 34/272 selection).

**The old raw call is not viable as-is.** The pipeline's unit track spawns `bun test --timeout 30000 test/unit/` — recursive, serial, adw-*-included. Three independent failures, all measured on this host:

- **Serial overruns the 20-min stage timeout.** A real serial full run: exit −1, partial output, 1 201 620 ms — a false-red on a green suite. A serial run over just the 272 wrapper-scope files stalled past 500 s (the BUG-72-class cumulative-load stall the wrapper's own docs describe).
- **The raw recursive scope is red on a pristine main.** A/B-proven at 04106c0 with and without this branch's changes — identical 7 failures: `adw-process-cleanup` ×3 and `tmax-use` instance/client ×4, serial **and** parallel. CI never sees them (the `test:unit` wrapper excludes `adw-*` by name and its `readdirSync` never recurses into `test/unit/tmax-use/`). A gate over that scope could never pass.
- **The wrapper's flags are the proven-green config, and the wrapper is not serial.** `scripts/run-unit-tests.ts` spawns `bun test --dots --timeout 60000 --parallel <explicit top-level file list>` — 3 584 tests across 272 files green in ~121 s. The call site must still spawn `bun test` directly (the wrapper *process* as grandchild keeps the process group alive and defeats drain-safe output collection), but its **flags and file selection** are adopted verbatim. `--timeout 60000` (not 30 000) is the wrapper's measured value for server/socket tests under full-suite load.

Known residual: one load-sensitive flake observed once under `--parallel` (`server-daemon-hardening > starting a second server on the same socket rejects`) — identical exposure to CI's `test:unit` job, not introduced here.

## Design

1. **Affected-only loop iterations** — `runUnitTrack` gains `opts.changedRef`; every suite invocation inside the resolve loop passes `--changed=<ref>` (resolver edits extend the diff, so the affected set recomputes each iteration). The ref is `deriveChangedRef`: the SPEC-065 worktree's recorded `base_sha`, used only when `ADW_WORKTREE` is set **and** the workspace state records it — standalone runs and legacy workspaces keep full-suite behavior.
2. **Wrapper-equivalent invocation** — loop and gate share `bunUnitArgs(unitFiles, changedRef?)`: `bun test --dots --timeout 60000 --parallel [--changed=<ref>] <files>`, where `unitTestFiles(cwd)` applies the wrapper's exact selection rule (top-level `test/unit/*.test.ts`, `adw-*` excluded, subdirectories excluded). This makes the gate green-able on main (the wrapper scope is what CI actually gates on) and drops the 17 adw-* files from every affected set.
3. **Full-suite final gate at the end of the pipeline** — in the orchestrator's `patchVerdict === "pass"` branch, **after** the implementation commit and **before** marking patch-review complete / `--merge` / finalize: one full-suite run, invoked as `adw-test.ts --full-gate` via the same spawnStage drain-safe path. Gate green → completed as today. Gate red → `final-gate-failed` event, `failed_stage: "final-gate"`, pipeline failed (patch-review stays incomplete so resume re-runs patch-review → gate). The gate never routes back into build automatically — a red full suite stops the line for operator review. The gate writes **no workspace state** (events under `agents/{id}/tester/` only — the orchestrator owns state; a standalone `--full-gate` run against an existing workspace must not clobber its `base_sha`/`completed_stages`), and its green condition requires `passed > 0` — a 0-test run (empty/missing listing) is red, never a vacuous green (the loop keeps the lenient `exitCode === 0` form because a clean-worktree `--changed` no-op legitimately runs 0 tests there).
4. **Observability** — `unit_track` events record `changed_ref` when affected-only mode is active; the gate appends a `final_gate` event (ok/exit/passed/failed/duration) under `agents/{id}/tester/` and writes `final_gate_verdict` into the workspace state.

## Completion criteria

1. In an orchestrated worktree with a recorded `base_sha`, every unit-loop suite invocation passes `--changed=<base_sha>`; without a worktree/base_sha the invocation has no `--changed` flag. The invocation carries the wrapper's flags and file selection (top-level files only, `adw-*` excluded) — unit-pinned via mocked `deps.runRaw` args against a fixture tree.
2. The clean-worktree edge (0 changed files, exit 0, 0 tests) resolves green in the loop (unit-pinned) — the final gate carries the suite verdict.
3. After a passing patch-review, exactly one full-suite gate runs before completion: green → `completed`; red → `failed` with `failed_stage: "final-gate"`, patch-review not marked complete, and `--merge` never attempted (unit-pinned with mock deps).
4. Real evidence recorded: the probed `--changed` numbers above (leaf/core-util/clean, including explicit-file-list composition) plus one real `--full-gate` invocation resolving green — the **last** `final_gate` event in `agents/GATETEST01/tester/events.jsonl` (the same file also holds the pre-scope-fix red probe; read the last event): `ok=true exit=0 passed=3583 failed=0 duration_ms=121502`.
5. ADR-0267 + index line.

## Out of scope

- adw-* tests: excluded from the pipeline's unit track **by design** now (the wrapper's own rule; they are the `test:adw` CI job's scope, and `adw-process-cleanup` is red on main there — pre-existing, unrelated to this change).
- `test/unit/tmax-use/*.test.ts`: outside the wrapper's non-recursive scan and outside this gate (the pipeline's e2e track runs the real `test:tmax-use` playbooks); their red-on-main state is a separate problem.
- `test:tmax-use` e2e track (already scoped, unaffected).
