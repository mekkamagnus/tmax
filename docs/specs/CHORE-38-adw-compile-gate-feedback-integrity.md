# Chore: adw compile gate + hard-fail tier + feedback-channel integrity

## Chore Description

ADR-0108 documents four structural gate gaps that let a non-compiling orchestrator loop
in the adw pipeline for days. This chore implements the three that are **build/test-stage
concerns** (ADR-0108 (a), (b), (c)); gap (d) — worktree base-sha verification — is tracked
separately under BUG-20 and is explicitly out of scope here.

Concretely:

1. **(a) `typecheck` compile gate in `adw-build.ts`.** Today the build stage dispatches to
   `/implement` and immediately records success — it never compiles the result. A duplicate
   `findWorkspaceBySpecPath` import (the SPEC-065 P0 defect) was therefore invisible to
   build and only surfaced as opaque unit-test timeouts. Add `bun run typecheck:src` as a
   build-stage gate that runs **after** the implement dispatch and **before** recording
   success; a non-zero exit fails the build stage directly (Left), in seconds.

2. **(b) Hard-fail tier for import-time test failures.** Today
   `buildTestStageResult` (`adws/adws-modules/tester.ts`) collapses every unit failure to a
   single `gaps` verdict — retryable audit input. "The orchestrator module cannot be
   imported" and "one flaky timeout" are indistinguishable. Introduce a new
   `compile-fail` outcome for module-load / import-time failures: these are **not
   retryable** through the resolve loop (rerunning a test whose SUT won't import just
   reproduces the crash), so they must short-circuit the unit track and surface as a hard,
   non-`gaps` failure. Assertion/timeout/e2e failures keep `gaps`.

3. **(c) Feedback-channel integrity check in the retry loop.** The orchestrator
   (`adws/adw-plan-review-build-patch.ts`) learns what to fix only when patch-review
   **appends findings to the spec**, which the next build re-reads. When patch-review
   crashes (`stage-error`), nothing is appended and the builder re-runs **blind** against
   an unchanged spec — reproducing the identical defect. Add a guard: before re-running
   build after a `gaps` patch-review verdict, verify the spec file was actually modified
   (mtime/size since the last build dispatch); if not, emit a `feedback-stalled` error and
   stop the loop instead of silently burning iterations.

**Out of scope (tracked elsewhere):** ADR-0108 (d) base-sha / worktree-content verification
— that is the BUG-20 fix itself (`docs/specs/BUG-20-worktree-duplication-on-resume.md`).

## Relevant Files

Use these files to resolve the chore:

- `adws/adw-build.ts` — **(a) the compile gate target.** The `program` TaskEither chain
  in `main()` runs: Step 0 `ensureAvailable` → Step 1 record state → Step 2 `build()`
  dispatch → Step 3 `captureGitTrace` + record success → Step 4 optional e2e gate. The
  typecheck gate inserts as a new Step 2.5 between the `build()` dispatch and
  `captureGitTrace`. The gate reuses the existing injected `run()` helper
  (`TaskEither<string, string>`, Left on non-zero exit) — pattern-identical to
  `runE2eGate`. The `cwd` is already worktree-aware (`process.env.ADW_WORKTREE ?? PROJECT_ROOT`).
- `adws/adws-modules/tester.ts` — **(b) the hard-fail tier target.** `buildTestStageResult`
  (the single verdict site) currently returns `verdict: "pass" | "gaps"` via
  `unit.ok && e2ePassed ? "pass" : "gaps"`. `extractBunFailures` already captures each
  failure's indented error `message`. Add an import-time classifier that inspects those
  messages and, when any failure is module-load class, marks the `TrackResult` as
  non-retryable. `runUnitTrack` must short-circuit on such a result (no resolve dispatch).
- `adws/adw-plan-review-build-patch.ts` — **(c) the feedback-channel guard target.** The
  retry loop at ~line 1217 re-runs build after a `gaps` patch-review verdict. Before the
  `deps.runBuild(...)` call, capture the spec file's `stat` (mtimeMs + size) and compare to
  the value recorded just before the prior build dispatch; if unchanged, append a
  `feedback-stalled` event and `finalize(Left(...))` instead of re-running blind.

### New Files
- `test/unit/adw-compile-gate.test.ts` — unit tests for (a) the typecheck gate function and
  (b) the import-time classifier (pure functions, injected `run`/failure messages).
- `test/unit/adw-feedback-stall.test.ts` — unit test for (c) the feedback-channel guard
  (stat-based modified check, Left on unchanged spec).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. (a) Add the typecheck compile gate function
- **User story:** *As a build stage, I want to compile the implement result before recording
  success, so that a TS duplicate-identifier or missing-export defect fails the build in
  seconds rather than surfacing later as opaque test timeouts.*
