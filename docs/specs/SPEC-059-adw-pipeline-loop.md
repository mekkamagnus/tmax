# Feature: adw-plan-review-build-patch.ts — 4-stage pipeline with build↔patch-review retry loop

## Feature Description
A fourth adw pipeline orchestrator: `adws/adw-plan-review-build-patch.ts`. It extends the existing `adw-plan-reviewspec-build.ts` (plan → spec-review → build) with a 4th stage — **patch-review** — that audits the build's working-tree changes against the spec's acceptance criteria. When patch-review returns GAPS (criteria not met), the orchestrator loops back to build (since patch-review appends audit findings to the spec, the next build iteration sees them and can fix the gaps). This build↔patch-review loop runs at most **3 times** before the pipeline releases to completion regardless of verdict, preventing infinite loops on stubborn gaps.

## User Story
As an adw pipeline user
I want the full plan → review → build → patch-review cycle to run automatically, retrying the build when the audit finds gaps
So that an implementation is verified against its spec's acceptance criteria before the pipeline declares it done

## Problem Statement
The existing `adw-plan-reviewspec-build.ts` orchestrator stops at build — it has no post-build verification. The `adw-patch-review.ts` dispatcher exists and works standalone, but there's no orchestrator that chains it after build AND loops back when the audit finds gaps. Without this, a full pipeline run produces an implementation that may not satisfy the spec's acceptance criteria, and a human must manually re-run build + patch-review until the gaps close.

## Solution Statement
Create `adw-plan-review-build-patch.ts` as a superset of `adw-plan-reviewspec-build.ts`:

1. **Stages 1-3** (plan → spec-review → build) are identical to the existing orchestrator — same `PipelineDeps` shape, same subprocess spawning, same shared-workspace-id model, same existing spec-path input flow (`<spec-path>` skips plan), same resume support (`--id`, `--from-stage`, auto-detection).
2. **Stage 4** (patch-review) spawns `adw-patch-review.ts` as a subprocess, parses its `<id> <pass|gaps> <spec-path>` stdout, and branches:
   - **PASS** → finalize as `completed`.
   - **GAPS** → patch-review has already appended audit findings to the spec; loop back to **build** (stage 3), then re-run patch-review. The loop counter increments each cycle.
3. **Loop bound**: the build→patch-review cycle runs at most 3 times. After the 3rd GAPS, the pipeline releases to `completed` with a `patch_review_verdict: "gaps"` field in the final state, recording that the implementation has unresolved gaps. This prevents infinite loops while still surfacing the audit result.
4. **Resume**: extends the existing `--id`/`--from-stage` resume to include `patch-review` as a valid stage name, so an interrupted run can resume from any of the 4 stages (or mid-loop). Mid-loop resume uses both `patch_review_iterations` and `patch_review_next_action` so it can distinguish "GAPS recorded, rebuild still pending" from "rebuild completed, next patch-review pending."

## Relevant Files

### New Files

- **`adws/adw-plan-review-build-patch.ts`** — The 4-stage orchestrator. Mirrors `adw-plan-reviewspec-build.ts` structurally (same imports, same helpers, same `PipelineDeps`/`runPipeline`/`main` shape) but adds `runPatchReview` to the deps, a `"patch-review"` entry to `StageName`/`STAGE_ORDER`, and a build↔patch-review loop with a max-3 bound. Exports `runPipeline`, `PipelineDeps`, `PipelineResult`, `OrchestratorArgs`, `parseArgs`, `loadWorkspace` for testability.

### Existing Files to Read (reference, not modify)

