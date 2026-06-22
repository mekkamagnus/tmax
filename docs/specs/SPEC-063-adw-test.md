# Feature: adw-test — Pipeline Test Stage (unit + e2e)

## Feature Description

This spec has two deliverables: **(1) a new `adw-test` pipeline stage** and **(2) the removal of the legacy Python UI harness**, with tmax-use + its playbooks becoming the project's sole e2e mechanism.

**Deliverable 1 — the `adw-test` stage.** A new adw pipeline stage inserted between **build** and **patch-review**. It runs the project's unit tests and e2e tests as a dedicated, observable stage with a resolve-then-rerun loop for failures, then hands off to patch-review with a structured results bundle.

The stage has two sequential tracks:

1. **Unit track** — runs `bun run test:unit` (`bun test --timeout 30000 test/unit/`), parses the structured test output, and on failure dispatches `claude -p /implement` per failing test to resolve it, then reruns the full suite. Caps at **2 iterations** (one initial run + up to 2 resolve-then-rerun cycles).
2. **E2E track** — runs only after the unit track passes. Walks `tmax-use/playbooks/*.yaml` and `tmax-use/tests/*.tmax-use.ts` by invoking `bin/tmax-use test`, parsing its exit code + report artifacts. On failure, dispatches a resolver and reruns, up to **2 iterations**.

Both tracks write events under `agents/{id}/tester/` and persist a normalized `results.json` summarizing pass/fail counts, iterations, and artifact paths. The patch-review stage consumes the bundle as additional audit input.

The stage slots into the orchestrator as a fifth subprocess:

```
plan → spec-review → build → test → patch-review
                       ↑              ↓
                       └── retry build on patch-review GAPS, then rerun test before patch-review
```

**Deliverable 2 — remove the Python UI harness.** The legacy Python UI test harness is fully removed: the entire `test/ui/` tree (25 Python test files, the 13-module `tmax_harness/` package, `run_python_suite.py`, `.venv`, `pyproject.toml`, `uv.lock`, and shell launchers), the 4 `package.json` scripts that drive it (`test:daemon`, `test:ui`, `test:ui:renderer`, `test:ui:helpers`), `rules/ui-testing.md`, and every live reference in `AGENTS.md` / `CLAUDE.md` / `README.md` / `.github/workflows/ci.yml` / live `.zcode` skill support files. tmax-use + its playbooks replace it completely. With the harness gone, the `/bug`, `/feature`, `/chore` SDLC skills carry **only** the tmax-use option (the outdated `uv run pytest` line is deleted, not left as a fallback).

## User Story

As a **developer running the adw pipeline**
I want to **run unit and e2e tests as a dedicated pipeline stage with automatic failure resolution and a structured results bundle**
So that **patch-review audits against a known-good test state, broken builds are caught before audit, and test failures are self-healed without manual intervention.**

## Problem Statement

Today the pipeline runs `bun run typecheck:src` + `bun run test:unit` only as silent gates *inside* patch-review (`patch-reviewer.ts:runGates`). This has three problems:

1. **Test failures are buried.** Gates run inside the audit step, so a failing unit test produces the same surface as a spec-violation — the operator has to read the audit verdict to discover a simple typo in a test. There is no dedicated stage, no resolve loop, no structured artifact.
2. **No e2e in the pipeline.** tmax-use playbooks (`tmax-use/playbooks/*.yaml`, 24 files) and TypeScript e2e tests (`tmax-use/tests/*.tmax-use.ts`, 4 files) are never run by the pipeline. `patch-reviewer.ts:runGates` has an optional tmax-use gate, but it does not resolve failures — it just records them for the auditor. The build can "pass" while every visual playbook is red.
3. **No self-healing.** A flaky or genuinely-broken test fails the whole pipeline. There is no resolve-then-rerun loop (the build↔patch loop only fixes *spec gaps*, not test failures).
4. **Two overlapping e2e systems.** tmax-use (TypeScript, headless-first, playbook-driven) and the legacy Python UI harness (`test/ui/` — 25 Python tests, a 13-module `tmax_harness` package, `run_python_suite.py`, `uv`-managed) cover the same editor behavior in two languages. SPEC-061 explicitly positioned tmax-use as the successor ("the Python UI harness continues as the primary UI test suite. tmax-use is a separate, complementary system"), but now that tmax-use is functional the duplication is pure cost: two test runners, two assertion vocabularies, a Python toolchain (`uv`, `pytest`) the rest of the project doesn't use, and 4 `package.json` scripts + `rules/ui-testing.md` + CI jobs pointing at the legacy harness. This spec deletes the Python harness so tmax-use is the sole e2e mechanism.

## Solution Statement

Build `adw-test.ts` as a dispatcher mirroring `adw-build.ts` / `adw-patch-review.ts` (shared structure: `parseArgs` → `runTest()` → `main()` → `import.meta.main`, dependency-injected module, `<id> <verdict> <spec-path>` stdout contract). It:

- Resolves the spec path or adw-id (reuses `resolveInputFrom` from `adw-patch-review.ts`'s pattern).
- Runs the **unit track** with a 2-iteration resolve-then-rerun loop, gated on `bun run test:unit` exit code + parsed pass/fail.
- Only if unit passes, runs the **e2e track** with its own 2-iteration loop, gated on `bun run test:tmax-use` exit code.
- Writes a structured `agents/{id}/tester/results.json` for patch-review consumption.
- Prints `<id> <pass|gaps> <spec-path>` on the stdout contract (matching patch-review), where `gaps` means ≥1 track still failing after exhausting its iterations.
- Updates the orchestrator (`adw-plan-review-build-patch.ts`) to insert the test stage between build and patch-review, with build↔test and test↔patch retry adjacency preserved.

The resolve loop dispatches `claude -p /implement` with a narrow, focused prompt (the failing test name + its error output) — not a full `/implement` against the spec. This keeps resolution surgical and fast.

**Deliverable 2 — harness removal.** Delete `test/ui/` wholesale, drop the 4 harness `package.json` scripts, delete `rules/ui-testing.md`, and scrub every live reference in `AGENTS.md` / `CLAUDE.md` / `README.md` / `.github/workflows/ci.yml` / live `.zcode` skill support files. The `/bug`, `/feature`, `/chore` skills keep **only** the tmax-use option. No migration of individual Python tests — tmax-use's existing playbooks (24 files in `tmax-use/playbooks/`) already cover the same editor behaviors; if a gap surfaces post-removal, a separate spec adds the playbook. Historical specs/ADRs that *document* past harness decisions are left untouched (they record history, not current behavior).

## Relevant Files

Use these files to implement the feature:

### Existing Files to Read (reference, not modify)

- **`adws/adw-build.ts`** — Dispatcher template. Copy its structure: USAGE constant, `parseArgs`, `adwId()`, `appendEvent()`, `writeState()`, `run`/`runRaw`/`runCapture` TaskEither subprocess helpers, `resolveInputFrom` + `resolveInput`, `runBuild` callable core, `main()` CLI wrapper, `import.meta.main` guard. The new `adw-test.ts` should be structurally a sibling.
- **`adws/adw-patch-review.ts`** — Closer template because it already runs gates (typecheck + unit) via `runRaw` and records `GateResult` objects. The test stage reuses the same `runRaw` pattern and the same `<id> <pass|gaps> <spec-path>` stdout contract.
- **`adws/adws-modules/patch-reviewer.ts`** — `PatchReviewerDeps` interface (`run`, `runRaw`, `runCapture`) is the exact dependency-injection shape the new module should mirror. `runGates()` (lines 363–414) shows the existing unit + optional tmax-use gate execution; the new stage replaces the in-audit gate with a standalone stage and adds the resolve loop. `GateResult` type is reusable.
- **`adws/adws-modules/builder.ts`** — `BuilderDeps` + `build()` show how a dependency-injected module wraps a `claude -p` subprocess call with tee-to-file logging and stream-json result parsing. The resolve loop's per-test `/implement` call should mirror this.
- **`adws/adw-plan-review-build-patch.ts`** — The orchestrator that must be updated to insert the test stage. `StageName` type (line 56), `STAGE_ORDER` (line 57), `PipelineDeps` (lines 375–380), `realDeps` (lines 383–437), and `runPipeline` (lines 481–763) all need a new `test` stage between `build` and `patch-review`. The existing build↔patch loop (lines 678–752) becomes build→test→patch-review on every pass through the loop: after a patch-review `gaps` retry build succeeds, rerun the test stage before returning to patch-review.
- **`docs/specs/SPEC-061-tmax-use.md`** — tmax-use runner contract. `bin/tmax-use test` exits 0 on all-pass, 1 on any failure, writes HTML + JUnit to `--output`. The e2e track wraps this.
- **`package.json`** — Scripts already exist: `test:unit` (`bun test --timeout 30000 test/unit/`) and `test:tmax-use` (`bin/tmax-use test`). No new scripts needed.
- **`src/utils/task-either.ts`** — `Either`, `TaskEither`, `TaskEitherUtils`. Used throughout for subprocess composition.

### Existing Files to Modify

- **`adws/adw-plan-review-build-patch.ts`** — Insert `test` into `StageName`, `STAGE_ORDER`, `PipelineDeps`, `realDeps`, and the `runPipeline` sequence. The orchestrator header comment (lines 2–42) and USAGE (lines 63–91) get a `test` stage added.
- **`.zcode/skills/bug/SKILL.md`** — Add a "## Tests & E2E Playbooks" section to the `Plan Format` template so every bug spec produced by `/bug` carries test + e2e-playbook authoring instructions. **Only the tmax-use option remains** — delete the `cd app/server && uv run pytest` line.
- **`.zcode/skills/feature/SKILL.md`** — Same section added to the feature `Plan Format`; same removal.
- **`.zcode/skills/chore/SKILL.md`** — Same section added to the chore `Plan Format`; same removal.
- **`package.json`** — Remove the 4 Python harness scripts (`test:daemon`, `test:ui`, `test:ui:renderer`, `test:ui:helpers`). Keep `test:unit`, `test:integration`, `test:tmax-use`. (If `test:daemon` behavior — daemon API integration — is worth preserving, it migrates to a tmax-use playbook in a separate spec; here it is simply removed.)
- **`AGENTS.md`** — Remove the `test:daemon` / `test:ui:renderer` lines in §8 (Verify Before Reporting Complete), the `rules/ui-testing.md` row in the path-scoped rules table, and the `uv` entry in §5 (Installed CLI Tools). Add `bun run test:tmax-use` to §8 as the e2e validation command. Update the ADW pipeline section from `plan → spec-review → build → patch-review` / 4-stage wording to `plan → spec-review → build → test → patch-review` / 5-stage wording.
- **`CLAUDE.md`** — Mirror every AGENTS.md change (this file is the authoritative workflow doc; AGENTS.md mirrors it), including the ADW pipeline section's stage list and 5-stage wording.
- **`README.md`** — Replace the three Python-harness lines under "Available Scripts" (`test:daemon`, `test:ui:renderer`, `test:ui`) with `bun run test:tmax-use`. Update the "Testing" sub-bullets if any reference `test/ui/`.
- **`.github/workflows/ci.yml`** — Remove the `bun run test:daemon` and `bun run test:ui:renderer` jobs/steps. Add (or keep, if present) a `bun run test:tmax-use` job so CI exercises the playbooks.
- **`docs/specs/SPECS_INDEX.md`** — Add SPEC-063 entry under "ADW Pipeline & Testing".

### Files to Delete

- **`test/ui/`** — The entire tree: 25 Python test files (`test/ui/tests/*.py`), the 13-module `test/ui/tmax_harness/` package (`harness.py`, `client.py`, `editor.py`, `session.py`, `assertions.py`, `operations.py`, `queries.py`, `input.py`, `config.py`, `tlisp_escape.py`, `types.py`, `__init__.py`), `run_python_suite.py`, `pyproject.toml`, `uv.lock`, `.venv/`, `.pytest_cache/`, `run-tests.sh`, `start-ui-test.sh`, and the docs (`README.md`, `QUICKSTART.md`, `INTERACTIVE.md`, `TEST_STATUS.md`). Also the shell-based `*.test.sh` files alongside the Python tests — they are part of the same harness.
- **`rules/ui-testing.md`** — The path-scoped rule for `test/ui/**/*`. With the directory gone, the rule is dead. (Leave `rules/testing.md` — it covers `test/**/*` generally, including the new `test/unit/adw-test.test.ts`.)
- **`docs/ui-test-refactoring-opportunities.md`** and **`docs/ui-test-python-vs-bash-analysis.md`** — Analysis docs for the now-deleted harness. (Confirm they reference only the Python harness before deleting; if they contain generally-applicable testing guidance, edit instead.)

### Dangling References to Scrub (live docs only)

After deletion, grep the live (non-historical) tree for `test:ui`, `test:daemon`, `run_python_suite`, `tmax_harness`, `test/ui`, `uv run pytest`, and `demo-runner.py` and update each reference. Known live references at the time of this spec:
- **`.zcode/skills/demo/SKILL.md`** — References `python3 demos/demo-runner.py ...` throughout. The demo runner (`demos/demo-runner.py`) is **out of scope** for this spec (it's a visual demo tool, not a test harness), but if its dependency on the harness surfaces, note it. Leave the demo skill alone unless deletion breaks it.
- **`.zcode/skills/tmax-patch-review/SKILL.md`** (line 41) and **`.zcode/skills/tmax-spec-loop/SKILL.md`** (lines 16, 128) — Reference `bun run test:daemon` as a conditional gate. Replace with `bun run test:tmax-use` (or remove the conditional daemon gate if tmax-use covers it).
- **`.zcode/skills/tmax-patch-review/scripts/audit.ts`**, **`.zcode/skills/tmax-spec-loop/scripts/run.ts`**, and live reference prompt/checklist markdown under those skill directories — also scrub `test:daemon`, `test:ui:renderer`, `test/ui`, and Python harness references. Updating only the top-level `SKILL.md` files is insufficient; the grep validation must pass across live `.zcode` TypeScript and markdown support files.
- **`adws/adw-run-e2e.ts`** — Legacy standalone e2e runner (1025 lines). SPEC-061 noted tmax-use is its successor. Removing it is **optional** in this spec (it has no `package.json` script and isn't wired into the pipeline), but recommended — note the decision in the implementation.
- **Historical specs/ADRs** (`docs/specs/archive/*`, `docs/specs/SPEC-0*-*.md` describing past work, `docs/adrs/ADR-*`) — **Do NOT edit.** These document decisions made at the time; rewriting history is out of scope. Only the live docs above are scrubbed.

### New Files

- **`adws/adw-test.ts`** — The dispatcher. CLI entry, arg parsing, state/event writers, subprocess plumbing, callable `runTest()` core. Mirrors `adw-patch-review.ts` structure.
- **`adws/adws-modules/tester.ts`** — The LLM interface module. Owns: `ensureAvailable` (claude guard), `runUnitTrack`, `runE2eTrack`, `resolveUnitTest`, `resolveE2eTest`, output parsing, results.json schema + writer. Dependency-injected (`TesterDeps`), unit-testable, no CLI.
- **`test/unit/adw-test.test.ts`** — Unit tests for the dispatcher + module (arg parsing, track sequencing, resolve loop, results.json shape).

## Implementation Plan

### Phase 1: Tester module (`adws/adws-modules/tester.ts`)

Build the dependency-injected module that owns the two tracks, the resolve loop, and the results bundle. Pure TaskEither composition over injected `run`/`runRaw`/`runCapture` — no `child_process` import, fully mockable.

### Phase 2: Dispatcher (`adws/adw-test.ts`)

Build the CLI dispatcher mirroring `adw-patch-review.ts`: USAGE, parseArgs, adwId, appendEvent, writeState, runRaw/runCapture, resolveInput, runTest core, main, import.meta.main guard.

### Phase 3: Orchestrator integration + skill updates

Insert the stage into `adw-plan-review-build-patch.ts`, then update `/bug`, `/feature`, `/chore` skills so every new spec carries test + e2e-playbook authoring instructions (tmax-use only — no Python option remains).

### Phase 4: Remove the Python UI harness

Delete `test/ui/`, `rules/ui-testing.md`, and the harness `package.json` scripts; scrub dangling references in AGENTS.md / CLAUDE.md / README.md / ci.yml / live `.zcode` patch-review/spec-loop skill files and support scripts; verify tmax-use covers the same editor behaviors.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Tester module — types and dependency guard

- Create `adws/adws-modules/tester.ts`.
- Define `TesterDeps` interface mirroring `PatchReviewerDeps`:
  ```ts
  export interface TesterDeps {
    run: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, string>;
    runRaw: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, RawRunResult>;
    runCapture: (cmd: string, args: string[], opts: { cwd?: string; teeTo: string; liveLabel?: string }) => TaskEither<string, string>;
  }
  ```
  Reuse the `RawRunResult` shape from `patch-reviewer.ts` (or import it).
- Define track types:
  ```ts
  export interface TrackResult {
    ok: boolean;             // true iff exit 0 and parsed pass count > 0 with zero fails
    exitCode: number;
    passed: number;
    failed: number;
    durationMs: number;
    iterations: number;      // how many times the suite ran (1 = initial only)
    failures: TestFailure[]; // parsed from the last iteration's output
    output: string;          // last iteration's combined stdout+stderr (truncated to 20k)
    reportDir?: string;      // e2e track only: tmax-use --output dir
  }
  export interface TestFailure {
    name: string;            // "file.ts > suite > test name"
    message: string;         // error/assertion output (truncated to 2k)
  }
  export interface TestStageResult {
    unit: TrackResult;
    e2e?: TrackResult;       // undefined when unit failed (e2e skipped)
    e2eSkipped: boolean;     // true when e2e did not run because unit failed
    verdict: "pass" | "gaps";
  }
  ```
- Define `MAX_UNIT_ITERATIONS = 2` and `MAX_E2E_ITERATIONS = 2` as exported consts (the "2 iterations for each failing test" requirement — see Notes for the exact meaning).
- Implement `ensureAvailable(deps, cwd)` — claude guard identical to the other modules (probes `claude --version`).

### Step 2: Tester module — output parsing

- Implement `parseBunTestOutput(stdout: string, stderr: string): { passed: number; failed: number; failures: TestFailure[] }`.
- Bun's test runner prints a summary line on completion. Parse the final summary to get pass/fail counts. On failure, Bun prints each failing test with a header like `<file path>` then `✗ <test name>` followed by the error block. Extract `name` (file + test) and `message` (the assertion/error text up to the next test or the summary).
- Be defensive: if the summary line is unparseable, fall back to counting `✗` / `✓` occurrences; never throw — return zeros with `failed: 0` and surface a note in the result's output.
- Implement `parseTmaxUseExitCode(result: RawRunResult, reportDir?: string): { ok: boolean; passed: number; failed: number }` — tmax-use's runner exits 0/1 and writes a JUnit XML + HTML report. For the structured counts, parse the JUnit XML from `reportDir` if present. Handle both JUnit shapes: prefer root `<testsuites tests="N" failures="M" errors="E">` counts when present; otherwise sum every `<testsuite ... tests="N" failures="M" errors="E">` element so multi-playbook reports are counted correctly. Treat `failed = failures + errors`; derive `passed = tests - failed`. If no JUnit XML is found, derive `ok` from exit code and set passed/failed to 0 (unknown).
- Unit tests in `test/unit/adw-test.test.ts`:
  - `parseBunTestOutput` on a passing summary (`X pass / Y expect`).
  - `parseBunTestOutput` on a failing summary with 2 failures → 2 `TestFailure` entries with names + messages.
  - `parseBunTestOutput` on malformed output → zeros, no throw.
  - `parseTmaxUseExitCode` on exit 0 → `ok: true`.
  - `parseTmaxUseExitCode` on exit 1 with JUnit XML present → counts parsed.

### Step 3: Tester module — unit track with resolve loop

- Implement `runUnitTrack(deps, cwd, agentsDir, id, model: string = TEST_MODEL): TaskEither<string, TrackResult>`.
- Loop body (max `MAX_UNIT_ITERATIONS` cycles beyond the initial run, so up to `1 + MAX_UNIT_ITERATIONS` total suite executions):
  1. `runRaw("bun", ["run", "test:unit"], { cwd })`.
  2. Parse output via `parseBunTestOutput`. Record `exitCode`, `passed`, `failed`, `failures`, `output`.
  3. If `ok` (exit 0 and `failed === 0`) → return `Right(TrackResult)` with `iterations` set.
  4. If failing and iterations remain → for each `TestFailure`, call `resolveUnitTest(deps, cwd, agentsDir, id, failure, model)`. Then loop back to step 1.
  5. If failing and no iterations remain → return `Right(TrackResult)` with `ok: false` (do NOT return Left — a failing track is a track result, not a stage error).
- `iterations` counter: starts at 0, incremented each time the suite runs. The cap is the *resolve-then-rerun* iteration count — i.e. the suite runs once initially, then up to `MAX_UNIT_ITERATIONS` more times after resolve attempts. So total suite runs ≤ `1 + MAX_UNIT_ITERATIONS`.
- Implement `resolveUnitTest(deps, cwd, agentsDir, id, failure, model: string = TEST_MODEL): TaskEither<string, void>`:
  - Build a focused prompt: "The following unit test is failing. Fix the root cause (the code under test, not the test, unless the test itself is wrong). Failing test: `<name>`. Error output:\n```\n<message>\n```\nDo not touch unrelated files."
  - Dispatch `claude -p --model <model> --verbose --output-format stream-json <prompt>` via `deps.runCapture`, tee to `agents/{id}/tester/unit-resolve-{iteration}-{sanitizedName}.jsonl`.
  - Parse the stream-json result line (reuse `parseSkillResult` logic from `builder.ts` — extract the shared helper or re-implement locally). Left if claude fails; the loop continues to the next failure regardless (best-effort resolution).
  - Never throws — wrap each resolve in try/catch so one bad resolve does not abort the loop.
- `TEST_MODEL = "glm-5.1"` (matches `BUILD_MODEL` / `PATCH_REVIEW_MODEL` — stability over 5.2). `--model` in `adw-test.ts` overrides this value and must be threaded through `runUnitTrack`, `runE2eTrack`, `resolveUnitTest`, and `resolveE2eTest`; do not hard-code `TEST_MODEL` inside track calls after parsing the override.

### Step 4: Tester module — e2e track with resolve loop

- Implement `runE2eTrack(deps, cwd, agentsDir, id, model: string = TEST_MODEL): TaskEither<string, TrackResult>`.
- The e2e track walks the playbook + test directory by invoking the tmax-use runner, which itself globs `tmax-use/playbooks/*.yaml` and `tmax-use/tests/*.tmax-use.ts`. The stage does not enumerate playbooks itself — it delegates to `bin/tmax-use test`.
- Skip detection: if `tmax-use/playbooks/` and `tmax-use/tests/` are both empty/missing, return `Right(TrackResult)` with `ok: true` and a sentinel (e.g. `passed: 0, failed: 0, output: "no tmax-use targets"`) — mirrors the existing `hasTmaxUseTargets` skip in `patch-reviewer.ts`.
- Loop body (max `MAX_E2E_ITERATIONS` cycles beyond the initial run):
  1. `reportDir = join(agentsDir, id, "tester", "e2e-report-it{N}")`.
  2. `runRaw("bun", ["run", "test:tmax-use", "--output", reportDir, "--reporter", "all"], { cwd })`.
  3. Parse via `parseTmaxUseExitCode(result, reportDir)`, reading the JUnit XML from `reportDir` if present for counts.
  4. If `ok` → return `Right(TrackResult)` with `reportDir`.
  5. If failing and iterations remain → call `resolveE2eTest(deps, cwd, agentsDir, id, reportDir, outputExcerpt, model)` with the failed-playbook output. Then loop.
  6. If failing and no iterations remain → return `Right(TrackResult)` with `ok: false`.
- Implement `resolveE2eTest(deps, cwd, agentsDir, id, reportDir, outputExcerpt, model: string = TEST_MODEL): TaskEither<string, void>`:
  - Read the JUnit XML + the last N lines of the combined output from the prior run to identify which playbook/test failed.
  - Prompt: "The tmax-use e2e run failed. Review the report at `<reportDir>` and the failing playbook/test output below. Fix the root cause (the editor code or the playbook — do not weaken assertions unless the assertion is genuinely wrong). Output:\n```\n<excerpt>\n```"
  - Dispatch `claude -p /implement`-style with `--model <model>` (same as unit resolve), tee to `agents/{id}/tester/e2e-resolve-it{N}.jsonl`.
  - Best-effort; never throws.

### Step 5: Tester module — results bundle writer

- Implement `writeResults(agentsDir, id, result: TestStageResult): TaskEither<string, void>`:
  - Writes `agents/{id}/tester/results.json` — the normalized `TestStageResult` plus a top-level `adw_id`, `written_at` ISO timestamp.
- Implement `buildTestStageResult(unit: TrackResult, e2e: TrackResult | undefined, e2eSkipped: boolean): TestStageResult`:
  - `verdict = "pass"` iff `unit.ok && (e2e === undefined ? e2eSkipped : e2e.ok)`. Otherwise `"gaps"`.
  - Pure function; unit-tested directly.

### Step 6: Dispatcher — `adw-test.ts` skeleton

- Create `adws/adw-test.ts` mirroring `adw-patch-review.ts`:
  - File header comment (purpose, usage examples, exit codes, file layout).
  - `import` block (spawn, fs, node:fs/promises, path, Either/TaskEither, tester module exports, `findWorkspaceBySpecPath`).
  - `PROJECT_ROOT`, `AGENTS_DIR`, `SPECS_DIR` consts.
- Define `USAGE`:
  ```
  Usage: bun adws/adw-test.ts [--model <id>] [--id <id>] <spec-path-or-adw-id>

  Runs unit tests (bun run test:unit) then e2e tests (bun run test:tmax-use) as
  an adw pipeline stage with a 2-iteration resolve-then-rerun loop per track.
  Prints "<id> <pass|gaps> <spec-path>" on success. E2e is skipped if unit fails.

    --model <id>   Override the default resolve model (glm-5.1).
    --id <id>      Use a specific workspace id (default: reuse discovered workspace).
    <spec-path>    A docs/specs/{SPEC,BUG,CHORE}-*.md path.
    <adw-id>       A 10-char ULID-timestamp id from a prior adw-build run.

  State: ./agents/{id}/adw-state.json; events: ./agents/{id}/tester/events.jsonl;
  results bundle: ./agents/{id}/tester/results.json.
  ```
- Define `ParsedArgs` + `parseArgs` (identical shape to `adw-patch-review.ts` parseArgs).
- Copy `adwId()`, `appendEvent()`, `writeState()`, `run`, `runRaw`, `runCapture`, `ADW_ID_RE`, `resolveInputFrom`, `resolveInput` verbatim from `adw-patch-review.ts`. (These are intentionally duplicated per-dispatcher — the existing dispatchers do the same; do not extract a shared module in this spec.)

### Step 7: Dispatcher — `runTest()` core

- Implement `runTest(input, modelOverride?, id?): Promise<Either<string, TestOutcome>>` mirroring `runPatchReview`.
- `TestOutcome = { id: string; verdict: "pass" | "gaps"; specPath: string }`.
- Pipeline (TaskEither chain):
  1. Resolve input (hoisted before id minting — same as patch-review).
  2. Resolve workspace id (explicit --id > adw-id input > discovered > fresh mint).
  3. `ensureAvailable(deps, PROJECT_ROOT)` (Claude is required before any track runs because resolver availability is part of the stage contract).
  4. Write initial state (`status: "running"`) + start event.
  5. Unit track: `runUnitTrack(deps, PROJECT_ROOT, AGENTS_DIR, id, modelOverride ?? TEST_MODEL)` with a phase callback that writes `[test] unit (iteration N/M)` to stderr (mirrors patch-review's `writePhase`). Record `unit` event per iteration.
  6. If unit `!ok` → skip e2e, write `e2e_skipped` event, build result with `e2eSkipped: true`.
  7. If unit `ok` → e2e track: `runE2eTrack(..., modelOverride ?? TEST_MODEL)`. Record `e2e` event per iteration.
  8. `buildTestStageResult(unit, e2e, e2eSkipped)`.
  9. `writeResults(...)`. Record `result` event with verdict.
  10. Write final state (`status: verdict`). Return `Right(TestOutcome)`.
- On any `Left` (spawn failure, claude missing): record `error` event + failed state, return `Left`. Track-result failures (failing tests after exhausting iterations) are `Right` with `verdict: "gaps"`, NOT `Left` — a test failure is a stage outcome, not a stage error. This distinction is critical and must be unit-tested.
- `main()` + `import.meta.main` guard: print `<id> <verdict> <spec-path>` on Right, error to stderr + exit 2 on Left, exit 1 on usage error.

### Step 8: Orchestrator integration — `adw-plan-review-build-patch.ts`

- Update `StageName` to `"plan" | "review" | "build" | "test" | "patch-review"`.
- Update `STAGE_ORDER` to `["plan", "review", "build", "test", "patch-review"]`.
- Update `PipelineDeps` to add:
  ```ts
  runTest: (specPath: string, modelOverride: string | undefined, id: string) => Promise<Either<string, TestOutcome>>;
  ```
  where `TestOutcome` is imported or re-defined (matching the dispatcher's stdout contract: `<id> <pass|gaps> <spec-path>`).
- Update `realDeps.runTest` to spawn `adw-test.ts` and parse the 3-token stdout (same pattern as `runPatchReview`).
- Update `runPipeline`:
  - After stage 3 (build) succeeds and before stage 4 (patch-review), insert the test stage: `deps.runTest(specPathForLater, args.modelOverride, id)`.
  - Preserve the invariant after every patch-review retry: when patch-review returns `gaps` and the orchestrator runs another build, that retry build must be followed by `deps.runTest(...)` before the next patch-review attempt. Do not route retry builds directly back to patch-review.
  - On `Left` → stage-error, finalize as failed (same as other stages).
  - On `Right` with `verdict: "gaps"` → record a `stage-complete` event with `verdict: "gaps"`, write a warning to stderr, but **continue** to patch-review (test gaps are audit input, not a hard stop — matches the existing philosophy where patch-review GAPS doesn't hard-stop the pipeline either). Patch-review sees the failing tests in the results bundle and factors them into its verdict.
  - On `Right` with `verdict: "pass"` → record `stage-complete`, continue to patch-review.
  - Update all `N/4` stderr progress messages to `N/5` (now 5 stages).
- Update `OrchestratorState` / `WorkspaceState` / `ResumeContext` to carry `test` in `completed_stages` and `failed_stage`. When a patch-review `gaps` retry starts a new build attempt, clear or invalidate the prior `test` completion for that attempt so resume cannot skip the required post-build test rerun.
- Update `loadWorkspace` agent-inference: `if (agents.includes("tester")) completedStages.push("test")`.
- Update the orchestrator header comment block (stages list, file layout) and USAGE to mention the test stage.
- Update `--from-stage` validation to accept `"test"`.

### Step 9: Skill updates — `/bug`, `/feature`, `/chore`

- In each of `.zcode/skills/bug/SKILL.md`, `.zcode/skills/feature/SKILL.md`, `.zcode/skills/chore/SKILL.md`, add a new section to the `Plan Format` markdown template, immediately before the `## Validation Commands` section. The section is identical across all three skills (the authoring instructions are skill-agnostic):

  ````md
  ## Tests & E2E Playbooks

  This feature/chore/bug must be verified by both unit tests and a tmax-use e2e playbook. Author them as part of the implementation.

  ### Unit tests
  - Identify which `test/unit/*.test.ts` files need new or updated tests for the behavior changed by this work.
  - Each new behavior gets at least one unit test that would fail without the change.
  - Targeted unit tests must pass: `bun run test:unit`.

  ### tmax-use e2e playbook
  - Read 2–3 existing playbooks in `tmax-use/playbooks/` (e.g. `eval-01-cursor-movement.yaml`, `_smoke.yaml`) and the schema in `tmax-use/playbooks/README.md` before authoring.
  - Create `tmax-use/playbooks/<feature-slug>.yaml` that exercises the user-visible behavior end-to-end: setup file → steps (open/keys/eval) → `expect` assertions (mode, cursor, buffer_contains, screen_contains as appropriate) → `cleanup: true`.
  - The playbook name should be the feature slug, kebab-case. Do not weaken assertions to make a playbook pass; if an assertion is genuinely wrong, say so in the spec's Notes.
  - Run it locally: `bin/tmax-use test tmax-use/playbooks/<feature-slug>.yaml`.
  - If the feature is not user-visible (no editor behavior to drive via keys/eval), state that explicitly and skip the playbook — unit tests alone suffice.

  ### New Files
  <list every new test file and playbook created above with a one-line purpose. If no playbook is needed, say so.>
  ````

- **Remove the outdated Python testing entirely.** Each skill's `Plan Format` `## Validation Commands` section currently lists `cd app/server && uv run pytest - Run server tests ...` as a placeholder example. This Python testing is outdated for tmax and is **fully replaced by tmax-use** — do not leave it as a fallback. **Delete** that `uv run pytest` line from all three skills. The canonical validation examples become tmax-only:
  - `bun run test:unit` — Run unit tests with zero regressions.
  - `bun run test:tmax-use` — Run all tmax-use e2e playbooks + tests.
  - After the edit, **no Python testing references** (`uv run pytest`, `python`, `run_python_suite`) remain anywhere in the three skill templates. tmax-use + playbooks is the sole e2e mechanism the skills teach spec authors to use.
- Do NOT change the `## Instructions`, `## Relevant Files`, hooks, or front-matter of any skill — only the `Plan Format` template body. (The skill hooks themselves are Python validator scripts — `validate_*_name.py` — but those validate *spec filenames*, not application tests, and are out of scope.)

### Step 10: Remove the Python UI harness

**Order matters: delete files first, then scrub references, then verify nothing imports or calls the deleted code.**

- **10a — Delete `test/ui/` wholesale.** `rm -rf test/ui/`. This removes: 25 `tests/*.py` files, the `*.test.sh` harness shell tests alongside them, the 13-module `tmax_harness/` package, `run_python_suite.py`, `pyproject.toml`, `uv.lock`, `.venv/`, `.pytest_cache/`, `run-tests.sh`, `start-ui-test.sh`, and the 4 docs (`README.md`, `QUICKSTART.md`, `INTERACTIVE.md`, `TEST_STATUS.md`).
- **10b — Delete `rules/ui-testing.md`.** Path-scoped rule for `test/ui/**/*`; dead once the directory is gone.
- **10c — Delete the two analysis docs** `docs/ui-test-refactoring-opportunities.md` and `docs/ui-test-python-vs-bash-analysis.md` — but first `grep` each for non-harness content; if either contains generally-applicable testing guidance, edit to keep that part instead of deleting wholesale.
- **10d — Remove the 4 harness scripts from `package.json`**: `test:daemon`, `test:ui`, `test:ui:renderer`, `test:ui:helpers`. Keep `test:unit`, `test:integration`, `test:tmax-use`. Run `bun run` (no arg) after the edit to confirm no script references a deleted one.
- **10e — Scrub `AGENTS.md`**: delete the `test:daemon` + `test:ui:renderer` lines in §8 (Verify Before Reporting Complete), the `rules/ui-testing.md` row in the path-scoped rules table (§7), and the `uv` entry in §5 (Installed CLI Tools). Add `bun run test:tmax-use` to §8 as the e2e validation command. Update the ADW pipeline section from `plan → spec-review → build → patch-review` / 4-stage wording to `plan → spec-review → build → test → patch-review` / 5-stage wording.
- **10f — Scrub `CLAUDE.md`**: mirror every AGENTS.md change exactly (this is the authoritative workflow doc; the two must stay in sync), including the ADW pipeline stage list and 5-stage wording.
- **10g — Scrub `README.md`**: under "Available Scripts" → "Testing", replace the three Python-harness lines (`test:daemon`, `test:ui:renderer`, `test:ui`) with `bun run test:tmax-use — Run tmax-use e2e playbooks + tests`. Check the "Project Structure" block — if it lists `test/ui/`, remove that line.
- **10h — Scrub `.github/workflows/ci.yml`**: remove the `bun run test:daemon` and `bun run test:ui:renderer` jobs/steps. Ensure a `bun run test:tmax-use` step exists (add one if missing) so CI runs the playbooks.
- **10i — Scrub the `.zcode` skill support files** that gate on or document the Python harness: `.zcode/skills/tmax-patch-review/SKILL.md` (line 41), `.zcode/skills/tmax-spec-loop/SKILL.md` (lines 16, 128), `.zcode/skills/tmax-patch-review/scripts/audit.ts`, `.zcode/skills/tmax-spec-loop/scripts/run.ts`, and any live reference prompt/checklist markdown under those skill directories. Replace `bun run test:daemon` / `bun run test:ui:renderer` with `bun run test:tmax-use` (or remove the conditional if tmax-use subsumes it), and remove `test/ui`, `run_python_suite`, and `tmax_harness` references from live support files.
- **10j — Decide on `adws/adw-run-e2e.ts`** (legacy 1025-line standalone runner, no `package.json` script, not wired into the pipeline). Recommended: delete it (SPEC-061 declared tmax-use its successor). If kept, note why in the implementation. Optional in this spec.
- **10k — Verify with a grep sweep.** From the repo root: `grep -rn -E 'test:ui|test:daemon|run_python_suite|tmax_harness|test/ui|uv run pytest' --include='*.md' --include='*.ts' --include='*.json' --include='*.yml' .` and confirm every remaining hit is either (a) inside `docs/specs/archive/*` or a historical `docs/adrs/*` / `docs/specs/SPEC-0*` (leave untouched — history), or (b) inside this spec file itself. Any hit in a *live* doc, including `.zcode` support scripts and prompt/checklist markdown, is a bug; fix it.
- **10l — Verify the build still works** after deletion: `bun run typecheck` (nothing in `src/` should reference `test/ui/`), `bun run build`, `bun run test:unit`. If any source file imported from the harness, the typecheck catches it — fix the import (the harness was Python, so this is unlikely, but `src/` may have referenced it in comments or scripts).

### Step 11: Unit tests — `test/unit/adw-test.test.ts`

- `parseArgs`: valid spec path, valid adw-id, `--model`, `--id`, missing input → usage error, bad adw-id → error.
- `resolveInputFrom`: spec path exists → Right; spec path missing → Left; adw-id with state → Right with specPath; adw-id without state → Left; adw-id with state but no spec_path → Left.
- `parseBunTestOutput`: passing, failing (2 failures parsed), malformed (zeros, no throw).
- `parseTmaxUseExitCode`: exit 0 → ok; exit 1 + JUnit present via `reportDir` → root `<testsuites>` or summed `<testsuite>` counts parsed; exit 1 + no JUnit → ok:false, counts 0.
- `buildTestStageResult`: unit pass + e2e pass → verdict pass; unit pass + e2e fail → gaps; unit fail + e2e skipped → gaps; unit pass + e2e skipped(no targets) → pass.
- `runUnitTrack` with mocked deps: initial pass → 1 iteration; initial fail → resolve called → rerun pass → 2 iterations; initial fail → resolve → rerun fail → exhausted → ok:false, iterations = 1 + MAX_UNIT_ITERATIONS.
- `runE2eTrack` with mocked deps: no targets → skipped sentinel; initial pass; fail → resolve → rerun fail → exhausted.
- Resolve loop never throws on a single resolve failure (mock `runCapture` to return Left; loop continues).
- Track-result failure returns `Right` (not `Left`); only spawn/claude-missing returns `Left`.
- `runTest` end-to-end with mocked tracks: unit pass + e2e pass → verdict pass, `results.json` written; unit fail → e2e skipped, verdict gaps.

### Step 12: SPECS_INDEX + Validation

- Add SPEC-063 to `docs/specs/SPECS_INDEX.md` under "ADW Pipeline & Testing", increment the total count.
- Run the Validation Commands below. Every command must pass with zero errors.

## Testing Strategy

### Unit Tests

All in `test/unit/adw-test.test.ts` (Step 11). The tester module is fully mockable via `TesterDeps`, so no real subprocesses are spawned in unit tests. Mock `runRaw` to return canned `RawRunResult` objects (passing output, failing output, exit codes) and `runCapture` to return canned stream-json. Verify:
- Track sequencing (unit before e2e, e2e skipped on unit fail).
- Iteration counts respect `MAX_UNIT_ITERATIONS` / `MAX_E2E_ITERATIONS`.
- Resolve is called the expected number of times.
- `results.json` shape matches `TestStageResult`.
- `Right` vs `Left` boundary is correct (track failures are `Right`; only infra errors are `Left`).

### Integration Tests

Not added in this spec — the stage is exercised end-to-end by running the full orchestrator (`bun adws/adw-plan-review-build-patch.ts`) against a small spec. That is a manual/CI smoke test, not a unit test. The dispatcher's `import.meta.main` guard means importing it in tests does not run `main()`.

### Edge Cases

- `bun` not on PATH → `runRaw` returns Left → stage returns Left (infra error), records `error` event.
- `claude` not on PATH → `ensureAvailable` returns Left → stage returns Left before any track runs.
- Unit suite hangs (no output) → `runRaw` still resolves when the process exits; if `bun` itself hangs, that is outside this stage's scope (the orchestrator's tmux launcher + heartbeat handle long runs).
- E2E suite has zero targets → skipped sentinel, `verdict: pass` (if unit passed).
- Resolve makes things worse (a fix introduces a new failure) → the next iteration's parse catches the new failure; loop continues until iteration cap.
- Both tracks fail → verdict `gaps`, both `TrackResult`s in `results.json`, e2e not skipped (it ran and failed) — only skipped when unit fails.
- `results.json` write fails (disk full) → Left, error event; the track results are still in the events log.

## Acceptance Criteria

1. **Dispatcher exists**: `adws/adw-test.ts` follows the `parseArgs` → `runTest()` → `main()` → `import.meta.main` structure of `adw-patch-review.ts`, accepts `--model`, `--id`, and a spec-path-or-adw-id, and prints `<id> <pass|gaps> <spec-path>` on success.
2. **Tester module is dependency-injected**: `adws/adws-modules/tester.ts` exports `TesterDeps`, `ensureAvailable`, `runUnitTrack`, `runE2eTrack`, `resolveUnitTest`, `resolveE2eTest`, `writeResults`, `buildTestStageResult`, parsing helpers, and the `MAX_*_ITERATIONS` consts. It imports no `child_process` directly.
3. **Unit track runs `bun run test:unit`**: exit 0 + zero parsed failures → pass; otherwise enters the resolve loop.
4. **Unit resolve loop caps at 2 iterations**: the suite runs once initially, then up to 2 more times after resolve attempts (total ≤ 3 suite executions). Each resolve dispatches `claude -p` with a focused per-test prompt and tees to `agents/{id}/tester/unit-resolve-*.jsonl`.
5. **E2E track runs `bun run test:tmax-use`**: invokes the tmax-use runner with `--output agents/{id}/tester/e2e-report-itN --reporter all`. Skipped (sentinel pass) when no tmax-use targets exist.
6. **E2E resolve loop caps at 2 iterations**: same shape as unit.
7. **Unit gates e2e**: if the unit track ends with `ok: false`, the e2e track does not run and `e2eSkipped: true` is recorded.
8. **Results bundle**: `agents/{id}/tester/results.json` is written with the full `TestStageResult` (both tracks' counts, iterations, failures, verdict, `adw_id`, `written_at`).
9. **Verdict mapping**: `pass` iff unit passed and (e2e passed OR e2e skipped-due-to-no-targets); `gaps` otherwise.
10. **Right vs Left boundary**: failing tests after exhausting iterations return `Right(verdict: "gaps")`; only spawn/claude-missing/write failures return `Left`.
11. **Orchestrator integration**: `adw-plan-review-build-patch.ts` runs the test stage between build and patch-review on the initial build and after every patch-review `gaps` retry build. Test `gaps` does not hard-stop — patch-review still runs and sees `results.json`. `--from-stage test` works for resume, and resume state cannot skip the required post-retry-build test rerun.
12. **Skills updated — only the tmax-use option remains**: `/bug`, `/feature`, `/chore` each have a `## Tests & E2E Playbooks` section in their `Plan Format` with unit-test + tmax-use-playbook authoring instructions. The outdated `cd app/server && uv run pytest` line is **deleted** (not kept as a fallback) and the canonical validation examples are `bun run test:unit` + `bun run test:tmax-use`. No Python testing references (`uv run pytest`, `python`, `run_python_suite`) remain in any of the three skill templates.
13. **Python UI harness fully removed**: `test/ui/` does not exist; `rules/ui-testing.md` does not exist; the 4 harness `package.json` scripts (`test:daemon`, `test:ui`, `test:ui:renderer`, `test:ui:helpers`) are gone; and a repo-wide grep for `test:ui|test:daemon|run_python_suite|tmax_harness|test/ui|uv run pytest` returns hits **only** in historical docs (`docs/specs/archive/*`, historical `docs/adrs/*` and `docs/specs/SPEC-0*`) or this spec itself. Live docs (`AGENTS.md`, `CLAUDE.md`, `README.md`, `.github/workflows/ci.yml`) and live `.zcode` skill files, including top-level `SKILL.md`, support scripts, and prompt/checklist markdown, carry no harness references.
14. **Typecheck/build pass after removal**: `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck` all exit 0; `bun run build` succeeds. No `src/` or `adws/` file imports from or references the deleted harness.
15. **No regressions**: `bun run test:unit` passes all existing tests plus the new `adw-test.test.ts`.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck:src` — Source typecheck, zero errors.
- `bun run typecheck:test` — Test typecheck, zero errors.
- `bun run typecheck` — Full project typecheck, zero errors.
- `bun run build` — Build succeeds (includes build:tmax + build:tlisp + build:tmax-use).
- `bun test test/unit/adw-test.test.ts` — New unit tests pass.
- `bun run test:unit` — All unit tests pass, no regressions.
- `bun adws/adw-test.ts --help` — Prints USAGE, exits 0.
- `bun adws/adw-test.ts` (no args) — Prints usage error to stderr, exits 1.
- `bun adws/adw-test.ts docs/specs/SPEC-063-adw-test.md --id <a-real-or-fresh-id>` — End-to-end smoke against this spec; prints `<id> <pass|gaps> <spec-path>` and writes `agents/<id>/tester/results.json`. (Requires `claude` on PATH because `runTest` calls `ensureAvailable` before any track, even when tests pass on the first run.)

**Harness-removal validation (Step 10):**
- `test ! -d test/ui && echo OK` — `test/ui/` is gone.
- `test ! -f rules/ui-testing.md && echo OK` — UI-testing rule is gone.
- `bun run` (no args) — the 4 harness scripts (`test:daemon`, `test:ui`, `test:ui:renderer`, `test:ui:helpers`) are absent from the script list.
- `bun run test:tmax-use` — tmax-use playbooks + tests still pass (the e2e coverage that replaced the harness).
- `grep -rn -E 'test:ui|test:daemon|run_python_suite|tmax_harness|test/ui|uv run pytest' --include='*.md' --include='*.ts' --include='*.json' --include='*.yml' . | grep -v -E 'docs/specs/(archive|SPEC-0|SPEC-063)|docs/adrs/' || echo OK` — no live-doc harness references remain (historical docs and this spec are excluded).

## Notes

- **"2 iterations for each failing test" — exact meaning.** The unit/e2e track runs the full suite once. If it fails, the resolve loop fires: dispatch a resolver per failure, then rerun the full suite. That is one resolve-then-rerun *iteration*. The cap is 2 such iterations, so the suite runs at most 3 times total (initial + 2 resolve-reruns). This matches the prior session's design ("retry budget 4 attempts" there; here tightened to 2 per the explicit requirement) and keeps total stage wall-time bounded.
- **Why `gaps` and not `fail` for the verdict.** Patch-review already uses `pass`/`gaps`, and the orchestrator's build↔patch loop treats `gaps` as "release to completed with unresolved issues." Reusing `gaps` for unresolved test failures keeps the orchestrator's verdict vocabulary uniform. A hard `fail` would require new orchestrator branching; `gaps` composes with the existing loop.
- **Why the test stage does not hard-stop the pipeline on `gaps`.** Test failures are valuable audit input for patch-review — the auditor should see that tests are red and weigh that against the spec. Hard-stopping would hide test failures behind an earlier exit and prevent the auditor from correlating them with spec gaps. The existing build↔patch loop already releases `gaps` to completed; test `gaps` follows the same philosophy.
- **Why `claude -p` for resolve and not a narrower tool.** Test failures usually require reading the code under test, the test, and related modules — a focused `/implement`-style prompt gives the resolver full repo access while the prompt scopes the *task* (fix this one test). The prompt explicitly forbids touching unrelated files and forbids weakening assertions. This mirrors how `adw-build.ts` uses `/implement`.
- **Why duplicate `run`/`runRaw`/`runCapture`/`adwId`/`resolveInputFrom` across dispatchers.** Every existing dispatcher (`adw-build.ts`, `adw-patch-review.ts`) duplicates these. Extracting a shared `adws-modules/subprocess.ts` is a worthwhile refactor but out of scope for this spec (it would touch all four dispatchers + their tests). Follow the established pattern; a future chore can deduplicate.
- **Relationship to the existing in-audit gates.** `patch-reviewer.ts:runGates` still runs typecheck + unit inside patch-review. That is intentional: patch-review needs *current* gate state at audit time (the tree may have changed between the test stage and patch-review). The test stage's `results.json` is additional context; it does not replace the live gates. A future chore could have patch-review skip re-running unit tests if `results.json` shows a recent pass, but that optimization is out of scope.
- **tmax-use report parsing.** The e2e track reads JUnit XML from the report dir for structured counts. This is a zero-dependency string scan: parse root `<testsuites ... tests="N" failures="M" errors="E">` counts when present, otherwise sum all `<testsuite ...>` counts. This handles multi-playbook reports without a real XML parser and stays consistent with the project's zero-dependency stance.
- **Resume semantics.** The test stage is checkpointed like every other stage: on interrupt, `--id <id>` resume auto-detects that `test` is not in `completed_stages` and re-runs it from scratch. After a patch-review `gaps` retry build, the previous test completion no longer satisfies the build→test→patch-review invariant, so resume state must require a fresh test run before the next patch-review attempt. There is no mid-track resume (the resolve loop is not checkpointed internally) — re-running the whole stage on resume is acceptable because the unit suite is fast (<60s) and the e2e suite is bounded by the iteration cap.
- **Harness removal scope — what is and isn't deleted.** Deleted: the entire `test/ui/` tree, `rules/ui-testing.md`, the 4 harness `package.json` scripts, and live references in AGENTS.md / CLAUDE.md / README.md / ci.yml / live `.zcode` patch-review & spec-loop skill files, including support scripts and prompt/checklist markdown. **Not deleted:** historical specs and ADRs (`docs/specs/archive/*`, `docs/adrs/*`, and the `docs/specs/SPEC-0*-*` files that record past work) — these document decisions made at the time and rewriting them would falsify history. **Out of scope:** `demos/demo-runner.py` and the `/demo` skill (a visual demo tool, not a test harness — left alone unless the deletion breaks it); `adws/adw-run-e2e.ts` (legacy standalone runner, deletion recommended but optional). **No per-test migration:** tmax-use's 24 existing playbooks already cover the same editor behaviors the 25 Python tests did; if a coverage gap surfaces after removal, a separate spec adds the missing playbook rather than porting Python tests.
- **Why `test:daemon` is removed, not migrated.** The `test:daemon` script ran daemon API integration tests via the Python harness. The daemon API surface is already exercised by tmax-use playbooks that open files, send keys, eval T-Lisp, and capture frames over the same JSON-RPC. If dedicated daemon-RPC edge-case tests are wanted, they belong as `tmax-use/tests/*.tmax-use.ts` TypeScript tests (per SPEC-061's TypeScript test format), not a reconstituted Python suite.