- In `adws/adw-build.ts`, add an exported `runTypecheckGate(run, cwd)` function modeled on
  `runE2eGate` (`TaskEither<string, TypecheckGateResult>`). It runs
  `bun run typecheck:src` (resolve via `bunx tsc --noEmit --project tsconfig.src.json` if
  the npm script wrapper is unsuitable for injection). Return a result with
  `{ ok: boolean; output: string }`. A non-zero exit (Left from `run`) maps to
  `{ ok: false, output: <stderr||stdout> }`; success maps to `{ ok: true, output: "" }`.
  Keep it dependency-injected (`run` param) so it is unit-testable like `runE2eGate`.
- Insert the gate into the `program` chain as Step 2.5, immediately after the `build()`
  `.flatMap` (Step 2) and before `captureGitTrace` (Step 3). On `ok: false`, append a
  `typecheck_gate` event with `{ ok: false, output }` to `agents/{id}/builder/` and
  `flatMap` to `TaskEither.left(...)` so the build stage fails — do **not** fall through to
  recording `status: "completed"`. On `ok: true`, append `typecheck_gate { ok: true }` and
  continue.
- Acceptance criteria:
  - `runTypecheckGate` is exported, takes injected `run`, and is unit-testable without
    spawning a real subprocess.
  - When `typecheck:src` would exit non-zero (simulated via an injected `run` returning
    Left), the build `program` returns Left and never records `status: "completed"`.
  - A `typecheck_gate` event is appended to `agents/{id}/builder/events.jsonl` in both the
    pass and fail cases.

### 2. (a) Wire the gate into standalone and orchestrated flows
- Confirm the gate runs in **both** standalone `bun adws/adw-build.ts <spec>` and
  orchestrated mode (it is in the shared `program` chain, so this is automatic — verify it).
- Confirm the `cwd` is worktree-correct: the gate must run against the
  `ADW_WORKTREE` checkout when set (the existing `cwd` const already handles this; the gate
  must use that `cwd`, not `PROJECT_ROOT`).
- Acceptance criteria:
  - `bun adws/adw-build.ts <spec>` in a checkout with a deliberately broken `.ts` file
    fails at the typecheck gate (Left), without spawning the e2e gate or recording success.
  - In a clean checkout the gate passes and the build proceeds exactly as before.

### 3. (b) Add the import-time failure classifier in tester.ts
- **User story:** *As a test stage, I want module-load/import-time failures to surface as a
  hard, non-retryable outcome, so a non-compiling SUT is not retried indefinitely as soft
  `gaps` input.*
- In `adws/adws-modules/tester.ts`, add an exported pure function
  `isImportTimeFailure(failures: TestFailure[]): boolean` that returns true when any
  failure's `message` (or name) matches module-load signatures, e.g. `Duplicate identifier`,
  `Cannot find module`, `is not defined`, `Could not resolve`, `error TS2` (duplicate
  identifier / cannot find / cannot resolve family), `SyntaxError`, or
  `error during module loading`. Anchor the regexes to the actual bun output format seen in
  the SPEC-065 results (`test/unit/*.test.ts ... error TS2300: Duplicate identifier`).
- Extend the `TrackResult` (or the verdict computation) so an import-time failure produces
  a distinct outcome. The minimal, non-breaking approach: add a `compileFail: boolean`
  field to `TrackResult` set from `isImportTimeFailure(failures)` when `failed > 0`.
- Acceptance criteria:
  - `isImportTimeFailure` is exported and unit-tested against (i) a duplicate-identifier
    message, (ii) a "Cannot find module" message, (iii) a plain assertion failure
    (returns false), (iv) a timeout (returns false).
  - `TrackResult` carries the `compileFail` flag.

### 4. (b) Short-circuit the unit track on import-time failure
- In `runUnitTrack` (`adws/adws-modules/tester.ts`), after the first suite run parses its
  failures, if `isImportTimeFailure(failures)` is true, **do not** enter the
  resolve-then-rerun loop — return immediately with `ok: false, compileFail: true`. Rationale:
  a module that cannot be imported cannot be fixed by the resolve dispatch re-running the
  same test; it needs a code edit, which is the build stage's job.
- In `buildTestStageResult`, propagate the flag: when `unit.compileFail` is true, the stage
  result must not be plain `gaps`. Add `"compile-fail"` to the verdict union
  (`"pass" | "gaps" | "compile-fail"`) and return it when `unit.compileFail` is true.
- Acceptance criteria:
  - A unit run whose only failures are import-time errors runs the suite **once** (no resolve
    dispatch, no rerun) and returns `verdict: "compile-fail"`.
  - A unit run with assertion/timeout failures still runs the resolve loop and returns
    `gaps` (unchanged behavior).