- **`adws/adw-plan-reviewspec-build.ts`** — The 3-stage template this file extends. The new file is a near-copy with the 4th stage + loop added. Key interfaces to mirror: `PipelineDeps` (lines 319-323), `OrchestratorArgs` (82-88), `PipelineResult` (385-393), `OrchestratorState` (370-379), `runPipeline` (404-551), `realDeps` (326-364), `loadWorkspace` (222-264), `finalize` (450-463).
- **`adws/adw-patch-review.ts`** — The 4th stage dispatcher. Key contracts: `runPatchReview(input, modelOverride?, id?)` signature, `PatchReviewOutcome { id, verdict: "pass"|"gaps", specPath }`, stdout `"<id> <pass|gaps> <spec-path>"` (exit 0 for both verdicts), GAPS triggers `appendFindingsToSpec` (mutates the spec file).
- **`adws/adws-modules/patch-reviewer.ts`** — Exports `PATCH_REVIEW_MODEL = "glm-5.1"` and `AuditVerdictKind = "pass" | "gaps"`. Reference only; the orchestrator doesn't import from here (it spawns the dispatcher as a subprocess).
- **`src/utils/task-either.ts`** — Canonical `Either`/`TaskEither`. Critical: `TaskEither.right<R, L>` has flipped generics; `Either.isLeft`/`Either.isRight` for branching.
- **`test/unit/adw-pipeline.test.ts`** — The 3-stage orchestrator's test suite (35 tests). The new file's tests will mirror this structure (mocked `PipelineDeps`, seeded workspace state, no live LLM).

### Existing Files to Modify

- **`docs/specs/index.md`** — Add SPEC-059 entry to the spec index table.

## Implementation Plan

### Phase 1: Foundation — extend the type system + helpers

The new file starts as a structural copy of `adw-plan-reviewspec-build.ts`. The foundational changes are type-level: add `patch-review` to `StageName`/`STAGE_ORDER`, add `runPatchReview` to `PipelineDeps`, add `PatchReviewResult` to the result types, and extend `OrchestratorState` with loop-tracking fields.

### Phase 2: Core — the build↔patch-review loop

After stage 3 (build) succeeds, instead of finalizing, the orchestrator enters the loop: run patch-review → on PASS finalize → on GAPS increment the counter and loop back to build (if counter < 3) or finalize-with-gaps (if counter = 3). Each loop iteration appends events recording the cycle number and verdict.

### Phase 3: Integration — resume + realDeps + tests

The `runPatchReview` dep spawns `adw-patch-review.ts` as a subprocess (same `spawnStage` + `tokensOf` pattern). Resume extends to include `patch-review` in `--from-stage` validation and `loadWorkspace` inference. Tests cover the loop (pass on first try, gaps→retry→pass, gaps→3x→release, loop counter tracking, pending-action tracking, spec mutation between cycles, and existing spec-path input).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Create `adws/adw-plan-review-build-patch.ts` with extended types + helpers

Start as a copy of `adw-plan-reviewspec-build.ts`. Make these changes:

**`StageName` + `STAGE_ORDER`:**
```ts
type StageName = "plan" | "review" | "build" | "patch-review";
const STAGE_ORDER: readonly StageName[] = ["plan", "review", "build", "patch-review"];
```

**`PatchReviewResult` interface (new):**
```ts
export interface PatchReviewResult {
  id: string;
  verdict: "pass" | "gaps";
  specPath: string;
}
```

**`PipelineDeps` — add the 4th dep:**
```ts
export interface PipelineDeps {
  runPlan: (description: string, forcedType: PlanType | undefined, id: string) => Promise<Either<string, PlanResult>>;
  runSpecReview: (specPath: string, id: string) => Promise<Either<string, SpecReviewResult>>;
  runBuild: (specPath: string, modelOverride: string | undefined, id: string) => Promise<Either<string, BuildOutcome>>;
  runPatchReview: (specPath: string, modelOverride: string | undefined, id: string) => Promise<Either<string, PatchReviewResult>>;
}
```

**`PipelineResult.stages` — add `patchReview`:**
```ts
export interface PipelineResult {
  id: string;
  specPath: string;
  stages: {
    plan: PlanResult;
    review?: SpecReviewResult;
    build?: BuildOutcome;
    patchReview?: PatchReviewResult;
  };
}
```

**`OrchestratorState` — add loop-tracking fields:**
```ts
interface OrchestratorState {
  adw_id: string;
  description: string;
  status: "running" | "completed" | "failed";
  agents?: string[];
  failed_stage?: StageName;
  completed_stages?: StageName[];
  spec_path?: string;
  patch_review_verdict?: "pass" | "gaps";  // NEW: final patch-review verdict
  patch_review_iterations?: number;          // NEW: how many build↔patch cycles ran
  patch_review_next_action?: "build" | "patch-review"; // NEW: exact pending loop action for resume
  error?: string;
}
```

Mirror these optional loop fields in the on-disk `WorkspaceState` used by `loadWorkspace`, because resume reads from `agents/{id}/adw-state.json`.

