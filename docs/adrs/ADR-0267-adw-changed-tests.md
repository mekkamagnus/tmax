# adw pipeline: affected-only unit runs (`--changed`) + full-suite final gate

## Status

Accepted (2026-11-10) — resolves #240 / SPEC-240. Builds on #233 (Bun 1.4.4), #239 (`--parallel` worker mode), and SPEC-065 (worktree isolation).

## Context

The adw build↔test↔patch loop re-runs the test stage on every patch cycle (up to 3×), and each invocation pays the **full** unit suite through a raw `bun test --timeout 30000 test/unit/` call (`adws/adws-modules/tester.ts`). Real workspace data: workspace `01KXV9YTGD`'s unit track ran 3778 tests in **530 s** — per invocation.

Bun 1.4's `bun test --changed=<ref>` runs only test files affected by changed files according to git — and it traces the **import graph**, not just test-file names. Probed on a worktree at 04106c0 (Bun 1.4.4):

- leaf edit (`src/frontend/render/width.ts`): `--changed: running 34/272 test files` over the wrapper-equivalent list — 400 tests green in **79.7 s** serial / **15.7 s** `--parallel` (the flags compose: identical selection).
- core-util edit (`src/utils/task-either.ts`): fans out to **275/323** files (~85 %) — granularity follows the import graph; core-util diffs degrade gracefully toward full-suite cost, never beyond it.
- clean worktree: `no changed files, nothing to run`, exit 0, `Ran 0 tests` — the loop's ok condition accepts it and the final gate carries the verdict. Composes with an explicit file list too.

A full-suite run on every loop iteration would negate the win (79 s + 530 s > 530 s on the happy path); the issue scopes it as **one full-suite run at the end of the pipeline** as the final gate.

Three probed facts then forced a scope correction beyond the literal issue text:

1. **Serial raw runs are not viable on this host.** A real serial full run exceeded the 20-min `STAGE_RUN_TIMEOUT_MS` (exit −1, partial output parsed as `passed: 0, failed: 2`, 1 202 s — a false-red on a green suite); a serial run over just the 272 wrapper-scope files stalled past 500 s (the BUG-72-class cumulative stall the wrapper's own docs describe).
2. **The raw recursive scope is red on a pristine main.** A/B-proven at 04106c0 with and without this change — an identical 7 failures (`adw-process-cleanup` ×3, `tmax-use` instance/client ×4), serial **and** parallel. The `test:unit` wrapper never sees them: it excludes `adw-*` by name and its non-recursive scan never enters `test/unit/tmax-use/`. A final gate over the recursive scope could never pass on main.
3. **The wrapper's flags are the proven-green config — and the wrapper is not serial.** `scripts/run-unit-tests.ts` spawns `bun test --dots --timeout 60000 --parallel <explicit top-level file list>`: 3 584 tests / 272 files green in ~121 s. The adw call site must keep spawning `bun test` directly (the wrapper *process* as a grandchild keeps the process group alive and defeats drain-safe output collection — the long-standing comment there), but its **flags and file selection** are the right ones to adopt: `--parallel` (#239 worker mode; per-worker daemon-socket safety comes from the worker-token fixtures in the suite) and `--timeout 60000` (the wrapper's measured value: server/socket tests far out-run their isolated time under full-suite load).

## Decision

1. **Loop iterations run affected-only.** `runUnitTrack` takes `opts.changedRef`; every suite invocation inside the resolve loop passes `--changed=<ref>` (resolver edits extend the diff, so the affected set recomputes each iteration). The ref is `deriveChangedRef`: the SPEC-065 worktree's recorded `base_sha`, used only when `ADW_WORKTREE` is set **and** the workspace state records it — standalone runs and legacy workspaces keep full-suite behavior.
2. **Wrapper-equivalent invocation, raw spawn.** Loop and gate share `bunUnitArgs(unitFiles, changedRef?)` → `bun test --dots --timeout 60000 --parallel [--changed=<ref>] <files>`, with `unitTestFiles(cwd)` applying the wrapper's exact selection rule: top-level `test/unit/*.test.ts`, `adw-*` excluded, subdirectories excluded. The gate therefore enforces precisely the scope CI's `test:unit` job enforces, and is green on main (proven: real run below).
3. **One full-suite final gate at pipeline end.** The orchestrator gains an optional `runFinalGate` deps entry (always wired in production; its absence logs a loud stderr warning) invoking `adw-test.ts --full-gate` — a single full raw `bun test` run, no tracks, no resolve loop. It runs in the `patchVerdict === "pass"` branch **after** the implementation commit (clean tree) and **before** patch-review is marked complete, `--merge`, and finalize — a red suite can never land on main. The gate owns no workspace state (events only — the orchestrator owns state, and a standalone gate probe must not clobber an existing workspace), and its green condition requires `passed > 0`: a 0-test run is red, never a vacuous green.
4. **A red gate stops the line.** Gate failure → `final-gate-failed` event, `failed_stage: "final-gate"`, pipeline failed. It never routes back into build automatically (the loop's affected-only runs can't see failures outside the affected set, so self-healing them through build would burn LLM iterations blind). Resume re-runs patch-review → gate, because patch-review is only marked complete after a green gate.
5. **Observability.** `unit_track` events record `changed_ref` when affected-only mode is active; the gate appends a `final_gate` event (ok/exit/passed/failed/duration) under `agents/{id}/tester/` and writes `final_gate_verdict` into the workspace state.

## Consequences

- Typical patch-cycle unit cost drops from ~530 s per iteration toward the affected subset (measured 79.7 s serial / 15.7 s parallel for a leaf-module diff), with exactly one ~2 min full run per pipeline.
- The pipeline's unit scope now **matches `test:unit` by design** — `adw-*` (the `test:adw` CI job's scope) and `test/unit/tmax-use/` (the e2e track runs the real playbooks) are excluded from both the loop and the gate. This drops 17 adw-* files from every affected set, and it removes the pre-existing red-on-main raw-scope failures (7, A/B-proven at 04106c0) from the gate's blast radius — they remain open problems in their own scopes, not this gate's.
- Known residual: the suite's rare parallel load-flake (`server-daemon-hardening > starting a second server on the same socket rejects`, observed once) now applies to the gate exactly as it already applies to CI's `test:unit`; a flaked gate is resolved by resume, like any red gate.
- Accepted (verify-gate advisory, not addressed structurally): `deriveChangedRef` trusts any non-empty `base_sha` at read time (it is a validated full SHA at write time; a hand-edited state yields a bogus `--changed` ref that bun rejects — a loud red loop iteration, never silent); and `failed_stage: "final-gate"` is a sentinel outside the `StageName` resume table — resume keys on `completed_stages` (pinned: patch-review stays absent after a red gate), not on `failed_stage`.
- Gates: typecheck (src + test) clean; targeted adw suites green (adw-test 57/57, adw-pipeline-loop 48/48 incl. the 4 orchestrator gate pins); new pins mutation-proven (dropping `--dots` or the `adw-*` exclusion kills the args pins; disabling the gate call kills all 4 gate tests); **real `--full-gate` run green**: `final_gate ok=true exit=0 passed=3583 failed=0 duration_ms=121502` — the last `final_gate` event in `agents/GATETEST01/tester/events.jsonl` (the same file records the pre-scope-fix red probe of the raw recursive scope).