### 5. (b) Teach the orchestrator to treat compile-fail as hard (non-retryable)
- In `adws/adw-plan-review-build-patch.ts`, the test-stage result handling (~line 1110,
  `if (testRes.right.verdict === "gaps")`) must also handle `"compile-fail"`: a `compile-fail`
  verdict **finalizes the pipeline as failed** (Left) with a clear message
  ("test stage: module import failed — this is a build/compile defect, not retryable"), rather
  than continuing to patch-review or looping. Record `failed_stage: "test"` and a
  `compile-fail` event.
- Update the `verdict` union types wherever the test result flows (the local
  `TestStageResult`/`verdict: "pass" | "gaps"` at ~line 446/451) to include `"compile-fail"`.
- Acceptance criteria:
  - A `compile-fail` test verdict causes the orchestrator to `finalize(Left(...))` — it does
    not proceed to patch-review and does not enter the build↔test↔patch retry loop.
  - A `gaps` verdict continues to behave exactly as before (audit input).

### 6. (c) Add the feedback-channel integrity guard
- **User story:** *As a retry loop, I want to refuse to re-run build when patch-review
  delivered no feedback, so a crashing reviewer cannot make me loop blind and burn
  iterations reproducing the same defect.*
- In `adws/adw-plan-review-build-patch.ts`, at the retry site (~line 1217, the
  `if (patchIterations < maxRetries)` branch that re-runs build), before calling
  `deps.runBuild(...)`, `stat` the spec file at `specPathForLater` and compare its
  `mtimeMs` + `size` to the values captured just before the **previous** build dispatch
  (record them in a local variable updated each iteration).
- If the spec is unchanged (same mtimeMs and size), append a `feedback-stalled` event with
  the spec path + prior and current stat, and `finalize(Either.left("feedback stalled:
  patch-review returned gaps but did not modify the spec — refusing to re-run build blind"))`.
  Do **not** call `deps.runBuild`.
- If the spec was modified, proceed with the rebuild as today.
- Acceptance criteria:
  - When patch-review returns `gaps` **and** the spec file is unchanged since the last
    build, the orchestrator emits `feedback-stalled` and finalizes Left — it does not
    re-run build.
  - When patch-review returns `gaps` **and** the spec file was modified, the rebuild
    proceeds exactly as today.

### 7. Run the Validation Commands
- Execute every command in the Validation Commands section, top to bottom, and confirm each
  passes with zero errors before reporting the chore complete.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:src` — must
  pass (the gate itself compiles).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:test` — must
  pass (the new test files typecheck). Note: 3 pre-existing errors exist in
  `test/unit/adw-watchdog.test.ts` and `test/unit/remote.test.ts` unrelated to this chore;
  confirm your new test files add zero new errors.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/adw-compile-gate.test.ts` —
  validates (a) the gate function and (b) the classifier.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/adw-feedback-stall.test.ts` —
  validates (c) the feedback guard.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/adw-pipeline-loop.test.ts` —
  the existing orchestrator unit tests must still pass (33/0 baseline) after the verdict
  union and finalize-path changes.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/adw-build.test.ts` (if present)
  — the build-stage unit tests must still pass after inserting Step 2.5.

## Notes

- **The gate must run in the worktree, not PROJECT_ROOT.** When orchestrated, build runs
  inside `ADW_WORKTREE`; the gate's `cwd` is the existing `const cwd` in `main()` which
  already respects this. Do not hardcode `PROJECT_ROOT` in the gate.
- **Do not fail the build on the 3 pre-existing `typecheck:test` errors.** The gate runs
  `typecheck:src` (source only), not the full `typecheck` — by design, so test-only type
  errors don't block implementation builds. Keep the gate scoped to `:src`.
- **Why (b) short-circuits the resolve loop:** the resolve dispatch re-runs the failing
  test after an attempted fix, but a module that won't import cannot be fixed by re-running
  the test — it needs an edit. Rerunning just burns the track budget. The compile-fail flag
  routes it back to build (the stage that can edit code) via a hard failure.
- **Why (c) compares mtimeMs + size, not content hash:** the spec is appended-to by
  patch-review, so any delivery changes size/mtime; a hash is overkill and slower. If false
  positives appear (e.g. touch without content change), revisit with a content hash.
- **(d) is out of scope** — base-sha/worktree-content verification is BUG-20. Implementing it
  here would couple this chore to BUG-20's ResumeContext changes. Keep them separate.
- **Reference:** `docs/adrs/ADR-0108-adw-compile-gate-and-feedback-integrity.md` is the
  authoritative decision record; this chore is its implementation. The earlier failed
  pipeline `01KW18WDWN` (which crashed at plan due to a cancelled SessionEnd hook) attempted
  this same work via the LLM planner; this chore replaces that approach with a direct plan.