**`parseArgs` — add `patch-review` to `--from-stage` validation:**
```ts
if (val !== "plan" && val !== "review" && val !== "build" && val !== "patch-review") {
  return Either.left(`--from-stage must be one of: plan, review, build, patch-review (got "${val}").`);
}
```

**`USAGE` text** — update the script name + document the loop behavior + `--max-retries` flag. Preserve the existing input modes from the 3-stage orchestrator: `<description>` runs plan first, while `<spec-path>` (matching `SPEC-*.md`, `BUG-*.md`, or `CHORE-*.md`) skips plan and starts from the existing spec.

**New CLI flag `--max-retries <N>`:**
```ts
export interface OrchestratorArgs {
  description: string;
  forcedType?: PlanType;
  modelOverride?: string;
  id?: string;
  fromStage?: StageName;
  specPath?: string;    // preserve existing spec-path input: adw-plan-reviewspec-build.ts <spec-path>
  maxRetries?: number;  // NEW: max build↔patch cycles (default 3)
}
```
Preserve the copied 3-stage parser's existing positional input behavior:
- A positional `SPEC-*.md`, `BUG-*.md`, or `CHORE-*.md` path sets `specPath` and leaves `description` empty.
- `specPath` input skips plan and starts at review using that file.
- `--feature`/`--bug`/`--chore` with `specPath` remains an error because those flags require the plan stage.

Parse `--max-retries` as a positive integer (default 3). Validate `> 0`.

- Verify: `bun -e 'import "./adws/adw-plan-review-build-patch.ts"'` resolves without error.
- Verify: `bun adws/adw-plan-review-build-patch.ts --help` prints the updated usage (exit 0).

### Task 2 — Add `runPatchReview` to `realDeps`

Following the `runBuild` template exactly — spawn `adw-patch-review.ts` as a subprocess, parse its stdout:

```ts
runPatchReview: async (specPath, modelOverride, id): Promise<Either<string, PatchReviewResult>> => {
  const args = [specPath];
  if (modelOverride) args.push("--model", modelOverride);
  args.push("--id", id);
  const r = await spawnStage("adw-patch-review.ts", args);
  if (r.code !== 0) return Either.left(r.stdout || `adw-patch-review exited with code ${r.code}`);
  const tokens = tokensOf(r.stdout);
  // patch-review stdout: "<id> <pass|gaps> <spec-path>"
  if (!tokens || tokens.length < 3) return Either.left(`adw-patch-review: unparseable stdout: ${r.stdout.slice(0, 200)}`);
  const verdict = tokens[1];
  if (verdict !== "pass" && verdict !== "gaps") {
    return Either.left(`adw-patch-review: unexpected verdict "${verdict}" in stdout`);
  }
  return Either.right({ id: tokens[0]!, verdict, specPath: tokens.slice(2).join(" ") });
},
```

- Verify: `rg -n 'runPatchReview' adws/adw-plan-review-build-patch.ts` — present in both `PipelineDeps` and `realDeps`.

### Task 3 — Implement the build↔patch-review loop in `runPipeline`

Stages 1-3 (plan, review, build) are identical to the existing orchestrator. After stage 3 (build) succeeds, add the loop:

```ts
// ── Stage 4: patch-review + build↔patch loop ─────────────────────────────
// After the first build succeeds, run patch-review. On PASS → finalize.
// On GAPS → patch-review appended audit findings to the spec; re-run build
// then patch-review. Loop at most maxRetries times. After the bound, release
// to completed with patch_review_verdict: "gaps".
const maxRetries = args.maxRetries ?? 3;
const forcedBuildRestart = resume?.forcedFromStage && resume.resumeFrom === "build";
let patchIterations = forcedBuildRestart ? 0 : resume?.patchIterations ?? 0;
let patchVerdict: "pass" | "gaps" = "gaps";

while (patchIterations < maxRetries) {
  patchIterations++;
  process.stderr.write(
    `adw-plan-review-build-patch: stage 4 — patch-review (iteration ${patchIterations}/${maxRetries})\n`,
  );
  const patchRes = await deps.runPatchReview(specPathForLater, args.modelOverride, id);
  if (Either.isLeft(patchRes)) {
    appendEvent(id, { event: "stage-error", stage: "patch-review", detail: patchRes.left, iteration: patchIterations });
    state.failed_stage = "patch-review";
    return finalize(Either.left(`patch-review stage failed: ${patchRes.left}`));
  }
  stages.patchReview = patchRes.right;
  appendEvent(id, {
    event: "stage-complete",
    stage: "patch-review",
    verdict: patchRes.right.verdict,
    iteration: patchIterations,
    spec_path: patchRes.right.specPath,
  });

  patchVerdict = patchRes.right.verdict;
  state.patch_review_verdict = patchVerdict;
  state.patch_review_iterations = patchIterations;

  if (patchVerdict === "pass") {
    // Gaps closed — finalize as completed.
    delete state.patch_review_next_action;
    if (!completedStages.includes("patch-review")) completedStages.push("patch-review");
    await writeState(id, state as unknown as Record<string, unknown>).run();
    return finalize(Either.right({ id, specPath: specPathForLater, stages }));
  }

  // Persist immediately after every GAPS verdict so an interrupted run can
  // resume with the correct iteration count and pending rebuild action.
  state.patch_review_next_action = patchIterations < maxRetries ? "build" : "patch-review";
  await writeState(id, state as unknown as Record<string, unknown>).run();

  // GAPS — patch-review appended findings to the spec. If we have retries
  // left, re-run build; the next patch-review will re-audit the fixed code.
  if (patchIterations < maxRetries) {
    process.stderr.write(
      `adw-plan-review-build-patch: patch-review returned gaps (iteration ${patchIterations}); re-running build\n`,
    );
    appendEvent(id, { event: "loop-retry", from: "patch-review", to: "build", iteration: patchIterations, verdict: "gaps" });
    const rebuildRes = await deps.runBuild(specPathForLater, args.modelOverride, id);
    if (Either.isLeft(rebuildRes)) {
      appendEvent(id, { event: "stage-error", stage: "build", detail: rebuildRes.left, iteration: patchIterations, retry: true });
      state.failed_stage = "build";
      return finalize(Either.left(`build stage failed (retry ${patchIterations}): ${rebuildRes.left}`));
    }
    stages.build = rebuildRes.right;
    appendEvent(id, {
      event: "stage-complete",
      stage: "build",
      iteration: patchIterations,
      retry: true,
      spec_path: specPathForLater,
    });
    state.patch_review_next_action = "patch-review";
    await writeState(id, state as unknown as Record<string, unknown>).run();
    // Loop continues to the next patch-review iteration.
  }
}

// Loop bound reached — release to completed with unresolved gaps.
process.stderr.write(
  `adw-plan-review-build-patch: max retries (${maxRetries}) reached; releasing with patch_review_verdict=gaps\n`,
);
state.patch_review_verdict = "gaps";
state.patch_review_iterations = patchIterations;
delete state.patch_review_next_action;
if (!completedStages.includes("patch-review")) completedStages.push("patch-review");
return finalize(Either.right({ id, specPath: specPathForLater, stages }));
```

Key loop invariants:
- Each iteration runs patch-review first, then build (on gaps). The loop body is "patch-review → (gaps? → build → continue) | (pass? → break)".
- `patchIterations` counts completed patch-review runs, not build runs. It starts at 1 (the first patch-review after the initial build) and increments each cycle.
- Persist state after every patch-review verdict. On GAPS with retries left, write `patch_review_iterations`, `patch_review_verdict: "gaps"`, and `patch_review_next_action: "build"` before starting the rebuild. After a successful rebuild, update `patch_review_next_action: "patch-review"` before the next audit.
- `--from-stage build` is a forced restart of build + patch-review from scratch: seed `patchIterations = 0` and ignore any stored `patch_review_iterations`, `patch_review_verdict`, or `patch_review_next_action`.
- The `stages.build` field is overwritten on each rebuild — the final state records the last build's result, but the event log preserves the full history via `loop-retry` and retry `stage-complete` events.
- On loop-bound release, the pipeline still returns `Either.right` (exit 0) — the gaps are recorded in state, not treated as a pipeline failure. This matches "released to completion."

- Verify: `rg -n 'while.*patchIterations' adws/adw-plan-review-build-patch.ts` — the loop is present.
- Verify: `rg -n 'loop-retry|retry: true' adws/adw-plan-review-build-patch.ts` — the retry and retry build completion events are emitted.

### Task 4 — Update `finalize` to record patch-review agents + loop state

The `finalize` closure must include `patch-reviewer` in the `agents` array and write the loop-tracking fields:

```ts
const finalize = async (result: Either<string, PipelineResult>): Promise<Either<string, PipelineResult>> => {
  const agents: string[] = [];
  if (stages.plan) agents.push("planner");
  if (stages.review) agents.push("reviewer", "upgrader");
  if (stages.build) agents.push("builder");
  if (stages.patchReview) agents.push("patch-reviewer");
  const finalState: OrchestratorState = { ...state, agents, completed_stages: completedStages };
  if (specPath) finalState.spec_path = specPath;
  if (state.patch_review_verdict) finalState.patch_review_verdict = state.patch_review_verdict;
  if (state.patch_review_iterations !== undefined) finalState.patch_review_iterations = state.patch_review_iterations;
  if (state.patch_review_next_action) finalState.patch_review_next_action = state.patch_review_next_action;
  // ... rest identical (Left → failed, Right → completed)
};
```

- Verify: read the `finalize` closure — it pushes `"patch-reviewer"` when `stages.patchReview` is set.

### Task 5 — Extend `loadWorkspace` for patch-review resume

The `loadWorkspace` function's inference branch (which derives `completedStages` from the `agents` array when `completed_stages` isn't explicit) must recognize `patch-reviewer`:

```ts
if (agents.includes("planner")) completedStages.push("plan");
if (agents.includes("reviewer")) completedStages.push("review");
if (agents.includes("builder")) completedStages.push("build");
if (agents.includes("patch-reviewer")) completedStages.push("patch-review");
```

Also: when resuming mid-loop, the orchestrator must re-enter at the exact pending action. Store both `patch_review_iterations` and `patch_review_next_action` in state. `patch_review_iterations` seeds the loop counter; `patch_review_next_action` determines whether the next invocation must run build before patch-review or can go directly to patch-review. The `ResumeContext` gains optional loop fields:

```ts
export interface ResumeContext {
  description: string;
  specPath: string | null;
  completedStages: StageName[];
  resumeFrom: StageName;
  patchIterations?: number;  // NEW: seed the loop counter on resume
  patchNextAction?: "build" | "patch-review"; // NEW: exact pending loop action
  forcedFromStage?: boolean; // NEW: true when --from-stage supplied explicitly
}
```

Auto-detection rules:
- If `--from-stage` is supplied, honor it exactly and set `forcedFromStage: true`.
- Without `--from-stage`, if `patch_review_next_action === "build"`, set `resumeFrom = "build"` even if `completed_stages` already contains `"build"`; this means a GAPS verdict was recorded and the rebuild that should address it has not completed.
- Without `--from-stage`, if `patch_review_next_action === "patch-review"`, set `resumeFrom = "patch-review"`; this means the rebuild completed and the next pending action is a patch-review.
- Otherwise, use the first incomplete stage in `STAGE_ORDER`.

Exact stage skip conditions in `runPipeline`:
```ts
const forcedBuildRestart = resume?.forcedFromStage && resume.resumeFrom === "build";
const shouldRunPlan = !args.specPath && (!resume || resume.resumeFrom === "plan");
const shouldRunReview = !resume || (resume.resumeFrom !== "build" && resume.resumeFrom !== "patch-review");
const shouldRunInitialBuild = !resume || resume.resumeFrom !== "patch-review";
```

These conditions are intentionally explicit:
- `resumeFrom === "patch-review"` skips plan, review, and build, then runs patch-review next. This is required for `--from-stage patch-review` and for auto-resume after a rebuild has already completed.
- `resumeFrom === "build"` skips plan and review, then runs build before patch-review. This covers forced `--from-stage build` and auto-resume after GAPS when `patch_review_next_action === "build"`.
- `resumeFrom === "plan"` and `resumeFrom === "review"` still run build after their resumed earlier stages complete, so patch-review never runs against stale build output.
- On forced `--from-stage build`, ignore prior loop state by seeding `patchIterations = 0` and clearing `state.patch_review_iterations` / `state.patch_review_verdict` / `state.patch_review_next_action` before the build. Auto-resume at build from `patch_review_next_action === "build"` keeps `patchIterations = resume.patchIterations ?? 0`.

- Verify: `rg -n 'patch-reviewer' adws/adw-plan-review-build-patch.ts` — appears in both `finalize` and `loadWorkspace`.

### Task 6 — Create `test/unit/adw-pipeline-loop.test.ts`

Mirror the structure of `test/unit/adw-pipeline.test.ts` (mocked `PipelineDeps`, seeded workspace state, no live LLM). Required test cases:

**Fresh-run pipeline:**
- Full 4-stage success: plan → review → build → patch-review(pass) → completed. Assert all 4 deps called once, final state has `patch_review_verdict: "pass"`, `patch_review_iterations: 1`.
- Patch-review gaps on first try, pass on second: patch-review(gaps) → build(retry) → patch-review(pass). Assert build called twice, patch-review called twice, `patch_review_iterations: 2`.
- Patch-review gaps 3 times → release: patch-review(gaps) × 3 with build between each. Assert `patch_review_iterations: 3`, `patch_review_verdict: "gaps"`, status `completed` (not failed — it's released, not a failure).
- `--max-retries 1`: patch-review(gaps) once → immediately release (no rebuild). Assert build called once, patch-review called once.

**Resume:**
- Resume at patch-review: seed state with `completed_stages: ["plan","review","build"]` + `spec_path`. Assert plan/review/build NOT called, patch-review IS called.
- Resume mid-loop after GAPS before rebuild: seed state with `completed_stages: ["plan","review","build"]` + `patch_review_iterations: 1` + `patch_review_verdict: "gaps"` + `patch_review_next_action: "build"`. Assert plan/review are NOT called, build IS called before the next patch-review, and the next patch-review is iteration 2.
- Resume mid-loop after rebuild before patch-review: seed state with `completed_stages: ["plan","review","build"]` + `patch_review_iterations: 1` + `patch_review_verdict: "gaps"` + `patch_review_next_action: "patch-review"`. Assert plan/review/build are NOT called and patch-review is called at iteration 2.
- Forced `--from-stage build` with prior loop state: seed `patch_review_iterations: 2`, `patch_review_verdict: "gaps"`, and `patch_review_next_action: "patch-review"`, then run with `fromStage: "build"`. Assert build runs before patch-review and final state starts the loop from scratch (`patch_review_iterations` is based on the new run, not the stored 2).
- Forced `--from-stage patch-review` with prior loop state: assert plan/review/build are NOT called and patch-review is called next.

**Spec-path input:**
- `parseArgs(["docs/specs/SPEC-059-adw-pipeline-loop.md"])` sets `specPath` and leaves `description` empty.
- Running with `{ description: "", specPath: "/abs/SPEC-059.md" }` skips plan and runs review → build → patch-review.
- Final state for spec-path input includes `completed_stages: ["plan","review","build","patch-review"]` and `spec_path`.

**Validation errors:**
- `--from-stage patch-review` without `--id` → error.
- `--max-retries 0` → error.
- `--max-retries -1` → error.

**parseArgs:**
- `--max-retries 2` parsed correctly.
- `--from-stage patch-review` accepted.

### Task 7 — Update `docs/specs/index.md`

Add SPEC-059 entry to the spec index table.

### Task 8 — Run `Validation Commands`

Run every command in the Validation Commands section. All must pass with zero errors.

## Testing Strategy

### Unit Tests
All pipeline behavior is tested via mocked `PipelineDeps` in `test/unit/adw-pipeline-loop.test.ts` — no live `claude`, `codex`, or real `agents/` mutation (uses seeded temp state files + cleanup). The loop logic, retry counting, gap-release, and resume-mid-loop are all pure control-flow tests.

### Integration Tests
The subprocess composition (`realDeps.runPatchReview` spawning `adw-patch-review.ts`) is verified structurally by typecheck + the `--help` exit-code checks. A live end-to-end test would chain 4 LLM calls (plan ~8min + review ~5min + build ~15min + patch-review ~10min, × retries) — not feasible in the 10-min task ceiling. The 3-stage subprocess composition was already verified live in the `adw-plan-reviewspec-build.ts` demo; the 4th stage uses the identical pattern.

### Edge Cases
- **Patch-review subprocess exits non-zero** (not a verdict — a crash): treated as `Either.left`, pipeline fails at `patch-review` stage. Distinct from GAPS (which exits 0).
- **Build fails on retry** (after a gaps-triggered rebuild): the pipeline fails at `build` with `retry: true` in the event. Does not loop again.
- **Spec file mutated between cycles**: patch-review's `appendFindingsToSpec` writes to the spec; the next `runBuild` reads the augmented spec. This is the load-bearing side effect — verify the spec path passed to rebuild is the same file (it is — `specPathForLater` doesn't change across iterations).
- **`--max-retries 1`**: means "run patch-review once, if gaps release immediately" — no rebuild loop at all.
- **Resume mid-loop after GAPS before rebuild**: `patch_review_next_action: "build"` means auto-resume must run build first, then patch-review. It must not jump directly to patch-review just because `completed_stages` contains `"build"` from the previous build.
- **Resume mid-loop after rebuild before patch-review**: `patch_review_next_action: "patch-review"` means auto-resume skips plan/review/build and runs patch-review next.
- **Resume mid-loop with `--from-stage build`**: forces re-running build + patch-review from scratch, ignoring any prior `patch_review_iterations`, `patch_review_verdict`, and `patch_review_next_action`.
- **Spec-path input**: existing `adw-plan-reviewspec-build.ts <spec-path>` behavior is preserved in the new orchestrator; plan is skipped, review/build/patch-review run, and `--feature`/`--bug`/`--chore` with a spec path remains invalid.

## Acceptance Criteria

1. `bun adws/adw-plan-review-build-patch.ts "description"` runs plan → spec-review → build → patch-review in one workspace, printing `<id> <spec-path>` on completion.
2. When patch-review returns GAPS, the orchestrator re-runs build then patch-review, up to `--max-retries` times (default 3).
3. After the retry bound, the pipeline releases to `completed` with `patch_review_verdict: "gaps"` and `patch_review_iterations: <count>` in the state file.
4. When patch-review returns PASS, the pipeline finalizes immediately with `patch_review_verdict: "pass"`.
5. `--id <workspace>` resumes an interrupted run, auto-detecting the stage (including `patch-review` and mid-loop positions via `patch_review_next_action`).
6. `--from-stage <plan|review|build|patch-review>` overrides auto-detection.
7. `--max-retries <N>` bounds the loop; `--max-retries 1` means no rebuild on gaps.
8. `bun run typecheck:src`, `bun run typecheck:test`, and `bun run typecheck` pass with zero errors.
9. All unit tests in `test/unit/adw-pipeline-loop.test.ts` pass.
10. The existing 3-stage orchestrator (`adw-plan-reviewspec-build.ts`) is unchanged — this is a new file, not a modification.
11. Each loop iteration is recorded in `orchestrator/events.jsonl` with `loop-retry` events (iteration number, verdict, from/to stages) and retry build `stage-complete` events.
12. `bun adws/adw-plan-review-build-patch.ts docs/specs/SPEC-*.md` preserves the existing spec-path flow: it skips plan and runs review → build → patch-review against that spec.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

### Static checks
- `bun run typecheck:src` — zero TypeScript errors in source files.
- `bun run typecheck:test` — zero TypeScript errors in test files.
- `bun run typecheck` — zero TypeScript errors (includes `adws/**/*`).
- `rg -n 'runPatchReview' adws/adw-plan-review-build-patch.ts` — present in `PipelineDeps`, `realDeps`, and the loop body.
- `rg -n 'patch-review' adws/adw-plan-review-build-patch.ts` — present in `StageName`, `STAGE_ORDER`, `parseArgs` validation, `finalize`, `loadWorkspace`.
- `rg -n 'loop-retry|retry: true' adws/adw-plan-review-build-patch.ts` — the retry event and retry build completion event are emitted in the loop body.
- `rg -n 'maxRetries|max-retries' adws/adw-plan-review-build-patch.ts` — the loop bound is wired from CLI to the loop.
- `rg -n 'specPath|looksLikeSpecPath' adws/adw-plan-review-build-patch.ts` — existing spec-path input is preserved.
- `rg -n 'patch_review_next_action' adws/adw-plan-review-build-patch.ts` — pending loop action is persisted and used for resume.

### CLI behavior
- `bun adws/adw-plan-review-build-patch.ts --help` — prints usage, exit 0.
- `bun adws/adw-plan-review-build-patch.ts` (no description, no --id) — usage error, exit 1.
- `bun adws/adw-plan-review-build-patch.ts --from-stage patch-review "x"` — error ("--from-stage requires --id"), exit 1.
- `bun adws/adw-plan-review-build-patch.ts --max-retries 0 "x"` — error ("--max-retries must be > 0"), exit 1.

### Unit tests
- `bun test test/unit/adw-pipeline-loop.test.ts` — all tests pass (fresh-run, loop, gap-release, resume, validation).
- `bun test test/unit/adw-pipeline.test.ts` — existing 3-stage tests still pass (no regression — the 3-stage file is unchanged).

### Existing dispatchers unchanged
- `bun adws/adw-plan-reviewspec-build.ts --help` — still exit 0 (the 3-stage orchestrator is untouched).
- `bun adws/adw-patch-review.ts --help` — still exit 0.

## Notes

**Why a new file, not a modification of `adw-plan-reviewspec-build.ts`.** The 3-stage orchestrator is a stable, tested, working tool. Adding a 4th stage + retry loop to it would change its behavior (it would no longer stop at build) and risk regressions in its 35-test suite. The 4-stage version is a superset for users who want the full cycle; the 3-stage version remains for users who want plan→review→build without the audit loop. Both share the same structural pattern (subprocess composition, shared workspace id, resume support) — the 4-stage file is a near-copy with the loop added.

**Why GAPS releases to `completed`, not `failed`.** A gaps verdict means "the audit found unmet criteria after 3 build cycles." That's not a pipeline failure — the pipeline did its job (ran the stages, looped, recorded the verdict). Treating it as `failed` would conflate "the pipeline crashed" with "the implementation has gaps." The `patch_review_verdict: "gaps"` field lets downstream tooling (or the user) distinguish "done with unresolved gaps" from "done with all criteria met." A human can then inspect `agents/{id}/patch-reviewer/verdict.json` for the specific gaps and fix them manually.

**Why the spec mutation is the loop's backbone.** Patch-review's `appendFindingsToSpec` appends an `## Audit findings` section to the spec file on GAPS. The next `runBuild` reads this augmented spec (the `/implement` skill sees the findings), so the rebuild can address the specific gaps. This is why the retry loop runs patch-review→build→patch-review: the audit must run first to identify what's missing, then the build fixes it, then patch-review re-audits. The spec path (`specPathForLater`) doesn't change across iterations — it's the same file, progressively annotated.

**Loop counter semantics.** `patch_review_iterations` counts completed patch-review runs. The first patch-review (after the initial build) is iteration 1. If it returns gaps and `maxRetries > 1`, a rebuild happens, then patch-review runs again as iteration 2. The counter reaches `maxRetries` and the loop exits. So `maxRetries = 3` means "up to 3 patch-review runs, with up to 2 rebuilds between them."

**Resume mid-loop.** If the pipeline is interrupted after patch-review returns gaps on iteration 2 but before the rebuild completes, the state has `patch_review_iterations: 2` + `patch_review_verdict: "gaps"` + `patch_review_next_action: "build"` + `completed_stages: ["plan","review","build"]`. On resume with `--id`, auto-detection must resume at `build` despite `"build"` already appearing in `completed_stages`, because that completed build was the pre-audit build. After the rebuild completes, the state changes to `patch_review_next_action: "patch-review"`. If interrupted then, auto-resume skips plan/review/build and starts patch-review at iteration 3 (the final allowed iteration if `maxRetries = 3`).

**The 10-minute task ceiling.** A full 4-stage run with retries is 40-90+ minutes. Background tasks are killed at ~10 minutes. The resume design (`--id`, auto-detection, mid-loop counter recovery) means the user can run `bun adws/adw-plan-review-build-patch.ts --id <workspace>` repeatedly and it will progress through the stages/loop across invocations. This is the intended workflow for long pipelines.

**Not in scope:**
- Modifying `adw-plan-reviewspec-build.ts` — it stays as-is.
- A `patch-review-only` orchestrator (review → build → patch-review without plan) — can be achieved by running `adw-spec-review.ts` + this orchestrator with `--from-stage build`.
- Adaptive retry strategies (e.g. switching models on retry, reducing `maxRetries` based on gap count) — future enhancement.
- Committing the implementation's edits between build cycles — the loop operates on the working tree as-is.
